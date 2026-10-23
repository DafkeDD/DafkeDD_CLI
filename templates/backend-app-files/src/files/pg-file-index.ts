import { Injectable } from '@nestjs/common'
import { DatabaseService } from '../database/database.service.js'
import type { FileIndex, FileInfo } from './file-index.js'

type Row = {
    id: string
    name: string
    content_type: string
    size: number
    sha256: string
    created_by: string
    created_at: Date
}
const toInfo = (row: Row): FileInfo => ({
    id: row.id,
    name: row.name,
    contentType: row.content_type,
    size: row.size,
    sha256: row.sha256,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString()
})
const COLUMNS = 'id, name, content_type, size, sha256, created_by, created_at'

/** The descriptions of the files in PostgreSQL (table files), always through withTenant(): Row-Level Security. */
@Injectable()
export class PgFileIndex implements FileIndex {
    constructor(private readonly database: DatabaseService) {}

    async find(tenantId: string, id: string) {
        await this.database.ready()
        return this.database.withTenant(tenantId, async db => {
            const { rows } = await db.query<Row>(`SELECT ${COLUMNS} FROM files WHERE tenant_id = $1 AND id = $2`, [
                tenantId,
                id
            ])
            return rows[0] ? toInfo(rows[0]) : null
        })
    }

    async list(tenantId: string) {
        await this.database.ready()
        return this.database.withTenant(tenantId, async db => {
            const { rows } = await db.query<Row>(
                `SELECT ${COLUMNS} FROM files WHERE tenant_id = $1 ORDER BY created_at DESC, id LIMIT 100`,
                [tenantId]
            )
            return rows.map(toInfo)
        })
    }

    async add(tenantId: string, info: FileInfo) {
        await this.database.ready()
        return this.database.withTenant(tenantId, async db => {
            const { rows } = await db.query<Row>(
                `INSERT INTO files (id, tenant_id, name, content_type, size, sha256, created_by)
                 VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${COLUMNS}`,
                [info.id, tenantId, info.name, info.contentType, info.size, info.sha256, info.createdBy]
            )
            return toInfo(rows[0]!)
        })
    }

    async remove(tenantId: string, id: string) {
        await this.database.ready()
        return this.database.withTenant(tenantId, async db => {
            const { rowCount } = await db.query('DELETE FROM files WHERE tenant_id = $1 AND id = $2', [tenantId, id])
            return (rowCount ?? 0) > 0
        })
    }
}
