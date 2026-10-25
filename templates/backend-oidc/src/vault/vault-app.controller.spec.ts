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

const credentials = vi.fn(async (input: Record<string, string>) => ({ seen: input }))

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
            providers: [{ provide: VaultAppService, useValue: { credentials } }]
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
            accessToken: 'a-long-enough-token'
        })
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
