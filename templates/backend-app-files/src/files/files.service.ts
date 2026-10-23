import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common'
import { createHash } from 'node:crypto'
import { AppException } from '../common/app.exception.js'
import { FILE_INDEX, type FileIndex, type FileInfo } from './file-index.js'
import { FILE_STORE, type FileStore } from './file-store.js'
import { sniff } from './file-types.js'

/** The largest file (bytes) */
export const MAX_FILE_BYTES = 8 * 1024 * 1024

/**
 * The files of an organisation: the description in the database (FileIndex), the bytes in the FileStore (key
 * `<organisation id>/<file id>`). The id of a file is chosen by the app (a uuid), so saving the same file twice (a
 * retry) is harmless. The type is read from the bytes (JPEG, PNG, WebP or PDF), never taken from the client.
 */
@Injectable()
export class FilesService {
    private readonly logger = new Logger(FilesService.name)

    constructor(
        @Inject(FILE_INDEX) private readonly index: FileIndex,
        @Inject(FILE_STORE) private readonly store: FileStore
    ) {}

    /** Saves a file. The same id with the same content: nothing happens; with other content: 409. */
    async put(tenantId: string, account: string, id: string, name: string, data: Buffer): Promise<FileInfo> {
        if (!data.length) throw new AppException('errors.FILE_EMPTY', HttpStatus.BAD_REQUEST)
        if (data.length > MAX_FILE_BYTES)
            throw new AppException('errors.FILE_TOO_LARGE', HttpStatus.PAYLOAD_TOO_LARGE, {
                mb: MAX_FILE_BYTES / 1024 / 1024
            })
        const contentType = sniff(data)
        if (!contentType) throw new AppException('errors.FILE_TYPE_NOT_ALLOWED', HttpStatus.UNSUPPORTED_MEDIA_TYPE)
        const sha256 = createHash('sha256').update(data).digest('hex')

        const existing = await this.index.find(tenantId, id)
        if (existing) {
            if (existing.sha256 !== sha256) throw new AppException('errors.CONFLICT', HttpStatus.CONFLICT)
            return existing
        }
        const key = `${tenantId}/${id}`
        // The bytes first: a description without bytes would be worse than bytes without a description
        await this.store.put(key, data)
        try {
            return await this.index.add(tenantId, {
                id,
                name,
                contentType,
                size: data.length,
                sha256,
                createdBy: account,
                createdAt: new Date().toISOString()
            })
        } catch (error) {
            await this.store.delete(key).catch(() => undefined)
            throw error
        }
    }

    /** The description and the bytes of a file */
    async open(tenantId: string, id: string) {
        const info = await this.index.find(tenantId, id)
        const data = info ? await this.store.get(`${tenantId}/${id}`) : null
        if (!info || !data) throw new AppException('errors.FILE_NOT_FOUND', HttpStatus.NOT_FOUND)
        return { info, data }
    }

    list(tenantId: string) {
        return this.index.list(tenantId)
    }

    async remove(tenantId: string, id: string) {
        if (!(await this.index.remove(tenantId, id)))
            throw new AppException('errors.FILE_NOT_FOUND', HttpStatus.NOT_FOUND)
        // The description is gone, so a failure only leaves bytes nobody can reach (logged)
        await this.store
            .delete(`${tenantId}/${id}`)
            .catch((error: unknown) => this.logger.warn(`Could not remove the bytes of file ${id}: ${String(error)}`))
    }
}
