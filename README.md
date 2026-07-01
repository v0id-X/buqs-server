# buqs-server

The backend powering **Buqs** — a personalized book discovery platform. This is a Node.js/Express REST API that goes well beyond basic CRUD: it runs a multi-mode recommendation feed, a nightly cosine-similarity engine for "books like this," an async analytics pipeline, and a set of scheduled aggregation jobs that keep every score fresh without ever blocking a user's request.

The system was built around one constraint: **never make the user wait on a background computation.** Recommendations, trending scores, and taste profiles are all pre-computed by cron workers and served from Redis — the request path itself stays fast and simple.

---

## What's inside

- Four-mode book feed: cohort-cached Discovery, personalized For You, precomputed Trending, and sortable Standard browsing
- A real recommendation engine: per-user genre/author affinity vectors, rebuilt from behavior every 30 minutes
- A nightly cosine-similarity engine for "similar books," computed pairwise across the whole catalog
- Hybrid Postgres search — full-text ranking (`tsvector`) combined with trigram fuzzy matching (`pg_trgm`) in a single relevance score
- Async analytics pipeline via BullMQ, decoupled from the request/response cycle
- JWT auth + bcrypt + server-verified Google OAuth, with account linking between the two
- Redis-backed, distributed rate limiting across five different endpoint tiers
- Personal reading library, CRUD notes, and immutable one-time ratings
- Keyset (cursor) pagination everywhere — no `OFFSET` performance cliffs, even on large result sets
- Deployed on Azure with CI/CD via GitHub Actions — every push to `main` ships automatically

---

## Authentication

**Register / Login.** Passwords are hashed with bcrypt (10 salt rounds) before they ever touch the database. Login compares against the stored hash and, on success, issues a JWT (`HS256`, 7-day expiry) scoped to the user's ID.

**Google OAuth.** The client sends a Google ID token; the server verifies it independently using `google-auth-library`'s `verifyIdToken()` against the configured client audience — the token is never trusted blindly. If the resulting email already exists in the database, the Google identity is linked to that account rather than creating a duplicate. If it doesn't exist, a new user is created with no password hash, so they're Google-only until (if ever) they set one.

**JWT middleware.** Every protected route runs through `protectRoute`, which reads the `Authorization: Bearer <token>` header, verifies it, and attaches the decoded payload to `req.user`. Missing, malformed, or expired tokens are rejected with a `401` before any controller logic runs.

**Forgot / reset password.** A cryptographically random reset token (`crypto.randomBytes(20)`) is generated with a 1-hour expiry and emailed via Nodemailer over Gmail SMTP. To prevent user enumeration, the forgot-password endpoint always returns the same success response, whether or not the email exists in the system.

---

## The Feed System

This is the core of the backend — four distinct feed modes, each solving a different problem.

### Discovery Feed
The question this answers: how do you serve a large, relevant, varied pool of books to many different users without hitting the database on every single request?

Users are deterministically hashed into one of 20 cohort buckets (`getCohortBucket`), so users in the same bucket share one cached candidate pool instead of each triggering their own query. For each bucket, up to 300 books are pulled from Postgres ordered by `base_feed_score`, cached in Redis for 30 minutes, and paginated using a keyset cursor on `(base_feed_score, isbn)` — so scrolling through hundreds of books never degrades the way `OFFSET`-based pagination does. Genre filters are applied at the database level using Postgres's array-overlap operator (`genres && $1::text[]`), and a small randomized scoring wobble keeps repeated visits from feeling static.

### For You Feed (Personalized)
Reads each user's `genre_weights` / `author_weights` from `user_affinity_weights` — the output of the Affinity Aggregator worker described below — and ranks candidates from their top 3 genres. Books the user has already rated or shelved are explicitly excluded via `NOT EXISTS` subqueries, so the feed never resurfaces something they've already engaged with. Final ranking blends personalization score, base popularity, and a freshness-decay term so older books don't dominate forever. New users with no affinity data yet fall back to the Discovery Feed automatically — there's no cold-start dead end.

### Trending Feed
Reads a precomputed `trending_score` that the Stats Aggregator worker recalculates every 30 minutes, weighting library adds heaviest, then views, then searches, with a 30% time-decay applied on every cycle so old spikes fade out. The worker writes the result straight into Redis after computing it, so in practice this endpoint is almost always serving a cache hit rather than touching Postgres at request time.

### Standard Feed
Five sort modes — newest, oldest, top rated, title A–Z, title Z–A — each with its own keyset cursor column and comparison direction, so pagination stays correct and fast regardless of sort order.

Every feed mode respects a `safe_mode=true` query parameter, and the filter is always applied in the SQL `WHERE` clause — never as an application-layer post-filter — so it can't leak content through a cache or pagination edge case.

---

## Search

Rather than standing up a separate search index, search here leans on Postgres's own capabilities:

- **Full-text search** — `search_vector @@ websearch_to_tsquery('english', $1)`, ranked with `ts_rank`
- **Fuzzy/typo-tolerant matching** — `pg_trgm`'s `%` similarity operator against title, author, and genre text
- Both signals are combined into a single `relevance_score` per result, so a search catches exact matches, partial matches, and typos in one query

A separate, lighter-weight **autocomplete** endpoint (ILIKE prefix + trigram ranking, capped at 12 results) powers instant type-ahead without the overhead of the full search query.

---

## Similar Books — Cosine Similarity Engine

Every night at 03:00, the Similarity Aggregator recomputes book-to-book similarity across the catalog:

1. Each book has a `genre_vector` and `author_vector` (JSONB weight maps) stored in `book_feature_vectors`.
2. Vector magnitudes are pre-computed once per book to avoid redundant square-root calculations during pairwise comparison.
3. Cosine similarity is calculated between every updated book and every other book in the catalog, combining genre similarity with author similarity — **author overlap is weighted 2× higher** than genre overlap, since two books by the same author tend to be more alike than two books that merely share a genre tag.
4. Adult and non-adult books are never cross-matched.
5. The top 50 matches per book are written to `book_similarities` in both directions, so the relationship is queryable from either book.

At read time, results are cached in Redis for 24 hours, and ties in similarity score are broken using a deterministic, per-cohort seeded ordering — so users in different cohorts see slightly different (but equally valid) orderings of equally-similar books.

---

## Analytics Pipeline

Every meaningful user action — signup, login, book view, search, rating, library update — is tracked through `trackEvent()`, which pushes a job onto a BullMQ queue and returns immediately. **The API response is never delayed by analytics writes.** A dedicated worker (concurrency: 5) consumes the queue, persists each event to `analytics_events`, and — for book views specifically — increments a denormalized view counter directly on the `books` table for fast reads.

This queue is what feeds both aggregation workers below; nothing about the recommendation system requires a synchronous database write on the request path.

---

## Background Workers

Three cron-scheduled workers keep the system's derived data fresh without ever touching the request/response cycle.

| Worker | Schedule | What it does |
|---|---|---|
| **Stats Aggregator** | Every 30 min | Rolls up recent views/adds/searches per book, recomputes `average_rating`, applies a 30% decay to trending scores, and recalculates `base_feed_score` from a weighted formula (rating, log-dampened popularity, recent momentum, engagement ratio, freshness). Writes the refreshed trending lists straight to Redis. |
| **Affinity Aggregator** | Every 30 min | Rebuilds each active user's taste profile in a single atomic SQL statement — recent events are weighted by type (a 4★+ rating counts more than a book view), expanded per-genre and per-author via `CROSS JOIN LATERAL unnest()`, and merged into `user_affinity_weights` with a floor at zero so weights can shrink from low ratings but never go negative. |
| **Similarity Aggregator** | Daily at 03:00 | Full pairwise cosine-similarity recomputation for any book updated in the last 24 hours, described above. |

All three run as `node-cron` jobs inside the same process as the API server, sharing its Postgres connection pool.

---

## Rate Limiting

Rate limiting is Redis-backed (`express-rate-limit` + `rate-limit-redis`), which matters more than it sounds — it means limits are enforced consistently across server restarts and multiple instances, not just held in a single process's memory. Five separate tiers are applied by route sensitivity:

| Tier | Limit | Applies to |
|---|---|---|
| Auth | 12 / hour | register, login, Google auth, password reset |
| Search | 30 / min | search, autocomplete, for-you feed |
| Content creation | 30 / 15 min | notes create/update/delete |
| Library & ratings | 100 / 15 min | library status changes, rating submission |
| General API | 150 / 15 min | everything else |

The rate limiter's key generator also correctly parses `X-Forwarded-For` and handles IPv6 addresses, so client identification stays accurate behind Azure's load balancer rather than rate-limiting the proxy itself.

---

## Personal Library, Notes & Ratings

**Library** — Books are tracked under `wishlist`, `reading`, or `finished`. Adding and status-updating share a single endpoint via `INSERT ... ON CONFLICT (user_id, isbn) DO UPDATE`, so there's no separate "add" vs. "update" code path to keep in sync.

**Notes** — Full CRUD, entirely user-scoped (every query includes `WHERE user_id = $1`), with `ILIKE`-based search across title and content.

**Ratings** — Immutable by design: once a user rates a book, re-rating is rejected with a clear `403`. Valid range is enforced (1–5) before the database is touched.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 22 LTS, ES Modules throughout |
| Framework | Express 5 |
| Database | PostgreSQL (Azure Database for PostgreSQL — Flexible Server) |
| Cache & rate-limit store | Redis (Azure Managed Redis Enterprise, cluster-mode client via `ioredis`) |
| Job queue | BullMQ |
| Scheduling | node-cron |
| Auth | JWT (`jsonwebtoken`, HS256), bcrypt, Google OAuth (`google-auth-library`) |
| Rate limiting | `express-rate-limit` + `rate-limit-redis` |
| Email | Nodemailer (Gmail SMTP) |
| Search | Native PostgreSQL full-text search (`tsvector`) + `pg_trgm` fuzzy matching |
| Deployment | Azure Web App, CI/CD via GitHub Actions (auto-deploy on push to `main`) |

---

## Project Structure

```
buqs-server/
├── controllers/
│   ├── auth.controller.js       # register, login, googleAuth, forgotPassword, resetPassword
│   ├── book.controller.js       # discovery/for-you/trending/standard feeds, search, autocomplete, similar books
│   ├── library.controller.js    # updateLibraryStatus, getUserLibrary, getBookStatus, removeFromLibrary
│   ├── note.controller.js       # createNote, getNotes, getNoteById, updateNotes, deleteNote
│   ├── rating.controller.js     # submitRating, getUserRating
│   └── user.controller.js       # getMe
├── db/
│   └── db.js                    # PostgreSQL connection pool
├── middlewares/
│   ├── auth.middleware.js       # JWT protectRoute
│   └── rateLimiter.js           # Redis-backed rate limit tiers
├── queues/
│   └── analytics.queue.js       # BullMQ queue + trackEvent() helper
├── routes/
│   ├── auth.routes.js
│   ├── book.routes.js
│   ├── library.routes.js
│   ├── note.routes.js
│   ├── rating.routes.js
│   └── user.routes.js
├── utils/
│   ├── generateToken.js         # JWT signing
│   ├── googleClientConfig.js    # OAuth2Client singleton
│   ├── random.js                # getCohortBucket, seededRandom
│   └── redisConnection.js       # ioredis Cluster client (Azure Managed Redis)
├── workers/
│   ├── analytics.worker.js      # BullMQ consumer — event persistence + view counter
│   ├── affinityAggregator.js    # Every 30 min — user taste vector rebuild
│   ├── similarityAggregator.js  # Daily 03:00 — cosine similarity matrix
│   └── statsAggregator.js       # Every 30 min — book scores + trending refresh
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
GET    /api/books                 ?sort=discovery|newest|oldest|top_rated|title_a_z|title_z_a
                                   &genre=Fiction,Mystery&limit=20&safe_mode=true
GET    /api/books/for-you         (personalized feed, same cursor pattern as discovery)
GET    /api/books/trending        ?limit=10&safe_mode=true
GET    /api/books/search          ?query=dune&limit=20&offset=0&safe_mode=true
GET    /api/books/autocomplete    ?query=dun&safe_mode=true
GET    /api/books/:isbn
GET    /api/books/:isbn/similar   ?limit=10&safe_mode=true

# Library (protected)
GET    /api/library               ?status=wishlist|reading|finished&limit=20
POST   /api/library/status        { isbn, status }
GET    /api/library/status/:isbn
DELETE /api/library/:isbn

# Notes (protected)
GET    /api/notes                 ?search=...&limit=15
POST   /api/notes                 { title, content }
GET    /api/notes/:id
PUT    /api/notes/:id             { title, content }
DELETE /api/notes/:id

# Ratings (protected)
POST   /api/ratings               { isbn, rating: 1-5 }   ← immutable, one per user per book
GET    /api/ratings/:isbn/me
```

---

## Deployment

Deployed on **Azure Web App** (Linux, Node 22), with **PostgreSQL Flexible Server(Burstable B1ms)** and **Azure Managed Redis Enterprise** as managed backing services. CI/CD runs through **GitHub Actions**: every push to `main` triggers a build and automatic deploy to production — no manual deployment step.