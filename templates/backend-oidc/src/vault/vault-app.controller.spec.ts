import { fileURLToPath } from 'node:url'
import type { INestApplication } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { Test } from '@nestjs/testing'
import { AcceptLanguageResolver, I18nModule } from 'nestjs-i18n'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { configureApp } from '../setup.js'
import { VaultAppController } from './vault-app.controller.js'
import { VaultAppService } from './vault-app.service.js'

const credentials = vi.fn(async (input: Record<string, string | null>) => ({ seen: input }))
const doctors = vi.fn(async (input: Record<string, string>) => [{ seen: input }])

describe('POST /vault/credentials', () => {
    let app: INestApplication

    beforeAll(async () => {
        const moduleRef = await Test.createTestingModule({
            imports: [
                ConfigModule.forRoot({ isGlobal: true }),
                I18nModule.forRoot({
                    fallbackLanguage: 'en',
                    loaderOptions: { path: fileURLToPath(new URL('../i18n', import.meta.url)), watch: false },
                    resolvers: [AcceptLanguageResolver]
                })
            ],
            controllers: [VaultAppController],
            providers: [{ provide: VaultAppService, useValue: { credentials, doctors } }]
        }).compile()
        app = moduleRef.createNestApplication()
        configureApp(app)
        await app.init()
    })

    afterAll(async () => {
        await app.close()
    })

    const basic = (id: string, secret: string) => 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64')
    const post = () => request(app.getHttpServer()).post('/vault/credentials')

    it('reads the client id and secret from Basic auth and never lets the answer be cached', async () => {
        const response = await post()
            .set('Authorization', basic('dossier-app', 's:e+c/ret'))
            .send({ accessToken: 'a-long-enough-token' })
            .expect(200)
        expect(response.headers['cache-control']).toBe('no-store')
        expect(response.body.seen).toMatchObject({
            clientId: 'dossier-app',
            clientSecret: 's:e+c/ret',
            accessToken: 'a-long-enough-token',
            doctorId: null
        })
    })

    it('passes the doctor whose certificate the secretariat asks for, only as a uuid', async () => {
        const doctorId = '6f1c2a8e-3b4d-4e5f-9a7b-1c2d3e4f5a6b'
        const response = await post()
            .set('Authorization', basic('dossier-app', 'secret'))
            .send({ accessToken: 'a-long-enough-token', doctorId })
            .expect(200)
        expect(response.body.seen.doctorId).toBe(doctorId)
        await post()
            .set('Authorization', basic('dossier-app', 'secret'))
            .send({ accessToken: 'a-long-enough-token', doctorId: 'not-a-uuid' })
            .expect(400)
    })

    it('POST /vault/doctors: the doctors the account may use, with the same Basic auth', async () => {
        const response = await request(app.getHttpServer())
            .post('/vault/doctors')
            .set('Authorization', basic('dossier-app', 'secret'))
            .send({ accessToken: 'a-long-enough-token' })
            .expect(200)
        expect(response.headers['cache-control']).toBe('no-store')
        expect(response.body[0].seen).toMatchObject({ clientId: 'dossier-app', accessToken: 'a-long-enough-token' })
        doctors.mockClear()
        await request(app.getHttpServer())
            .post('/vault/doctors')
            .send({ accessToken: 'a-long-enough-token' })
            .expect(401)
        expect(doctors).not.toHaveBeenCalled()
    })

    it('refuses a missing or broken Authorization header without asking the service', async () => {
        credentials.mockClear()
        for (const header of [
            undefined,
            'Bearer abc',
            'Basic !!!',
            'Basic ' + Buffer.from('nocolon').toString('base64')
        ]) {
            const req = post()
            if (header) req.set('Authorization', header)
            const response = await req.send({ accessToken: 'a-long-enough-token' })
            expect(response.status).toBe(401)
            expect(response.body.error).toBe('oidc.VAULT_APP_UNAUTHORIZED')
        }
        expect(credentials).not.toHaveBeenCalled()
    })

    it('needs the access token of the doctor in the body', async () => {
        await post().set('Authorization', basic('dossier-app', 'x')).send({}).expect(400)
    })
})
