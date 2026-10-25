import { ConfigService } from '@nestjs/config'
import { DatabaseService } from './database.service.js'

describe('DatabaseService', () => {
    // Nothing listens on port 1, so the connection is refused straight away.
    const unreachable = () =>
        new DatabaseService(
            new ConfigService({
                DATABASE_HOST: '127.0.0.1',
                DATABASE_PORT: '1',
                DATABASE_USER: 'user',
                DATABASE_PASSWORD: 'secret',
                DATABASE_NAME: 'db'
            })
        )

    it('reports an unreachable database as down instead of throwing', async () => {
        const database = unreachable()
        await expect(database.ping()).resolves.toBe(false)
        await database.onModuleDestroy()
    })

    it('rejects queries when the database is unreachable', async () => {
        const database = unreachable()
        await expect(database.query('SELECT 1')).rejects.toThrow()
        await database.onModuleDestroy()
    })
})
