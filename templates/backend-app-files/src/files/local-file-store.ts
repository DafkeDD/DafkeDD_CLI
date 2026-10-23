import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { type FileStore, parseKey } from './file-store.js'

/** Files in a folder on this machine: `<dir>/<organisation id>/<file id>`. For development and small installations. */
export class LocalFileStore implements FileStore {
    private readonly root: string

    constructor(dir: string) {
        this.root = resolve(dir)
    }

    private path(key: string) {
        const [organisation, file] = parseKey(key)
        return join(this.root, organisation, file)
    }

    async put(key: string, data: Buffer) {
        const path = this.path(key)
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, data)
    }

    async get(key: string) {
        return readFile(this.path(key)).catch((error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') return null
            throw error
        })
    }

    async delete(key: string) {
        await rm(this.path(key), { force: true })
    }
}
