import { Injectable } from '@nestjs/common'
import { DatabaseService } from '../database/database.service.js'
import type { Note, NotesStore } from './notes.store.js'

type Row = { id: string; author_id: string; text: string; created_at: Date }
const toNote = (row: Row): Note => ({
    id: row.id,
    authorId: row.author_id,
    text: row.text,
    createdAt: row.created_at.toISOString()
})

/**
 * The notes in PostgreSQL. Every query runs through withTenant(): as the tenant role, so Row-Level Security only
 * shows the notes of that organisation, even without a WHERE tenant_id = ... (the WHERE is there anyway).
 */
@Injectable()
export class PgNotesStore implements NotesStore {
    constructor(private readonly database: DatabaseService) {}

    async list(tenantId: string): Promise<Note[]> {
        await this.database.ready()
        return this.database.withTenant(tenantId, async db => {
            const { rows } = await db.query<Row>(
                'SELECT id, author_id, text, created_at FROM notes WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 100',
                [tenantId]
            )
            return rows.map(toNote)
        })
    }

    async create(tenantId: string, authorId: string, text: string): Promise<Note> {
        await this.database.ready()
        return this.database.withTenant(tenantId, async db => {
            const { rows } = await db.query<Row>(
                'INSERT INTO notes (tenant_id, author_id, text) VALUES ($1, $2, $3) RETURNING id, author_id, text, created_at',
                [tenantId, authorId, text]
            )
            return toNote(rows[0]!)
        })
    }

    async remove(tenantId: string, id: string): Promise<boolean> {
        await this.database.ready()
        return this.database.withTenant(tenantId, async db => {
            const { rowCount } = await db.query('DELETE FROM notes WHERE tenant_id = $1 AND id = $2', [tenantId, id])
            return (rowCount ?? 0) > 0
        })
    }
}
