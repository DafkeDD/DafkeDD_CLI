/**
 * Where the bytes of the files are kept. The rest of the API only knows this interface; the driver is chosen with
 * FILES_DRIVER (local: a folder on this machine, gcs: a Google Cloud Storage bucket).
 *
 * A key is `<organisation id>/<file id>`, both uuids, always made by the API (never by the client).
 */
export interface FileStore {
    put(key: string, data: Buffer): Promise<void>
    /** The bytes, or null when there is no such file */
    get(key: string): Promise<Buffer | null>
    /** Removes a file; a file that is not there is fine */
    delete(key: string): Promise<void>
}

/** The injection token of the active FileStore */
export const FILE_STORE = Symbol('FILE_STORE')

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const KEY = new RegExp(`^${UUID}/${UUID}$`)

/** Splits a key into its organisation and file id; throws on anything else (so no driver ever builds a path from it) */
export function parseKey(key: string): [organisation: string, file: string] {
    if (!KEY.test(key)) throw new Error('Invalid file key')
    return key.split('/') as [string, string]
}
