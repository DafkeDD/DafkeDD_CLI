import { randomUUID } from 'node:crypto'
import { AppException } from '../common/app.exception.js'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseKey } from './file-store.js'
import { sniff } from './file-types.js'
import { GcsFileStore, type GcsBucket } from './gcs-file-store.js'
import { LocalFileStore } from './local-file-store.js'
import { FilesService, MAX_FILE_BYTES } from './files.service.js'
import { MemoryFileIndex } from './memory-file-index.js'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const key = () => `${randomUUID()}/${randomUUID()}`

describe('sniff', () => {
    it('knows the accepted types by their first bytes', () => {
        expect(sniff(PNG)).toBe('image/png')
        expect(sniff(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg')
        expect(sniff(Buffer.from('%PDF-1.4\n'))).toBe('application/pdf')
        expect(sniff(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp')
    })

    it('refuses everything else, also what is dressed up as an image', () => {
        expect(sniff(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull()
        expect(sniff(Buffer.from('<html><script>alert(1)</script></html>'))).toBeNull()
        expect(sniff(Buffer.from('RIFF\0\0\0\0WAVEfmt '))).toBeNull()
        expect(sniff(Buffer.alloc(0))).toBeNull()
    })
})

describe('GcsFileStore', () => {
    /** A bucket in memory that answers like Google does (404 for a missing object, a missing delete is fine) */
    function fakeBucket() {
        const objects = new Map<string, Buffer>()
        const bucket: GcsBucket = {
            file: name => ({
                save: async data => void objects.set(name, data),
                download: async () => {
                    const data = objects.get(name)
                    if (!data) throw Object.assign(new Error('No such object'), { code: 404 })
                    return [data]
                },
                delete: async () => objects.delete(name)
            })
        }
        return { bucket, objects }
    }

    it('saves, reads and removes a file under the prefix', async () => {
        const { bucket, objects } = fakeBucket()
        const store = new GcsFileStore(bucket, 'files/')
        const k = key()
        await store.put(k, PNG)
        expect([...objects.keys()]).toEqual(['files/' + k])
        expect(await store.get(k)).toEqual(PNG)
        await store.delete(k)
        expect(await store.get(k)).toBeNull()
        await expect(store.delete(k)).resolves.toBeUndefined()
    })

    it('never builds an object name from anything but a key', async () => {
        const store = new GcsFileStore(fakeBucket().bucket)
        await expect(store.put('../x', PNG)).rejects.toThrow()
        await expect(store.get('a/b')).rejects.toThrow()
    })

    it('passes other errors on', async () => {
        const store = new GcsFileStore({
            file: () => ({
                save: async () => undefined,
                download: async () => Promise.reject(Object.assign(new Error('denied'), { code: 403 })),
                delete: async () => undefined
            })
        })
        await expect(store.get(key())).rejects.toThrow('denied')
    })
})

describe('parseKey', () => {
    it('only takes <organisation uuid>/<file uuid>', () => {
        expect(parseKey(key())).toHaveLength(2)
        for (const bad of [
            '',
            '../x',
            'a/b',
            `${randomUUID()}/../${randomUUID()}`,
            `${randomUUID()}/${randomUUID()}/x`
        ])
            expect(() => parseKey(bad)).toThrow()
    })
})

describe('LocalFileStore', () => {
    const dir = mkdtempSync(join(tmpdir(), 'files-spec-'))
    const store = new LocalFileStore(dir)
    afterAll(() => rmSync(dir, { recursive: true, force: true }))

    it('keeps, returns and removes a file', async () => {
        const k = key()
        await store.put(k, PNG)
        expect(existsSync(join(dir, ...k.split('/')))).toBe(true)
        expect(await store.get(k)).toEqual(PNG)
        await store.delete(k)
        expect(await store.get(k)).toBeNull()
        // A file that is not there is fine
        await store.delete(k)
    })

    it('never leaves its folder', async () => {
        await expect(store.put('../../escape', PNG)).rejects.toThrow()
        await expect(store.get('..\\..\\escape')).rejects.toThrow()
    })
})

describe('FilesService', () => {
    const dir = mkdtempSync(join(tmpdir(), 'files-service-'))
    const files = new FilesService(new MemoryFileIndex(), new LocalFileStore(dir))
    const a = randomUUID()
    const b = randomUUID()
    const author = randomUUID()
    afterAll(() => rmSync(dir, { recursive: true, force: true }))

    const errorKey = async (promise: Promise<unknown>) => {
        const error = await promise.then(
            () => null,
            (caught: unknown) => caught
        )
        expect(error).toBeInstanceOf(AppException)
        return (error as AppException).key
    }

    it('saves a file with the type read from its bytes; the same file again changes nothing', async () => {
        const id = randomUUID()
        const info = await files.put(a, author, id, 'logo.png', PNG)
        expect(info).toMatchObject({
            id,
            name: 'logo.png',
            contentType: 'image/png',
            size: PNG.length,
            createdBy: author
        })
        expect(await files.put(a, author, id, 'other name', PNG)).toEqual(info)
        expect((await files.open(a, id)).data).toEqual(PNG)
        expect((await files.list(a)).map(file => file.id)).toEqual([id])
    })

    it('refuses other content under the same id, an empty or too large file and anything but JPEG, PNG, WebP or PDF', async () => {
        const id = randomUUID()
        await files.put(a, author, id, '', PNG)
        expect(await errorKey(files.put(a, author, id, '', Buffer.from('%PDF-1.4')))).toBe('errors.CONFLICT')
        expect(await errorKey(files.put(a, author, randomUUID(), '', Buffer.alloc(0)))).toBe('errors.FILE_EMPTY')
        const large = Buffer.concat([PNG, Buffer.alloc(MAX_FILE_BYTES)])
        expect(await errorKey(files.put(a, author, randomUUID(), '', large))).toBe('errors.FILE_TOO_LARGE')
        expect(await errorKey(files.put(a, author, randomUUID(), '', Buffer.from('<svg></svg>')))).toBe(
            'errors.FILE_TYPE_NOT_ALLOWED'
        )
    })

    it('another organisation never sees, opens or removes the file', async () => {
        const id = randomUUID()
        await files.put(a, author, id, '', PNG)
        expect((await files.list(b)).map(file => file.id)).not.toContain(id)
        expect(await errorKey(files.open(b, id))).toBe('errors.FILE_NOT_FOUND')
        expect(await errorKey(files.remove(b, id))).toBe('errors.FILE_NOT_FOUND')
        await files.remove(a, id)
        expect(await errorKey(files.open(a, id))).toBe('errors.FILE_NOT_FOUND')
        expect(existsSync(join(dir, a, id))).toBe(false)
    })
})
