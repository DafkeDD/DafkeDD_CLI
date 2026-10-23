import { Storage } from '@google-cloud/storage'
import { type FileStore, parseKey } from './file-store.js'

/** The part of a Google Cloud Storage bucket that is used (a small fake of it is used in the tests) */
export interface GcsBucket {
    file(name: string): {
        save(data: Buffer, options: { resumable: false; contentType: string }): Promise<void>
        download(): Promise<[Buffer]>
        delete(options: { ignoreNotFound: true }): Promise<unknown>
    }
}

/**
 * Files in a Google Cloud Storage bucket: the object `<prefix><organisation id>/<file id>`. For production. The bucket
 * must be private (uniform access, no public access); the files only leave through the API, which checks who asks.
 * The login to Google is the one of the environment (Application Default Credentials: the service account of Cloud
 * Run / GKE, or `gcloud auth application-default login` on a developer machine), so there is no key in the settings.
 */
export class GcsFileStore implements FileStore {
    constructor(
        private readonly bucket: GcsBucket,
        private readonly prefix = ''
    ) {}

    static open(options: { bucket: string; projectId?: string; prefix?: string }) {
        const storage = new Storage(options.projectId ? { projectId: options.projectId } : {})
        return new GcsFileStore(storage.bucket(options.bucket) as unknown as GcsBucket, options.prefix)
    }

    private object(key: string) {
        parseKey(key)
        return this.bucket.file(this.prefix + key)
    }

    async put(key: string, data: Buffer) {
        // The type is not stored for the browser: the API sends the type it read from the bytes
        await this.object(key).save(data, { resumable: false, contentType: 'application/octet-stream' })
    }

    async get(key: string) {
        try {
            const [data] = await this.object(key).download()
            return data
        } catch (error) {
            if ((error as { code?: number }).code === 404) return null
            throw error
        }
    }

    async delete(key: string) {
        await this.object(key).delete({ ignoreNotFound: true })
    }
}
