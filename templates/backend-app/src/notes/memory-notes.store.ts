import { randomUUID } from 'node:crypto'
import type { Note, NotesStore } from './notes.store.js'

/** The notes in memory, per organisation (the e2e tests). */
export class MemoryNotesStore implements NotesStore {
    private readonly notes = new Map<string, Note[]>()

    list(tenantId: string): Promise<Note[]> {
        return Promise.resolve([...(this.notes.get(tenantId) ?? [])].reverse())
    }

    create(tenantId: string, authorId: string, text: string): Promise<Note> {
        const note = { id: randomUUID(), authorId, text, createdAt: new Date().toISOString() }
        this.notes.set(tenantId, [...(this.notes.get(tenantId) ?? []), note])
        return Promise.resolve(note)
    }

    remove(tenantId: string, id: string): Promise<boolean> {
        const notes = this.notes.get(tenantId) ?? []
        this.notes.set(
            tenantId,
            notes.filter(note => note.id !== id)
        )
        return Promise.resolve(notes.some(note => note.id === id))
    }
}
