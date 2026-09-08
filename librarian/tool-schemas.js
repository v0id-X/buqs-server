
export const librarianTools = [
    {
        type: 'function',
        function: {
            name:
                'get_user_profile',
            description:
                'Get the authenticated users profile, preferences, top genres, top authors, recent library activity, and ratings. Only use this when the user explicitly asks about their profile or preferences.',
            parameters: {
                type: 'object',
                properties: {},
                additionalProperties:
                    false
            }
        }
    },

    {
        type: 'function',
        function: {
            name:
                'get_catalog_books',
            description:
                'Retrieve catalog books using safe structured constraints. Use this for complex catalog requests that combine an author, one or more genres, an average-rating threshold, or a best/highest versus worst/lowest rating order. average ratings are catalog ratings, not the authenticated users personal ratings. Do not use it for the users own ratings or notes. Omit constraints the user did not request.',
            parameters: {
                type: 'object',
                properties: {
                    author: {
                        type: 'string',
                        minLength: 2,
                        maxLength: 100
                    },
                    genres: {
                        type: 'array',
                        items: {
                            type: 'string',
                            minLength: 1,
                            maxLength: 100
                        },
                        maxItems: 5
                    },
                    minimumRating: {
                        type: 'number',
                        minimum: 1,
                        maximum: 5
                    },
                    minimumInclusive: {
                        type: 'boolean'
                    },
                    maximumRating: {
                        type: 'number',
                        minimum: 1,
                        maximum: 5
                    },
                    maximumInclusive: {
                        type: 'boolean'
                    },
                    sortDirection: {
                        type: 'string',
                        enum: [
                            'asc',
                            'desc'
                        ]
                    },
                    withinLastResults: {
                        type: 'boolean',
                        description: 'Set true only when the user explicitly asks to rank, filter, or compare the books from the preceding response. The server supplies the prior ISBN set; never provide ISBNs yourself.'
                    },
                    limit: {
                        type: 'integer',
                        minimum: 1,
                        maximum: 20
                    }
                },
                additionalProperties:
                    false
            }
        }
    },

    {
        type: 'function',
        function: {
            name:
                'get_user_library',
            description:
                "Inspect or search the authenticated user's library and reading lists. Use this when the user asks what books are in their library, what they are currently reading, what is on their wishlist, what they have finished, or whether a specific book is in their library.",
            parameters: {
                type: 'object',
                properties: {
                    status: {
                        type: 'string',
                        enum: [
                            'all',
                            'reading',
                            'wishlist',
                            'finished'
                        ],
                        description: "Filter by status: 'reading' (currently reading), 'wishlist' (want to read), 'finished' (completed), or 'all' to check everything."
                    },
                    query: {
                        type: 'string',
                        description: "Search for a specific book title or author inside the user's library (e.g. 'Dune', '1984', 'George Orwell')."
                    },
                    limit: {
                        type: 'integer',
                        minimum: 1,
                        maximum: 20
                    }
                },
                additionalProperties:
                    false
            }
        }
    },

    {
        type: 'function',
        function: {
            name:
                'get_reading_history',
            description:
                'Get the authenticated users recent reading/library activity. Only use this when the user explicitly asks about books they have read, finished, are reading, or their reading history.',
            parameters: {
                type: 'object',
                properties: {
                    status: {
                        type: 'string',
                        enum: [
                            'all',
                            'reading',
                            'wishlist',
                            'finished'
                        ]
                    },
                    query: {
                        type: 'string'
                    },
                    limit: {
                        type: 'integer',
                        minimum: 1,
                        maximum: 20
                    }
                },
                additionalProperties:
                    false
            }
        }
    },

    {
        type: 'function',
        function: {
            name:
                'get_user_ratings',
            description:
                'Get books the authenticated user has rated and their ratings. Only use this when the user explicitly asks about their ratings.',
            parameters: {
                type: 'object',
                properties: {
                    limit: {
                        type: 'integer',
                        minimum: 1,
                        maximum: 20
                    }
                },
                additionalProperties:
                    false
            }
        }
    },

    {
        type: 'function',
        function: {
            name:
                'search_books',
            description:
                'Search the BUQS catalog when the user wants to find a book and the exact ISBN is not already known.',
            parameters: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        minLength: 2,
                        maxLength: 100
                    },
                    limit: {
                        type: 'integer',
                        minimum: 1,
                        maximum: 20
                    }
                },
                required: [
                    'query'
                ],
                additionalProperties:
                    false
            }
        }
    },

    {
        type: 'function',
        function: {
            name:
                'get_book',
            description:
                'Get detailed information about one specific book using its ISBN. Do not use this if the ISBN and required information are already available in conversation history.',
            parameters: {
                type: 'object',
                properties: {
                    isbn: {
                        type: 'string',
                        minLength: 1,
                        maxLength: 32
                    }
                },
                required: [
                    'isbn'
                ],
                additionalProperties:
                    false
            }
        }
    },

    {
        type: 'function',
        function: {
            name:
                'get_similar_books',
            description:
                'Find books similar to a specific book using BUQS precomputed similarity scores. Results automatically exclude books that are already in the authenticated users library AND books the user has already rated. Therefore, results from this tool are eligible as new recommendations. If the user asks for N books, set limit to N.',
            parameters: {
                type: 'object',
                properties: {
                    isbn: {
                        type: 'string',
                        minLength: 1,
                        maxLength: 32
                    },
                    limit: {
                        type: 'integer',
                        minimum: 1,
                        maximum: 20
                    }
                },
                required: [
                    'isbn'
                ],
                additionalProperties:
                    false
            }
        }
    },

    {
        type: 'function',
        function: {
            name:
                'get_for_you_books',
            description:
                'Get personalized recommendations using the authenticated users BUQS affinity data. Results exclude books already in the users library and books they have rated. When the user explicitly requests a genre or author, pass that constraint using genre or author so the candidate pool is filtered before affinity ranking. Use this when the user asks what they should read next without specifying a particular book.',
            parameters: {
                type: 'object',
                properties: {
                    limit: {
                        type: 'integer',
                        minimum: 1,
                        maximum: 20
                    },
                    genre: {
                        type: 'string',
                        minLength: 1,
                        maxLength: 100
                    },
                    author: {
                        type: 'string',
                        minLength: 1,
                        maxLength: 100
                    }
                },
                additionalProperties:
                    false
            }
        }
    },

    {
        type: 'function',
        function: {
            name:
                'get_trending_books',
            description:
                'Get currently trending books from BUQS. Use this when the user asks what books are trending or popular right now.',
            parameters: {
                type: 'object',
                properties: {
                    limit: {
                        type: 'integer',
                        minimum: 1,
                        maximum: 20
                    }
                },
                additionalProperties:
                    false
            }
        }
    },

    {
        type: 'function',
        function: {
            name:
                'get_user_notes',
            description:
                'Retrieve notes belonging to the authenticated user. Use this when the user asks about their notes, what they wrote, or whether they have notes about a specific book. When a specific book or phrase is mentioned, pass a concise search string using the search parameter. Search matches both note title and note content.',
            parameters: {
                type: 'object',
                properties: {
                    search: {
                        type: 'string',
                        minLength: 1,
                        maxLength: 100
                    },
                    limit: {
                        type: 'integer',
                        minimum: 1,
                        maximum: 20
                    }
                },
                additionalProperties:
                    false
            }
        }
    },
    {
        type: 'function',
        function: {
            name:
                'search_general_knowledge',
            description:
                'Search for book recommendations using general AI knowledge when BUQS catalog tools return no results. ONLY call this tool AFTER you have already tried relevant BUQS catalog tools (search_books, get_catalog_books, etc.) and they returned empty or no matching results. Results from this tool are NOT from the BUQS catalog and should be clearly marked as AI-sourced.',
            parameters: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        minLength: 2,
                        maxLength: 200,
                        description: 'The book search query or recommendation request'
                    },
                    context: {
                        type: 'string',
                        maxLength: 500,
                        description: 'Additional context about what the user is looking for'
                    }
                },
                required: [
                    'query'
                ],
                additionalProperties:
                    false
            }
        }
    }
];
