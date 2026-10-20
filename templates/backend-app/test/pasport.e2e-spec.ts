import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { AppModule } from '../src/app.module.js'
import { DatabaseService } from '../src/database/database.service.js'
import { MemoryNotesStore } from '../src/notes/memory-notes.store.js'
import { NOTES_STORE } from '../src/notes/notes.store.js'
import { PasportKeys } from '../src/pasport/pasport-keys.service.js'
import { configureApp } from '../src/setup.js'
import { accessToken, AUDIENCE, CLIENT_ID, ISSUER, OTHER_KEY, PRODUCT, TENANT_A, TENANT_B, testKeys } from './token.js'

process.env.OIDC_ISSUER = ISSUER
process.env.OIDC_AUDIENCE = AUDIENCE
process.env.OIDC_CLIENT_IDS = CLIENT_ID
process.env.OIDC_PRODUCT = PRODUCT

/**
 * The login through the login server (Pasport): only its access tokens open the API, and every organisation only
 * sees its own notes. The keys of the login server are a test key; the notes live in memory.
 */
describe('Pasport access tokens and notes per organisation (e2e)', () => {
    let app: INestApplication
    const http = () => request(app.getHttpServer())
    const bearer = (token: string) => ({ Authorization: 'Bearer ' + token })

    beforeAll(async () => {
        const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
            .overrideProvider(DatabaseService)
            .useValue({ ping: vi.fn().mockResolvedValue(true), query: vi.fn() })
            .overrideProvider(PasportKeys)
            .useValue(testKeys)
            .overrideProvider(NOTES_STORE)
            .useValue(new MemoryNotesStore())
            .compile()
        app = moduleRef.createNestApplication()
        configureApp(app)
        await app.init()
    })

    afterAll(async () => {
        await app.close()
    })

    it('public routes need no token', async () => {
        await http().get('/health').expect(200)
    })

    it.each([
        ['no token', undefined],
        ['not a bearer token', 'Basic abc'],
        ['another issuer', 'Bearer ' + accessToken({ iss: 'http://evil.test/oidc' })],
        ['another audience', 'Bearer ' + accessToken({ aud: 'http://other-api.test' })],
        ['another app', 'Bearer ' + accessToken({ client_id: 'someone-else' })],
        ['expired', 'Bearer ' + accessToken({ exp: Math.floor(Date.now() / 1000) - 120 })],
        ['an ID token instead of an access token', 'Bearer ' + accessToken({}, { header: { typ: 'JWT' } })],
        ['an unknown key', 'Bearer ' + accessToken({}, { header: { kid: 'other' } })],
        ['a forged signature', 'Bearer ' + accessToken({}, { key: OTHER_KEY })],
        ['alg none', 'Bearer ' + accessToken({}, { header: { alg: 'none' } })]
    ])('refuses %s with a translated 401', async (_name, authorization) => {
        const response = await http()
            .get('/notes')
            .set(authorization ? { Authorization: authorization } : {})
            .set('Accept-Language', 'nl')
            .expect(401)
        expect(response.body).toMatchObject({ error: 'errors.UNAUTHORIZED', message: 'Je bent niet ingelogd' })
    })

    it('GET /me answers from the token, also without an organisation', async () => {
        const sub = '33333333-3333-4333-8333-333333333333'
        const response = await http()
            .get('/me')
            .set(bearer(accessToken({ sub, tenant: undefined, superadmin: true, license: undefined })))
            .expect(200)
        expect(response.body).toEqual({ sub, tenant: null, superadmin: true, license: null })
        const ends = Math.floor(Date.parse('2026-11-03T08:00:00Z') / 1000)
        const trial = await http()
            .get('/me')
            .set(bearer(accessToken({ license: { product: PRODUCT, status: 'trial', ends_at: ends } })))
            .expect(200)
        expect(trial.body.license).toEqual({ product: PRODUCT, status: 'trial', endsAt: '2026-11-03T08:00:00.000Z' })
        // Without a licence /me still answers: the frontend shows what to do
        const none = await http()
            .get('/me')
            .set(bearer(accessToken({ license: { product: PRODUCT, status: 'none' } })))
            .expect(200)
        expect(none.body.license).toEqual({ product: PRODUCT, status: 'none', endsAt: null })
    })

    it.each([
        ['no licence', { product: PRODUCT, status: 'none' }],
        ['no licence claim', undefined],
        ['a licence of another product', { product: 'reports', status: 'seat' }],
        ['a claim of an unexpected shape', { product: PRODUCT, status: 'gold' }]
    ])('refuses the data with %s, translated', async (_name, license) => {
        const response = await http()
            .get('/notes')
            .set(bearer(accessToken({ license })))
            .set('Accept-Language', 'nl')
            .expect(403)
        expect(response.body.error).toBe('errors.NO_LICENSE')
        expect(response.body.message).toContain(PRODUCT)
    })

    it.each(['trial', 'seat', 'superadmin'])('a %s licence opens the data', async status => {
        await http()
            .get('/notes')
            .set(bearer(accessToken({ license: { product: PRODUCT, status } })))
            .expect(200)
    })

    it('notes need an organisation', async () => {
        const response = await http()
            .get('/notes')
            .set(bearer(accessToken({ tenant: undefined })))
            .expect(403)
        expect(response.body.error).toBe('errors.NO_ORGANISATION')
    })

    it('every organisation only sees its own notes', async () => {
        const a = bearer(accessToken({ tenant: TENANT_A }))
        const b = bearer(accessToken({ tenant: TENANT_B }))
        await http().post('/notes').set(a).send({ text: 'Van praktijk A' }).expect(201)
        await http().post('/notes').set(b).send({ text: 'Van praktijk B' }).expect(201)
        const listA = await http().get('/notes').set(a).expect(200)
        const listB = await http().get('/notes').set(b).expect(200)
        expect(listA.body.map((note: { text: string }) => note.text)).toEqual(['Van praktijk A'])
        expect(listB.body.map((note: { text: string }) => note.text)).toEqual(['Van praktijk B'])
    })

    it('validates the note, in the language of the request', async () => {
        const response = await http()
            .post('/notes')
            .set(bearer(accessToken()))
            .set('Accept-Language', 'nl')
            .send({ text: '' })
            .expect(400)
        expect(response.body.error).toBe('errors.BAD_REQUEST')
    })

    it('only the beheerder (admin) removes a note, and only one of the own organisation', async () => {
        const admin = bearer(accessToken({ tenant: TENANT_A }))
        const member = bearer(accessToken({ tenant: { ...TENANT_A, role: 'user' } }))
        const otherAdmin = bearer(accessToken({ tenant: { ...TENANT_B, role: 'admin' } }))
        const note = (await http().post('/notes').set(member).send({ text: 'Weg ermee' }).expect(201)).body as {
            id: string
        }
        expect(
            (
                await http()
                    .delete('/notes/' + note.id)
                    .set(member)
                    .expect(403)
            ).body.error
        ).toBe('errors.FORBIDDEN')
        const foreign = await http()
            .delete('/notes/' + note.id)
            .set(otherAdmin)
            .expect(404)
        expect(foreign.body.error).toBe('errors.NOTE_NOT_FOUND')
        await http()
            .delete('/notes/' + note.id)
            .set(admin)
            .expect(204)
    })
})
