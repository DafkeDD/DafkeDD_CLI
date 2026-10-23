import { Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { FILE_INDEX } from './file-index.js'
import { FILE_STORE, type FileStore } from './file-store.js'
import { FilesController } from './files.controller.js'
import { FilesService } from './files.service.js'
import { GcsFileStore } from './gcs-file-store.js'
import { LocalFileStore } from './local-file-store.js'
import { PgFileIndex } from './pg-file-index.js'

/** The store chosen with FILES_DRIVER (local by default, see .env.example) */
export function createFileStore(config: ConfigService): FileStore {
    const driver = config.get<string>('FILES_DRIVER') || 'local'
    if (driver === 'local') return new LocalFileStore(config.get<string>('FILES_DIR') || './storage')
    if (driver === 'gcs') {
        const bucket = config.get<string>('GCS_BUCKET')
        if (!bucket) throw new Error('FILES_DRIVER=gcs needs GCS_BUCKET (the name of a private bucket)')
        return GcsFileStore.open({
            bucket,
            projectId: config.get<string>('GCS_PROJECT') || undefined,
            prefix: config.get<string>('GCS_PREFIX') ?? ''
        })
    }
    throw new Error(`Unknown FILES_DRIVER "${driver}" (local or gcs)`)
}

/** Files of the organisations: where the bytes are kept is the only thing that differs between development and production. */
@Module({
    controllers: [FilesController],
    providers: [
        { provide: FILE_STORE, inject: [ConfigService], useFactory: createFileStore },
        { provide: FILE_INDEX, useClass: PgFileIndex },
        FilesService
    ],
    exports: [FilesService]
})
export class FilesModule {}
