import test from 'node:test'
import assert from 'node:assert/strict'
import { LOCALES } from '../src/backends/nestjs.js'
import {
    postgres,
    slugify,
    validators,
    envLines,
    dockerCompose,
    databaseFiles,
    scriptsFor,
    ERRORS,
    DOCKER_IMAGE,
    DEFAULT_PORT
} from '../src/databases/postgres.js'
import { databases } from '../src/databases/index.js'
import { dockerVolume, dockerVolumeExists, emptyDatabase, localTables } from '../src/databases/existing.js'

const DB = {
    id: 'postgres',
    mode: 'docker',
    host: 'localhost',
    port: 5433,
    user: 'app',
    password: 'p@ss w0rd#1',
    database: 'demo',
    project: 'demo'
}

/** Prompts that answer from a script, and remember every question. */
function scripted(answers) {
    const asked = []
    const next = type => async config => {
        asked.push({ type, ...config })
        const value = answers[config.message]
        if (value === undefined) throw new Error(`unexpected question: ${config.message}`)
        if (config.validate) assert.equal(await config.validate(value), true, `valid answer for ${config.message}`)
        return value
    }
    return { asked, prompts: { select: next('select'), input: next('input'), password: next('password') } }
}

test('PostgreSQL is registered and is the only database for now', () => {
    assert.deepEqual(Object.keys(databases), ['postgres'])
    assert.equal(databases.postgres, postgres)
    assert.equal(postgres.label, 'PostgreSQL')
})

test('the project folder name becomes a safe database and compose name', () => {
    assert.equal(slugify('My Project'), 'my_project')
    assert.equal(slugify('DafkeDD-test.v2'), 'dafkedd_test_v2')
    assert.equal(slugify('123abc'), 'app_123abc')
    assert.equal(slugify('***'), 'app')
})

test('validators accept good values and reject bad ones', () => {
    assert.equal(validators.port('5432'), true)
    for (const bad of ['0', '70000', 'abc', '54 32', '']) assert.notEqual(validators.port(bad), true, bad)
    assert.equal(validators.identifier('my_db1'), true)
    for (const bad of ['1abc', 'my-db', 'a b', '', 'x;drop']) assert.notEqual(validators.identifier(bad), true, bad)
    assert.equal(validators.host('localhost'), true)
    assert.equal(validators.host('db.example.com'), true)
    assert.equal(validators.host('192.168.1.10'), true)
    for (const bad of ['', 'a b', '-x', 'x_y']) assert.notEqual(validators.host(bad), true, bad)
    assert.equal(validators.password('p@ss w0rd#1'), true)
    assert.notEqual(validators.password(''), true)
    assert.notEqual(validators.password("it's"), true, 'a single quote would break the .env value')
})

/** No database of earlier (no Docker volume, no tables): the CLI asks nothing more. */
const FRESH = { localTables: async () => null, dockerVolumeExists: async () => false }

test('a local database of earlier with tables: another name, empty it, or keep it', async () => {
    const answers = {
        'Hoe draait PostgreSQL?': 'local',
        'Host van de database:': 'localhost',
        'Poort van de database:': '5432',
        'Gebruikersnaam:': 'postgres',
        'Wachtwoord:': 'secret',
        'Databasenaam:': 'shop'
    }
    // The first name has tables, the second one not: "another name" asks the name again (default with _2)
    const seen = []
    const inspect = {
        localTables: async db => (seen.push(db.database), db.database === 'shop' ? 12 : null),
        dockerVolumeExists: async () => false
    }
    let names = 0
    const rename = scripted({ ...answers })
    const base = rename.prompts
    const prompts = {
        ...base,
        input: async config => {
            if (config.message === 'Databasenaam:' && names++ === 1) {
                assert.equal(config.default, 'shop_2')
                return 'shop_new'
            }
            return base.input(config)
        },
        select: async config => {
            if (config.message.includes('bestaat al')) {
                assert.match(config.message, /"shop"/)
                assert.deepEqual(
                    config.choices.map(choice => choice.value),
                    ['rename', 'reset', 'keep']
                )
                return 'rename'
            }
            return base.select(config)
        }
    }
    const renamed = await postgres.ask({ projectDir: '/work/shop', prompts, inspect })
    assert.equal(renamed.database, 'shop_new')
    assert.ok(!('reset' in renamed))
    assert.deepEqual(seen, ['shop', 'shop_new'])

    for (const [choice, reset] of [
        ['reset', true],
        ['keep', false]
    ]) {
        const { prompts: base2 } = scripted({ ...answers })
        const result = await postgres.ask({
            projectDir: '/work/shop',
            prompts: {
                ...base2,
                select: async config => (config.message.includes('bestaat al') ? choice : base2.select(config))
            },
            inspect
        })
        assert.equal(result.database, 'shop')
        assert.equal(result.reset === true, reset, choice)
    }
})

test('a Docker volume of earlier: empty it or keep it (no other name: the volume belongs to the project)', async () => {
    const { prompts: base } = scripted({
        'Hoe draait PostgreSQL?': 'docker',
        'Poort op je machine:': '5432',
        'Gebruikersnaam:': 'postgres',
        'Wachtwoord:': 'x',
        'Databasenaam:': 'shop'
    })
    let question = null
    const result = await postgres.ask({
        projectDir: '/work/shop',
        prompts: {
            ...base,
            select: async config => {
                if (!config.message.includes('bestaat al')) return base.select(config)
                question = config
                return 'reset'
            }
        },
        inspect: { localTables: async () => null, dockerVolumeExists: async project => project === 'shop' }
    })
    assert.deepEqual(
        question.choices.map(choice => choice.value),
        ['reset', 'keep']
    )
    assert.equal(result.reset, true)
})

test('existing.js: the tables of a database, the Docker volume, and emptying both', async () => {
    const queries = []
    const fake = (tables, { fail = false } = {}) =>
        class {
            constructor(config) {
                this.config = config
            }
            async connect() {
                if (fail) throw Object.assign(new Error('no db'), { code: '3D000' })
            }
            async query(sql) {
                queries.push([this.config.database, sql])
                return { rows: [{ tables }] }
            }
            async end() {}
        }
    const db = {
        mode: 'local',
        host: 'localhost',
        port: 5432,
        user: 'u',
        password: 'p',
        database: 'shop',
        project: 'shop'
    }
    assert.equal(await localTables(db, { Client: fake(3) }), 3)
    assert.equal(await localTables(db, { Client: fake(3, { fail: true }) }), null, 'not there: nothing to warn about')
    await emptyDatabase(db, { Client: fake(0) })
    assert.deepEqual(queries.at(-1), ['postgres', 'DROP DATABASE IF EXISTS "shop" WITH (FORCE)'])

    const calls = []
    const exec = async (cmd, args) => {
        calls.push([cmd, ...args].join(' '))
        if (args[0] === 'volume' && args[1] === 'inspect' && args[2] !== 'shop_postgres-data') throw new Error('none')
        return args[0] === 'ps' ? 'abc\ndef\n' : ''
    }
    assert.equal(dockerVolume('shop'), 'shop_postgres-data')
    assert.equal(await dockerVolumeExists('shop', { exec }), true)
    assert.equal(await dockerVolumeExists('other', { exec }), false)
    await emptyDatabase({ ...db, mode: 'docker' }, { exec })
    assert.deepEqual(calls.slice(-3), [
        'docker ps -aq --filter label=com.docker.compose.project=shop',
        'docker rm -f abc def',
        'docker volume rm -f shop_postgres-data'
    ])
})

test('ask (Docker): asks mode, port, user, password and database; the host is always localhost', async () => {
    const { prompts, asked } = scripted({
        'Hoe draait PostgreSQL?': 'docker',
        'Poort op je machine:': '5433',
        'Gebruikersnaam:': 'app',
        'Wachtwoord:': 'secret',
        'Databasenaam:': 'demo'
    })
    const result = await postgres.ask({ projectDir: '/work/My Project', prompts, inspect: FRESH })
    assert.deepEqual(result, {
        id: 'postgres',
        mode: 'docker',
        host: 'localhost',
        port: 5433,
        user: 'app',
        password: 'secret',
        database: 'demo',
        project: 'my_project'
    })
    assert.ok(!asked.some(q => q.message.includes('Host')), 'Docker never asks for a host')
})

test('ask (local): also asks for the host', async () => {
    const { prompts } = scripted({
        'Hoe draait PostgreSQL?': 'local',
        'Host van de database:': ' db.local ',
        'Poort van de database:': '5432',
        'Gebruikersnaam:': 'postgres',
        'Wachtwoord:': 'secret',
        'Databasenaam:': 'demo'
    })
    const result = await postgres.ask({ projectDir: '/work/demo', prompts, inspect: FRESH })
    assert.equal(result.host, 'db.local')
    assert.equal(result.mode, 'local')
    assert.equal(result.port, 5432)
})

test('ask has sensible defaults (port 5432, user postgres, database named after the folder) and masks the password', async () => {
    const { prompts, asked } = scripted({
        'Hoe draait PostgreSQL?': 'docker',
        'Poort op je machine:': '5432',
        'Gebruikersnaam:': 'postgres',
        'Wachtwoord:': 'x',
        'Databasenaam:': 'my_project'
    })
    await postgres.ask({ projectDir: '/work/My Project', prompts, inspect: FRESH })
    const byMessage = Object.fromEntries(asked.map(q => [q.message, q]))
    assert.equal(byMessage['Poort op je machine:'].default, String(DEFAULT_PORT))
    assert.equal(byMessage['Gebruikersnaam:'].default, 'postgres')
    assert.equal(byMessage['Databasenaam:'].default, 'my_project')
    assert.equal(byMessage['Wachtwoord:'].type, 'password')
    assert.equal(byMessage['Wachtwoord:'].mask, '*')
    assert.equal(byMessage['Wachtwoord:'].default, undefined, 'no default password')
})

test('the .env lines hold every setting; .env.example never holds the real password', () => {
    const env = envLines(DB)
    assert.match(env, /DATABASE_HOST=localhost/)
    assert.match(env, /DATABASE_PORT=5433/)
    assert.match(env, /DATABASE_USER=app/)
    assert.ok(env.includes("DATABASE_PASSWORD='p@ss w0rd#1'"), 'single quotes keep special characters literal')
    assert.match(env, /DATABASE_NAME=demo/)
    const example = envLines(DB, { showPassword: false })
    assert.ok(!example.includes('p@ss'))
    assert.match(example, /DATABASE_PASSWORD='change-me'/)
})

test('docker-compose.yml reads everything from .env and keeps the data in a volume', () => {
    const compose = dockerCompose(DB)
    assert.match(compose, /^name: demo$/m)
    assert.ok(compose.includes(`image: ${DOCKER_IMAGE}`))
    for (const key of ['DATABASE_USER', 'DATABASE_PASSWORD', 'DATABASE_NAME', 'DATABASE_PORT']) {
        assert.ok(compose.includes('${' + key + '}'), key)
    }
    assert.ok(!compose.includes('p@ss'), 'the password is never written into the compose file')
    assert.match(compose, /'\$\{DATABASE_PORT\}:5432'/)
    assert.match(compose, /postgres-data:\/var\/lib\/postgresql\/data/)
    assert.match(compose, /healthcheck/)
})

test('scripts: db:check always, Docker scripts only for Docker', () => {
    assert.ok(scriptsFor(DB)['db:check'])
    assert.equal(scriptsFor(DB)['db:up'], 'docker compose up -d --wait')
    assert.ok(scriptsFor(DB)['db:down'])
    const local = scriptsFor({ ...DB, mode: 'local' })
    assert.ok(local['db:check'])
    assert.ok(!('db:up' in local))
})

test('backend(): Docker gets a compose file, local does not; both get the driver code', () => {
    const docker = postgres.backend(DB)
    assert.ok('docker-compose.yml' in docker.files)
    const local = postgres.backend({ ...DB, mode: 'local' })
    assert.ok(!('docker-compose.yml' in local.files))
    for (const set of [docker, local]) {
        assert.deepEqual(set.dependencies, ['pg@latest'])
        assert.deepEqual(set.devDependencies, ['@types/pg@latest'])
        assert.ok('src/database/database.service.ts' in set.files)
    }
})

test('the database service reads its settings from the config and never from hard-coded values', () => {
    const service = databaseFiles['src/database/database.service.ts']
    for (const key of ['DATABASE_HOST', 'DATABASE_PORT', 'DATABASE_USER', 'DATABASE_PASSWORD', 'DATABASE_NAME']) {
        assert.ok(service.includes(key), key)
    }
    assert.match(service, /onModuleDestroy/)
    assert.match(service, /async ping\(\)/)
    assert.ok(!/typeorm|prisma|sequelize|mikro-orm/i.test(Object.values(databaseFiles).join('\n')), 'no ORM')
})

test('the connection check script loads .env and exits with an error code on failure', () => {
    const script = databaseFiles['scripts/db-check.mjs']
    assert.match(script, /loadEnvFile/)
    assert.match(script, /process\.exit\(1\)/)
})

test('the database error is translated in nl, fr, en and de', () => {
    assert.deepEqual(Object.keys(ERRORS).sort(), [...LOCALES].sort())
    for (const locale of LOCALES) {
        assert.deepEqual(Object.keys(ERRORS[locale]), ['DATABASE_UNAVAILABLE'])
        assert.ok(ERRORS[locale].DATABASE_UNAVAILABLE.trim())
    }
})

test('the connection check creates the database when it does not exist yet (error 3D000), via the postgres database', () => {
    const script = databaseFiles['scripts/db-check.mjs']
    assert.match(script, /3D000/)
    assert.match(script, /connect\('postgres'\)/)
    assert.match(script, /CREATE DATABASE/)
    assert.match(script, /replaceAll\('"', '""'\)/, 'the name is quoted safely')
    assert.match(script, /Created database/)
})

test('the database name is limited to 50 characters, so "<name>users" fits the 63 characters of PostgreSQL', () => {
    assert.equal(validators.databaseName('shop'), true)
    assert.equal(validators.databaseName('x'.repeat(50)), true)
    assert.notEqual(validators.databaseName('x'.repeat(51)), true)
    assert.notEqual(validators.databaseName('my-db'), true)
})
