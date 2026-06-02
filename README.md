# buqs-server

The backend that powers **buqs** — a book discovery and personal reading platform. This is a production-grade REST API built in Node.js that handles user authentication, a multi-mode intelligent feed system, real-time personalised recommendations, fuzzy in-memory search, an async analytics pipeline, a cosine-similarity engine, and a full reading library. The architecture was designed from the start to stay fast under load, avoid redundant database work, and improve the experience the more a user interacts with it.

---

## What's inside

- Multi-mode feed engine (Discovery, For You, Trending, Standard)
- Real-time personalisation through background aggregation workers
- Nightly cosine similarity engine for book recommendations
- In-memory fuzzy search with zlib-compressed Redis backing
- BullMQ async analytics pipeline
- JWT + bcrypt + Google OAuth authentication
- Secure forgot/reset password via Nodemailer
- Personal reading library with status tracking
- CRUD notes with full-text search
- Immutable one-time book ratings
- Cursor/keyset pagination across every paginated endpoint
- Safe mode content filtering across every single feed, search, and recommendation surface

---

## Authentication & Security

### Registration & Login
Users register with email, name, and password. Passwords are hashed with **bcrypt** at salt round 10 before storage — plain-text credentials are never persisted. On login, the server fetches the user record, checks that a password hash exists (rejecting Google-only accounts with a clear message), and compares using `bcrypt.compare`. Successful login returns a **JWT** signed with `HS256`, scoped to the user's ID, with a **7-day expiry**.

### Google OAuth
The `/api/auth/google-auth` endpoint accepts a Google ID token from the client. The server verifies it server-side using `google-auth-library`'s `OAuth2Client.verifyIdToken()` against the configured `GOOGLE_CLIENT_ID` audience, extracts the `sub` (Google user ID), email, and name from the payload, then:
- If the email already exists in the database but has no `google_id`, it links the Google identity to that account without forcing a new signup.
- If the email doesn't exist at all, it inserts a new user record with no `password_hash`.

This means users who initially registered by email can later sign in with Google and land on the same account seamlessly.

### JWT Middleware
Every protected route runs through `protectRoute`. It reads the `Authorization: Bearer <token>` header, verifies the JWT against `JWT_SECRET`, and attaches the decoded payload (containing `id`) to `req.user`. Requests with missing, expired, or tampered tokens are rejected with a `401` before any controller logic runs.

### Forgot & Reset Password
The forgot-password flow uses `crypto.randomBytes(20).toString('hex')` to generate a cryptographically unpredictable reset token. This token and a 1-hour expiry timestamp are written to the user's row in Postgres. A reset link containing the token is sent via **Nodemailer** over Gmail SMTP. The reset endpoint validates the token against `reset_password_expires > NOW()` — expired or invalid tokens get a clean error. On successful reset, the new password is hashed with bcrypt and the token fields are nulled out to prevent reuse. As a privacy measure, the forgot-password endpoint always responds with a success message whether or not an account exists, to prevent user enumeration.

---

## The Feed System

The feed is the most complex part of this server. It has four distinct modes, each with its own logic, caching strategy, and pagination approach. All feed endpoints support a `safe_mode=true` query parameter that excludes books marked as adult content — this filter is applied at the database query level, not in application code, so it's reliable across every mode.

### 1. Discovery Feed

The core challenge the Discovery Feed solves: how do you serve a large, varied, relevant candidate pool to many different users without hitting the database for every individual request?

**Cohort bucketing.** Users are assigned to one of 20 deterministic cohort buckets by hashing their user ID with a polynomial hash (`Math.imul(31, hash) + charCode`). Two users in the same bucket see identical candidate pools — which means that pool can be shared from a single Redis cache entry rather than fetched per-user.

**Candidate pool fetch.** For each cohort, a pool of up to 300 books is fetched from Postgres, ordered by `base_feed_score DESC`. If `safe_mode` is active, `WHERE b.is_adult = false` is prepended. Genre filters are applied via the PostgreSQL array overlap operator `b.genres && $1::text[]`. The entire 300-book pool is then cached in Redis under a key that encodes the bucket, genre filter, pagination cursor, and safe mode — with a 3-minute TTL. Subsequent requests from the same cohort read from cache and skip the database entirely.

**Seeded entropy.** The pool is not served in pure score order, because that would make every user in a bucket see the same sequence. Instead, each book gets a small entropy addition: `seededRandom(bucketId, isbn) * 0.10`. The `seededRandom` function combines the bucket ID, the ISBN, and today's date into a seed string, then runs it through a polynomial hash and into a sine-based PRNG. This produces a stable, deterministic float in `[0, 1)` that is consistent within a day (so repeated requests don't reshuffle the feed) but changes the next day (so the feed feels fresh). The pool is re-sorted after entropy injection.

**Cursor-based pagination across pool batches.** When a client has consumed all books in the 300-item pool, the server uses a keyset cursor (`poolStartVal`, `poolStartIsbn`) to fetch the next 300-item batch, which is again cached. This means users can scroll through the entire catalogue in 300-item windows without OFFSET degrading over time.

**Shuffle mode.** When `shuffle=true` is passed, the cohort ID is replaced with a random integer, bypassing the Redis cache entirely. Every shuffle request generates a fresh random ordering.

### 2. For You Feed (Personalised)

The For You Feed reads each user's accumulated genre and author affinity weights (maintained by the background Affinity Aggregator worker) and produces a personalised ranked feed.

**Affinity-based filtering.** The server reads `genre_weights` and `author_weights` from `user_affinity_weights` for the requesting user. It extracts the top 3 genres by weight and queries for books in those genres, explicitly **excluding** books the user has already rated or added to their library (`NOT EXISTS` subquery on both `ratings` and `user_library`). This prevents the same books from reappearing in personalised results once a user has engaged with them.

**Multi-factor scoring.** Each candidate book is scored using:

```
final_score =
  (personalisation_score × 0.50) +
  (base_feed_score       × 0.40) +
  (freshness_decay       × 0.10) +
  entropy
```

Where `personalisation_score` is itself a weighted blend of genre match (`× 0.7`) and author match (`× 0.3`) from the user's affinity weights. `freshness_decay` is `Math.exp(-0.138 × age_in_years)`, which decays by roughly half every 5 years and keeps older books from completely dominating. Entropy is the same daily-seeded PRNG used in the Discovery Feed, unique per user-ISBN pair.

**Graceful fallback.** New users who have no affinity data yet (or whose weight vectors are empty) are silently redirected to the Discovery Feed, so there is never a cold-start failure state.

**Caching.** The scored, sorted pool of 300 books is cached in Redis for 5 minutes (300 seconds) under a per-user key. Pool-batch cursor pagination works identically to the Discovery Feed.

### 3. Trending Feed

The Trending Feed surfaces the books generating the most real-time engagement. It reads directly from the `trending_score` column in `book_stats`, which is recomputed every 5 minutes by the Stats Aggregator worker using recent event data. The trending score formula is:

```
trending_score =
  (recent_views    × 5.0)  +
  (recent_adds     × 15.0) +  ← library adds weighted most heavily
  (recent_searches × 2.0)  +
  (base_feed_score × 2.0)  +
  (average_rating  × 1.5)
```

The query fetches the top 50 books by trending score (filtered by `safe_mode` if active) and the result is **cached in Redis for 5 minutes**. Critically, the Stats Aggregator also pro-actively refreshes both the safe and non-safe trending caches at the end of every aggregation run — so in practice the Redis key is almost always warm and trending requests never wait on a cold query.

The client passes a `limit` parameter (default 10) and the server slices from the cached top-50 list, meaning the database is only involved when the cache has genuinely expired.

### 4. Standard Feed (Sorted Browsing)

When `sort` is anything other than `'discovery'`, the Standard Feed activates. It supports five sort modes: `newest` (default), `oldest`, `top_rated`, `title_a_z`, and `title_z_a`. Each sort mode uses its own keyset cursor column:

- `newest` / `oldest` → cursor on `published_year + isbn`
- `top_rated` → cursor on `average_rating + isbn`
- `title_a_z` / `title_z_a` → cursor on `title + isbn`

The comparison operators flip direction accordingly (`<` for descending sorts, `>` for ascending), keeping pagination correct in all directions. A separate `COUNT(*)` query runs in parallel to return the total book count for UI purposes.

---

## Search

### Autocomplete (In-Memory, Zero-DB)

The autocomplete endpoint uses a **Fuse.js** fuzzy search index loaded entirely in RAM. At server startup (and every 5 minutes thereafter), the search dictionary is decompressed from Redis, parsed, and used to construct two Fuse indexes — one across all books and one filtered to safe books (`is_adult = false`). Autocomplete queries call `index.search(term, { limit: 12 })` directly against whichever index is active. No database query, no network hop to Redis — just an in-process scan. This makes autocomplete effectively instant regardless of dataset size.

### Full-Text Search (Database-Backed, Paginated)

The `/api/books/search` endpoint handles full-text search with pagination. It queries Postgres using a **dual strategy**:

```sql
WHERE (search_text % $1 OR search_text ILIKE $2)
```

`%` is the pg_trgm trigram similarity operator, which catches fuzzy matches (typos, partial words). `ILIKE` catches substring matches that might score below the trigram threshold. Together they cover both fuzzy and exact partial queries. Results are paginated using a keyset cursor on `(published_year, isbn)`. Search events are tracked asynchronously via the analytics queue for any authenticated user.

### Search Dictionary Architecture

The search dictionary is built by the **Search Aggregator worker** every 5 minutes. It fetches every book from Postgres, ordered by `trending_score DESC` (so more popular books appear first in Fuse results), and constructs a `searchable_string` for each book by concatenating title, author, genre list, and ISBN into a single lowercased field. This composite string is what Fuse.js indexes. The dictionary is then:

1. `JSON.stringify`'d
2. Compressed with `zlib.deflate`
3. Base64-encoded
4. Stored as a single Redis string under `search:dictionary`

On the read side, the `refreshSearchCache` util reverses this: it reads the base64 string from Redis, decodes it to a Buffer, inflates it with `zlib.inflate`, parses the JSON, filters a safe subset, and builds both Fuse indexes. The compressed format keeps memory pressure low for what could otherwise be a large in-memory payload.

---

## Similar Books

The `/api/books/:isbn/similar` endpoint returns books that are mathematically similar to a given title. Results come from a pre-computed `book_similarities` table populated by the Similarity Aggregator worker. At query time:

1. The full similarity pool for the requested ISBN is fetched from Redis (cached for 24 hours) or from Postgres on a cache miss.
2. If `safe_mode=true`, adult books are filtered from the pool.
3. Ties in `similarity_score` are broken using the same **seeded PRNG** used in feeds — seeded by the user's cohort bucket — so users in different cohorts get subtly different orderings of equally similar books.
4. The response returns the top `limit` (default 10) books after re-sort.

---

## Background Workers

Four background workers run from the moment the server starts. They all operate on node-cron schedules and share the PostgreSQL connection pool.

### Stats Aggregator (every 5 minutes)

The Stats Aggregator is responsible for keeping `book_stats` current. Every 5 minutes it:

1. Aggregates `analytics_events` from the last 5 minutes, counting recent views, library adds, and searches per ISBN.
2. Recomputes `average_rating` from the `ratings` table.
3. Updates `book_stats` with incremented cumulative totals and freshly computed scores.

The `base_feed_score` formula (what drives the Discovery Feed ranking):

```
base_feed_score =
  (average_rating            × 0.30) +
  (LOG(10, 1 + total_views)  × 0.15) +   ← logarithmic to prevent viral dominance
  (recent_velocity           × 0.25) +   ← recent views / (total_views / 30), rewards momentum
  (engagement_ratio          × 0.15) +   ← (15×adds + 3×searches) / max(views, 100)
  (freshness_decay           × 0.10)     ← exp(-0.138 × years_since_published)
```

The `engagement_score` captures how meaningfully users engage relative to how many people just browse:

```
engagement_score = (15 × total_adds + 3 × total_searches + 1 × total_views) / max(total_views, 100)
```

After updating scores, the worker **pro-actively refreshes the Redis trending cache** for both safe and non-safe modes — so the Trending Feed endpoint almost never needs to run a live query.

### Affinity Aggregator (every 5 minutes)

This worker maintains the per-user taste profiles that power the For You Feed. Every 5 minutes it:

1. Pulls `analytics_events` from the last 5 minutes for authenticated users.
2. Assigns a weight delta to each event:

| Event | Condition | Weight Delta |
|---|---|---|
| `submit_rating` | rating ≥ 4 | +1.5 |
| `submit_rating` | rating = 3 | +0.2 |
| `submit_rating` | rating ≤ 2 | −1.0 |
| `update_library` | status = wishlist | +1.0 |
| `update_library` | status = reading | +1.2 |
| `update_library` | status = finished | +1.5 |
| `book_view` | any | +0.2 |
| other | any | +0.1 |

3. Joins events to `books` and uses `CROSS JOIN LATERAL unnest(b.genres)` to expand each book's genre array into individual rows, attributing the weight delta to each genre and to the author.

4. Aggregates deltas per user into `new_genre_weights` and `new_author_weights` as JSONB objects.

5. Upserts into `user_affinity_weights`. On conflict, the existing and new JSONB weights are merged key-by-key using `jsonb_object_keys(existing || new)` with `GREATEST(0, old_weight + new_weight)` — so weights can grow or shrink (low ratings reduce genre scores) but never go below zero.

This entire aggregation is a single SQL statement using CTEs (`RecentEvents → VectorMapping → AggregatedDeltas → INSERT ... ON CONFLICT DO UPDATE`), so it's efficient and atomic.

### Similarity Aggregator (daily at 03:00)

The Similarity Aggregator computes pairwise book similarity using cosine similarity on two feature vectors per book: `genre_vector` and `author_vector`, both stored as JSONB in `book_feature_vectors`.

Each run:
1. Fetches books updated in the last 24 hours as the "target" set.
2. Fetches all books as the comparison set.
3. Pre-computes the **magnitude** of each vector (`√(Σ values²)`) to avoid redundant calculation during pairwise comparison.
4. For every target book, computes cosine similarity against every other book using an optimised dot-product loop that only iterates over keys present in both vectors.
5. Genre similarity and author similarity are computed separately, with author similarity receiving a **weight multiplier of 2** — authorship is weighted double because books by the same author tend to be more similar than books in the same genre.
6. The top 50 most similar books are written to `book_similarities` (with a DELETE-then-INSERT pattern to keep the table clean).

Adult books are never paired with non-adult books: `if (targetBook.is_adult !== compareBook.is_adult) continue`.

### Search Aggregator (every 5 minutes)

Rebuilds the compressed search dictionary in Redis. Fetches all books ordered by trending score (so popular books rank better in Fuse results), constructs a lowercase `searchable_string` per book, compresses the result with zlib, and pushes it to Redis. The in-process `refreshSearchCache` util then re-hydrates the two Fuse.js indexes automatically on its own 5-minute interval timer.

---

## Analytics Pipeline

All event tracking is fire-and-forget. Controllers call `trackEvent(userId, eventType, eventData)` which pushes a job onto the `analytics-queue` BullMQ queue (backed by Upstash Redis) and returns immediately. The API response is never delayed by analytics writes.

A single BullMQ **Worker** (`analytics.worker.js`) runs with `concurrency: 5`, consuming jobs from the queue and:

1. Writing every event to the `analytics_events` table, always, regardless of type. Anonymous events (where `userId` is `'anonymous'`) are stored with a null `user_id`.
2. For `book_view` events specifically, also running `UPDATE books SET views = views + 1 WHERE isbn = $1` to keep a fast, denormalised view counter on the books table.
3. Logging outcomes per event type for observability.

Jobs are configured with `removeOnComplete: true` and `removeOnFail: 100`, so the queue stays lean and doesn't accumulate stale entries.

Tracked events:

| Event | Trigger |
|---|---|
| `user_signup` | New registration (email or Google) |
| `user_login` | Successful login |
| `book_view` | `GET /api/books/:isbn` |
| `search` | `GET /api/books/search` (authenticated users only) |
| `feed_filter_used` | Any genre filter or shuffle on the discovery feed |
| `submit_rating` | `POST /api/ratings` |
| `update_library` | `POST /api/library/status` |
| `remove_from_library` | `DELETE /api/library/:isbn` |

---

## Personal Library

The library module lets users track books across three statuses: `wishlist`, `reading`, and `finished`. All four operations are protected by the auth middleware.

**Update / Add** — Uses a PostgreSQL `INSERT ... ON CONFLICT (user_id, isbn) DO UPDATE SET status = EXCLUDED.status` pattern. One endpoint handles both adding a new book and changing an existing book's status. The status is validated against a whitelist before any database operation.

**Get Library** — Returns the user's full library with book metadata (title, author, cover, genres, average rating) joined from `books` and `book_stats`. Supports optional `status` filtering and cursor-based pagination on `(updated_at, isbn)`.

**Get Book Status** — A lightweight single-book check: returns the current status of a specific ISBN for the authenticated user, or `null` if it's not in their library. Used by the frontend to render the correct UI state per book.

**Remove** — Hard deletes the row. Returns a 404 if the book wasn't in the user's library.

---

## Notes

Full CRUD note module, entirely user-scoped. All notes are isolated by `user_id` — queries always include `WHERE user_id = $1` to prevent cross-user data access.

**Create** — Inserts a note with optional title and empty-string defaults, so partial notes (title-only or content-only) are always valid.

**List** — Supports optional **full-text search** with `(title || ' ' || content) ILIKE '%term%'`, which leverages a GIN trigram index for fast partial matching. Cursor-based pagination on `updated_at`.

**Get by ID** — Fetches a single note, scoped to the authenticated user. Returns 404 for notes that don't belong to the requesting user.

**Update** — Updates title, content, and `updated_at` atomically. Returns 404 if the note isn't found under the requesting user's ID, preventing silent cross-user updates.

**Delete** — Hard deletes by ID + user_id. Returns the deleted ID on success, 404 if not found.

---

## Ratings

Ratings are **immutable**. Once a user rates a book, that rating is final — re-rating is rejected with a `403` and a clear error message. This is enforced by checking for an existing row in `ratings` before inserting.

Valid ratings are integers 1–5. The endpoint validates both bounds before touching the database. After a successful insert, the event is tracked asynchronously via the analytics queue.

`GET /api/ratings/:isbn/me` returns the authenticated user's rating for a specific book, or `{ rating: null }` if they haven't rated it. This lets the frontend render the correct rating state without bundling it into the book detail response.

---

## User Profile

`GET /api/users/me` returns the authenticated user's `id`, `name`, `email`, and `created_at`. Password hashes and Google IDs are never returned. The endpoint also applies the platform's special-display-name feature — if the authenticated user's email matches the `SP_EMAIL` env variable, their displayed name is replaced with `SP_NAME` at the application layer.

---

## Server Startup Sequence

The server does not accept requests until a deliberate, ordered startup completes:

1. **PostgreSQL connection verified** — `pool.connect()` must succeed or the process exits.
2. **Search dictionary built** — `runSearchAggregation()` runs synchronously at startup to ensure Redis has a valid compressed dictionary before any client hits the search endpoint.
3. **In-memory Fuse.js indexes built** — `refreshSearchCache()` decompresses the dictionary and constructs both indexes in RAM.
4. **All four background workers initialised** — Stats, Affinity, Search, and Similarity crons are started.
5. **HTTP server begins listening** — only after all of the above succeed.

This means the server is fully warm — database connected, search indexes ready, caches primed — on the very first request.

---

## Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Runtime | Node.js (ESM modules) | `"type": "module"` throughout |
| Framework | Express 5 | Async error handling improvements |
| Database | PostgreSQL | Via `pg` connection pool |
| Cache & Queue broker | Redis (Upstash) | Via `ioredis`, `maxRetriesPerRequest: null` for BullMQ compatibility |
| Job queue | BullMQ | Async analytics, concurrency 5 |
| Scheduling | node-cron | Four cron workers |
| Authentication | JWT (`jsonwebtoken`) | 7-day expiry, HS256 |
| Password hashing | bcrypt | Salt rounds: 10 |
| OAuth | Google Identity (`google-auth-library`) | Server-side token verification |
| Search | Fuse.js + pg_trgm | In-memory fuzzy + DB full-text |
| Compression | Node.js `zlib` | deflate/inflate for search dictionary |
| Email | Nodemailer | Gmail SMTP |
| File storage | Cloudinary | Integrated as dependency |
| Dev tooling | nodemon | Auto-restart on file change |

---

## Project Structure

```
buqs-server/
├── controllers/
│   ├── auth.controller.js       # register, login, googleAuth, forgotPassword, resetPassword
│   ├── book.controller.js       # getBooks, getForYouFeed, getTrendingBooks, searchBooks,
│   │                            #   autoCompleteBooks, getBookByIsbn, getSimilarBooks
│   ├── library.controller.js    # updateLibraryStatus, getUserLibrary, getBookStatus, removeFromLibrary
│   ├── note.controller.js       # createNote, getNotes, getNoteById, updateNotes, deleteNote
│   ├── rating.controller.js     # submitRating, getUserRating
│   └── user.controller.js       # getMe
├── db/
│   └── db.js                    # PostgreSQL connection pool
├── middlewares/
│   └── auth.middleware.js       # JWT protectRoute
├── queues/
│   └── analytics.queue.js       # BullMQ queue definition + trackEvent helper
├── routes/
│   ├── auth.routes.js
│   ├── book.routes.js
│   ├── library.routes.js
│   ├── note.routes.js
│   ├── rating.routes.js
│   └── user.routes.js
├── utils/
│   ├── generateToken.js         # JWT signing, 7d expiry
│   ├── googleClientConfig.js    # OAuth2Client singleton
│   ├── random.js                # getCohortBucket, seededRandom
│   ├── redisConnection.js       # ioredis singleton (shared by queue + cache)
│   └── searchCache.js           # Fuse.js index refresh + module-level index exports
├── workers/
│   ├── analytics.worker.js      # BullMQ consumer — event persistence + view counter
│   ├── affinityAggregator.js    # Every 5min — user genre/author weight vectors
│   ├── searchAggregator.js      # Every 5min — compressed Redis search dictionary
│   ├── similarityAggregator.js  # Daily 03:00 — cosine similarity matrix
│   └── statsAggregator.js       # Every 5min — book scores + trending cache refresh
└── server.js                    # Entry point, ordered startup sequence
```

---

## API Reference

```
# Health
GET    /health

# Auth (public)
POST   /api/auth/register
POST   /api/auth/login
POST   /api/auth/google-auth
POST   /api/auth/forgot-password
POST   /api/auth/reset-password/:resetToken

# Users (protected)
GET    /api/users/me

# Books (protected)
GET    /api/books                     ?sort=discovery|newest|oldest|top_rated|title_a_z|title_z_a
                                      &genre=Fiction,Mystery
                                      &limit=20
                                      &safe_mode=true
                                      &offset=0              (discovery mode)
                                      &poolStartVal=...      (discovery cursor)
                                      &poolStartIsbn=...     (discovery cursor)
                                      &cursorVal=...         (standard cursor)
                                      &cursorIsbn=...        (standard cursor)
                                      &shuffle=true          (discovery only)
GET    /api/books/for-you             (personalised feed, same cursor params as discovery)
GET    /api/books/trending            ?limit=10&safe_mode=true
GET    /api/books/search              ?query=dune&limit=20&cursorYear=...&cursorIsbn=...&safe_mode=true
GET    /api/books/autocomplete        ?query=dun&safe_mode=true
GET    /api/books/:isbn               (strips hyphens from ISBN before querying)
GET    /api/books/:isbn/similar       ?limit=10&safe_mode=true

# Library (protected)
GET    /api/library                   ?status=wishlist|reading|finished&cursorDate=...&cursorIsbn=...&limit=20
POST   /api/library/status            { isbn, status: 'wishlist'|'reading'|'finished' }
GET    /api/library/status/:isbn
DELETE /api/library/:isbn

# Notes (protected)
GET    /api/notes                     ?search=...&cursor=...&limit=15
POST   /api/notes                     { title, content }
GET    /api/notes/:id
PUT    /api/notes/:id                 { title, content }
DELETE /api/notes/:id

# Ratings (protected)
POST   /api/ratings                   { isbn, rating: 1-5 }  ← immutable, one per user per book
GET    /api/ratings/:isbn/me
```

---

## Getting Started

```bash
git clone <repo-url>
cd buqs-server
npm install
cp .env.example .env   
npm start
```

**Requirements:** Node.js 18+, PostgreSQL instance with the books schema applied, and a Redis connection (Upstash works out of the box with the `rediss://` URL format).

Environment variables needed: `PORT`, `DATABASE_URL`, `JWT_SECRET`, `GOOGLE_CLIENT_ID`, `FRONTEND_URL`, `REDIS_URL`, `EMAIL_USER`, `EMAIL_PASSCODE`, `SP_EMAIL`, `SP_NAME`.