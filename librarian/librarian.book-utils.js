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