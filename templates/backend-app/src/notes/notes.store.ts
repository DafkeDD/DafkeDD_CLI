/** A note of an organisation (the example of data that belongs to one tenant). */
export interface Note {
    id: string
    authorId: string
    text: string
    createdAt: string
}

/**
 * Where the notes live: PostgreSQL with Row-Level Security (PgNotesStore), or memory in the e2e tests
 * (MemoryNotesStore). Every method gets the tenant: a store never sees the notes of another organisation.
 */
export interface NotesStore {
    list(tenantId: string): Promise<Note[]>
    create(tenantId: string, authorId: string, text: string): Promise<Note>
    /** False when the note does not exist in this organisation. */
    remove(tenantId: string, id: string): Promise<boolean>
}

export const NOTES_STORE = Symbol('NOTES_STORE')
