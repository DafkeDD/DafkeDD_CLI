import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { AppModule } from '../src/app.module.js'
import { DatabaseService } from '../src/database/database.service.js'
import { FILE_INDEX } from '../src/files/file-index.js'
import { FILE_STORE } from '../src/files/file-store.js'
import { LocalFileStore } from '../src/files/local-file-store.js'
import { MemoryFileIndex } from '../src/files/memory-file-index.js'
import { PasportKeys } from '../src/pasport/pasport-keys.service.js'
import { configureApp } from '../src/setup.js'
import { accessToken, AUDIENCE, CLIENT_ID, ISSUER, PRODUCT, TENANT_B, testKeys } from './token.js'

process.env.OIDC_ISSUER = ISSUER
process.env.OIDC_AUDIENCE = AUDIENCE
process.env.OIDC_CLIENT_IDS = CLIENT_ID
process.env.OIDC_PRODUCT = PRODUCT

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])

/** Uploading and downloading files over HTTP: the descriptions in memory, the bytes in a folder of the test. */
describe('files of the organisation (e2e)', () => {
    let app: INestApplication
    const dir = mkdtempSync(join(tmpdir(), 'files-e2e-'))
    const http = () => request(app.getHttpServer())
    const editor = { Authorization: 'Bearer ' + accessToken({ roles: ['editor'] }) }
    const viewer = { Authorization: 'Bearer ' + accessToken({ roles: ['viewer'] }) }
    const other = { Authorization: 'Bearer ' + accessToken({ tenant: TENANT_B, roles: ['editor'] }) }

    beforeAll(async () => {
        const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
            .overrideProvider(DatabaseService)
            .useValue({ ping: vi.fn().mockResolvedValue(true), query: vi.fn() })
            .overrideProvider(PasportKeys)
            .useValue(testKeys)
            .overrideProvider(FILE_INDEX)
            .useValue(new MemoryFileIndex())
            .overrideProvider(FILE_STORE)
            .useValue(new LocalFileStore(dir))
            .compile()
        app = moduleRef.createNestApplication()
        configureApp(app)
        await app.init()
    })

    afterAll(async () => {
        await app.close()
        rmSync(dir, { recursive: true, force: true })
    })

    it('an editor uploads the raw file; it comes back with its type, name and an ETag (then 304)', async () => {
        const id = randomUUID()
        const saved = await http()
            .put(`/files/${id}?name=logo.png`)
            .set(editor)
            .set('Content-Type', 'application/octet-stream')
            .send(PNG)
            .expect(200)
        expect(saved.body).toMatchObject({ id, name: 'logo.png', contentType: 'image/png', size: PNG.length })
        const file = await http().get(`/files/${id}`).set(viewer).buffer(true).expect(200)
        expect(file.headers['content-type']).toBe('image/png')
        expect(file.headers['content-disposition']).toBe("inline; filename*=UTF-8''logo.png")
        expect(file.headers['x-content-type-options']).toBe('nosniff')
        expect(Buffer.compare(file.body as Buffer, PNG)).toBe(0)
        await http().get(`/files/${id}`).set(viewer).set('If-None-Match', file.headers.etag!).expect(304)
        const list = await http().get('/files').set(viewer).expect(200)
        expect(list.body.map((info: { id: string }) => info.id)).toContain(id)
    })

    it('refuses what is not an accepted file, with a translated message', async () => {
        const svg = await http()
            .put(`/files/${randomUUID()}`)
            .set(editor)
            .set('Content-Type', 'image/svg+xml')
            .set('Accept-Language', 'nl')
            .send(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))
            .expect(415)
        expect(svg.body.error).toBe('errors.FILE_TYPE_NOT_ALLOWED')
        expect(svg.body.message).not.toBe('errors.FILE_TYPE_NOT_ALLOWED')
        // JSON is never a file
        await http().put(`/files/${randomUUID()}`).set(editor).send({ a: 1 }).expect(415)
    })

    it('a viewer cannot save or remove, another organisation never sees the file', async () => {
        const id = randomUUID()
        await http().put(`/files/${id}`).set(editor).set('Content-Type', 'image/png').send(PNG).expect(200)
        await http().put(`/files/${randomUUID()}`).set(viewer).set('Content-Type', 'image/png').send(PNG).expect(403)
        await http().delete(`/files/${id}`).set(viewer).expect(403)
        await http().get(`/files/${id}`).set(other).expect(404)
        await http().delete(`/files/${id}`).set(other).expect(404)
        await http().delete(`/files/${id}`).set(editor).expect(204)
        await http().get(`/files/${id}`).set(editor).expect(404)
    })

    it('only takes a uuid as the id of a file', async () => {
        await http().put('/files/..%2F..%2Fetc').set(editor).set('Content-Type', 'image/png').send(PNG).expect(400)
    })
})
