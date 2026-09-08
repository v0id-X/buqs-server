import {
    normalizeTitle
} from './librarian.parsers.js';

export const extractBook = (value) => {
    if (!value) return null;

    if (Array.isArray(value)) {
        for (const item of value) {
            const book = extractBook(item);
            if (book) return book;
        }
        return null;
    }

    if (typeof value !== 'object') return null;

    if (value.isbn && value.title) {
        return {
            isbn: String(value.isbn),
            title: String(value.title),
            author: value.author || null,
            published_year: value.published_year ?? value.publishedYear ?? null,
            genres: value.genres || null,
            description: value.description || null,
            cover_image: value.cover_image || value.coverImage || value.cover || null,
            average_rating: value.average_rating ?? value.averageRating ?? value.global_rating ?? null,
            user_personal_rating: value.user_personal_rating ?? value.rating ?? null,
            user_library_status: value.user_library_status ?? value.status ?? null,
            bookUrl: value.bookUrl || `/books/${encodeURIComponent(String(value.isbn))}`,
            noteUrl: value.noteUrl || null
        };
    }

    for (const key of [
        'book', 'sourceBook', 'result', 'data', 'results', 'books',
        'readingHistory', 'history'
    ]) {
        if (value[key] === undefined) continue;

        const book = extractBook(value[key]);
        if (book) return book;
    }

    return null;
};

export const extractBooks = (value) => {
    if (!value) return [];

    if (Array.isArray(value)) {
        return value.map(extractBook).filter(Boolean);
    }

    if (typeof value !== 'object') return [];

    for (const key of [
        'books', 'results', 'data', 'readingHistory', 'history'
    ]) {
        if (Array.isArray(value[key])) {
            return value[key].map(extractBook).filter(Boolean);
        }
    }

    const single = extractBook(value);
    return single ? [single] : [];
};

export const toRecommendation = (book, reason) => ({
    isbn: String(book.isbn),
    title: String(book.title),
    author: book.author || null,
    cover_image: book.cover_image || null,
    reason: reason || 'Recommended by the BUQS Librarian.',
    bookUrl: book.bookUrl || `/books/${encodeURIComponent(String(book.isbn))}`,
    noteUrl: book.noteUrl || null
});

export const getNoteContent = (note) => {
    if (!note) return null;

    return (
        note.content ||
        note.note ||
        note.text ||
        note.body ||
        note.note_text ||
        null
    );
};

export const getNoteBookISBN = (note) =>
    note?.isbn || note?.book_isbn || note?.bookIsbn || null;

export const getNoteBookTitle = (note) =>
    note?.book_title || note?.bookTitle || null;

export const findNoteForBook = (notes, book) => {
    if (!Array.isArray(notes)) return null;

    const isbn = String(book?.isbn || '');
    const title = normalizeTitle(book?.title);

    return notes.find((note) => {
        const noteISBN = String(getNoteBookISBN(note) || '');
        const noteTitle = normalizeTitle(getNoteBookTitle(note));

        return (
            (isbn && noteISBN === isbn) ||
            (title && noteTitle === title)
        );
    }) || null;
};

export const compactBookForLlm = (b) => {
    if (!b || typeof b !== 'object') return b;
    const rawStatus = b.status || b.user_library_status;
    let statusLabel = null;
    if (rawStatus) {
        const s = String(rawStatus).toLowerCase().trim();
        if (s === 'reading' || s === 'currently reading' || s === 'currently_reading') {
            statusLabel = 'currently reading';
        } else if (s === 'wishlist' || s === 'to-read') {
            statusLabel = 'wishlist';
        } else if (s === 'finished' || s === 'read') {
            statusLabel = 'finished';
        }
    }

    return {
        isbn: b.isbn || b.book_isbn,
        title: b.title || b.book_title,
        author: b.author,
        genre: b.genre || b.genres,
        rating: b.average_rating || b.rating || b.global_rating,
        summary: (b.description || b.summary || '').slice(0, 180),
        ...(statusLabel ? { status: statusLabel } : {})
    };
};

export const compactToolResultForLlm = (result) => {
    if (!result || typeof result !== 'object') return result;

    if (Array.isArray(result)) {
        return result.slice(0, 6).map(compactBookForLlm);
    }

    if (Array.isArray(result.books)) {
        return {
            ...result,
            books: result.books.slice(0, 6).map(compactBookForLlm)
        };
    }

    if (result.isbn && result.title) {
        return compactBookForLlm(result);
    }

    return result;
};