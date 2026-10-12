import { basename } from 'node:path'
import { input, password, select } from '@inquirer/prompts'

export const DEFAULT_PORT = 5432
export const DOCKER_IMAGE = 'postgres:17-alpine'

/** Characters that are safe in a user name, database name or host name. */
export const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/
export const HOST_PATTERN = /^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$/

/** Turns a folder name into a name that is valid for a Docker Compose project and a PostgreSQL database. */
export const slugify = name => {
    const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
    if (!slug) return 'app'
    return /^[a-z]/.test(slug) ? slug : `app_${slug}`
}

export const validators = {
    identifier: v =>
        IDENTIFIER_PATTERN.test(v.trim()) || 'Gebruik enkel letters, cijfers en underscores (begin met een letter)',
    host: v => HOST_PATTERN.test(v.trim()) || 'Geef een geldige hostnaam of IP-adres op',
    port: v => {
        const value = v.trim()
        return (/^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 65535) || 'Geef een poort van 1 tot 65535'
    },
    password: v => {
        if (!v) return 'Een wachtwoord is verplicht'
        if (/['\u0000-\u001f]/.test(v)) return "Gebruik geen apostrof (') of speciale stuurtekens"
        return true
    }
}

// Translations of the extra server error. Every language needs the same keys (checked by the tests).
export const ERRORS = {
    en: { DATABASE_UNAVAILABLE: 'The database is not available' },
    nl: { DATABASE_UNAVAILABLE: 'De database is niet beschikbaar' },
    fr: { DATABASE_UNAVAILABLE: "La base de données n'est pas disponible" },
    de: { DATABASE_UNAVAILABLE: 'Die Datenbank ist nicht erreichbar' }
}

const quoteEnv = value => `'${value}'`

/** The environment variables of the database, as .env lines. `showPassword: false` is used for .env.example. */
export function envLines(db, { showPassword = true } = {}) {
    return [
        '',
        `# Database (PostgreSQL, ${db.mode === 'docker' ? 'runs in Docker: npm run db:up' : 'runs on your machine'})`,
        `DATABASE_HOST=${db.host}`,
        `DATABASE_PORT=${db.port}`,
        `DATABASE_USER=${db.user}`,
        `DATABASE_PASSWORD=${quoteEnv(showPassword ? db.password : 'change-me')}`,
        `DATABASE_NAME=${db.database}`,
        ''
    ].join('\n')
}

export const dockerCompose = db => `name: ${db.project}

services:
  postgres:
    image: ${DOCKER_IMAGE}
    restart: unless-stopped
    environment:
      POSTGRES_USER: \${DATABASE_USER}
      POSTGRES_PASSWORD: \${DATABASE_PASSWORD}
      POSTGRES_DB: \${DATABASE_NAME}
    ports:
      - '\${DATABASE_PORT}:5432'
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U \${DATABASE_USER} -d \${DATABASE_NAME}']
      interval: 5s
      timeout: 5s
      retries: 10

volumes:
  postgres-data:
`

/** Plain PostgreSQL driver (pg), no ORM: queries are written by hand. */
export const databaseFiles = {
    'src/database/database.service.ts': `import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import pg from 'pg';

/** Thin wrapper around a pg connection pool. The settings come from .env (DATABASE_*). */
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool: pg.Pool;

  constructor(config: ConfigService) {
    this.pool = new pg.Pool({
      host: config.get<string>('DATABASE_HOST'),
      port: Number(config.get<string>('DATABASE_PORT')),
      user: config.get<string>('DATABASE_USER'),
      password: config.get<string>('DATABASE_PASSWORD'),
      database: config.get<string>('DATABASE_NAME'),
      connectionTimeoutMillis: 3000,
    });
    // An idle client that loses its connection must not crash the process.
    this.pool.on('error', () => undefined);
  }

  query<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params?: unknown[]) {
    return this.pool.query<T>(text, params);
  }

  /** True when the database answers. Never throws. */
  async ping(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
`,

    'src/database/database.module.ts': `import { Global, Module } from '@nestjs/common';
import { DatabaseService } from './database.service.js';

@Global()
@Module({
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule {}
`,

    'src/database/database.service.spec.ts': `import { ConfigService } from '@nestjs/config';
import { DatabaseService } from './database.service.js';

describe('DatabaseService', () => {
  // Nothing listens on port 1, so the connection is refused straight away.
  const unreachable = () =>
    new DatabaseService(
      new ConfigService({
        DATABASE_HOST: '127.0.0.1',
        DATABASE_PORT: '1',
        DATABASE_USER: 'user',
        DATABASE_PASSWORD: 'secret',
        DATABASE_NAME: 'db',
      }),
    );

  it('reports an unreachable database as down instead of throwing', async () => {
    const database = unreachable();
    await expect(database.ping()).resolves.toBe(false);
    await database.onModuleDestroy();
  });

  it('rejects queries when the database is unreachable', async () => {
    const database = unreachable();
    await expect(database.query('SELECT 1')).rejects.toThrow();
    await database.onModuleDestroy();
  });
});
`,

    'src/health/health.controller.ts': `import { Controller, Get, HttpStatus } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AppException } from '../common/app.exception.js';
import { DatabaseService } from '../database/database.service.js';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly database: DatabaseService) {}

  /** 200 when the API and the database work, a translated 503 when the database is down. */
  @Get()
  async check() {
    if (!(await this.database.ping())) {
      throw new AppException('errors.DATABASE_UNAVAILABLE', HttpStatus.SERVICE_UNAVAILABLE);
    }
    return { status: 'ok', database: 'up' };
  }
}
`,

    'scripts/db-check.mjs': `// Checks that the database from .env can be reached: npm run db:check
import pg from 'pg';

try {
  process.loadEnvFile();
} catch {
  // no .env file: use the environment as it is
}

const client = new pg.Client({
  host: process.env.DATABASE_HOST,
  port: Number(process.env.DATABASE_PORT),
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME,
  connectionTimeoutMillis: 5000,
});

try {
  await client.connect();
  const { rows } = await client.query('SELECT version() AS version');
  console.log('Connected: ' + rows[0].version);
  await client.end();
} catch (error) {
  console.error('Could not connect to the database: ' + (error instanceof Error ? error.message : String(error)));
  process.exit(1);
}
`
}

export const scriptsFor = db => ({
    'db:check': 'node scripts/db-check.mjs',
    ...(db.mode === 'docker'
        ? {
              'db:up': 'docker compose up -d --wait',
              'db:down': 'docker compose down',
              'db:logs': 'docker compose logs -f postgres'
          }
        : {})
})

export const postgres = {
    id: 'postgres',
    label: 'PostgreSQL',
    description: 'PostgreSQL with the plain pg driver (no ORM), in Docker or on your machine',
    dependencies: ['pg@latest'],
    devDependencies: ['@types/pg@latest'],
    errors: ERRORS,

    /**
     * Questions: Docker or local, host (local only), port, user, password and database name.
     * `prompts` can be injected (used by the tests).
     */
    async ask({ projectDir = process.cwd(), prompts = { input, password, select } } = {}) {
        const project = slugify(basename(projectDir))
        const mode = await prompts.select({
            message: 'Hoe draait PostgreSQL?',
            choices: [
                {
                    name: 'In Docker',
                    value: 'docker',
                    description: 'De CLI maakt een docker-compose.yml; start met npm run db:up'
                },
                {
                    name: 'Lokaal geïnstalleerd',
                    value: 'local',
                    description: 'PostgreSQL draait al op deze machine of in je netwerk; de CLI test de verbinding'
                }
            ]
        })
        const host =
            mode === 'local'
                ? (
                      await prompts.input({
                          message: 'Host van de database:',
                          default: 'localhost',
                          validate: validators.host
                      })
                  ).trim()
                : 'localhost'
        const port = Number(
            (
                await prompts.input({
                    message: mode === 'docker' ? 'Poort op je machine:' : 'Poort van de database:',
                    default: String(DEFAULT_PORT),
                    validate: validators.port
                })
            ).trim()
        )
        const user = (
            await prompts.input({
                message: 'Gebruikersnaam:',
                default: 'postgres',
                validate: validators.identifier
            })
        ).trim()
        const secret = await prompts.password({
            message: 'Wachtwoord:',
            mask: '*',
            validate: validators.password
        })
        const database = (
            await prompts.input({ message: 'Databasenaam:', default: project, validate: validators.identifier })
        ).trim()

        return { id: 'postgres', mode, host, port, user, password: secret, database, project }
    },

    /** Everything the NestJS backend needs for this database. */
    backend(db) {
        return {
            dependencies: this.dependencies,
            devDependencies: this.devDependencies,
            files: {
                ...databaseFiles,
                ...(db.mode === 'docker' ? { 'docker-compose.yml': dockerCompose(db) } : {})
            },
            env: envLines(db),
            envExample: envLines(db, { showPassword: false }),
            scripts: scriptsFor(db),
            errors: ERRORS
        }
    }
}
