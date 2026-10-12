import fs from 'node:fs/promises'
import path from 'node:path'
import { input, password, select } from '@inquirer/prompts'
import { run } from '../runner.js'
import { PRETTIERRC } from '../frontends/nextjs.js'
import { databases } from '../databases/index.js'

export const DIR = 'backend'
export const LOCALES = ['en', 'nl', 'fr', 'de']
export const DEFAULT_LOCALE = 'en'
export const PORT = 4000
export const FRONTEND_ORIGIN = 'http://localhost:3000'

/**
 * Server-side translations (nestjs-i18n): src/i18n/<language>/<namespace>.json.
 * Every language must contain exactly the same keys (checked by the tests of this CLI and of the generated project).
 *   common     - general texts
 *   errors     - translated error messages (key = errors.<NAME>, used by AppException and the exception filter)
 *   validation - class-validator messages ({property} and {constraints.0} are filled in by nestjs-i18n)
 */
export const TRANSLATIONS = {
    en: {
        common: { HELLO: 'Hello from the API!' },
        errors: {
            BAD_REQUEST: 'Bad request',
            UNAUTHORIZED: 'You are not logged in',
            FORBIDDEN: 'You do not have access to this',
            NOT_FOUND: 'Not found',
            CONFLICT: 'A conflict occurred',
            INTERNAL: 'Something went wrong on the server',
            EXAMPLE_NOT_FOUND: 'Example {id} was not found'
        },
        validation: {
            IS_STRING: '{property} must be a text',
            NOT_EMPTY: '{property} must not be empty',
            MIN_LENGTH: '{property} must be at least {constraints.0} characters long',
            IS_EMAIL: '{property} must be a valid email address'
        }
    },
    nl: {
        common: { HELLO: 'Hallo vanuit de API!' },
        errors: {
            BAD_REQUEST: 'Ongeldig verzoek',
            UNAUTHORIZED: 'Je bent niet ingelogd',
            FORBIDDEN: 'Je hebt hier geen toegang toe',
            NOT_FOUND: 'Niet gevonden',
            CONFLICT: 'Er is een conflict opgetreden',
            INTERNAL: 'Er is iets misgegaan op de server',
            EXAMPLE_NOT_FOUND: 'Voorbeeld {id} werd niet gevonden'
        },
        validation: {
            IS_STRING: '{property} moet een tekst zijn',
            NOT_EMPTY: '{property} mag niet leeg zijn',
            MIN_LENGTH: '{property} moet minstens {constraints.0} tekens lang zijn',
            IS_EMAIL: '{property} moet een geldig e-mailadres zijn'
        }
    },
    fr: {
        common: { HELLO: "Bonjour depuis l'API !" },
        errors: {
            BAD_REQUEST: 'Requête invalide',
            UNAUTHORIZED: "Vous n'êtes pas connecté",
            FORBIDDEN: "Vous n'avez pas accès à cette ressource",
            NOT_FOUND: 'Introuvable',
            CONFLICT: 'Un conflit est survenu',
            INTERNAL: 'Une erreur est survenue sur le serveur',
            EXAMPLE_NOT_FOUND: "L'exemple {id} est introuvable"
        },
        validation: {
            IS_STRING: '{property} doit être une chaîne de caractères',
            NOT_EMPTY: 'Le champ {property} ne doit pas être vide',
            MIN_LENGTH: '{property} doit contenir au moins {constraints.0} caractères',
            IS_EMAIL: '{property} doit être une adresse e-mail valide'
        }
    },
    de: {
        common: { HELLO: 'Hallo von der API!' },
        errors: {
            BAD_REQUEST: 'Ungültige Anfrage',
            UNAUTHORIZED: 'Du bist nicht angemeldet',
            FORBIDDEN: 'Du hast darauf keinen Zugriff',
            NOT_FOUND: 'Nicht gefunden',
            CONFLICT: 'Es ist ein Konflikt aufgetreten',
            INTERNAL: 'Auf dem Server ist ein Fehler aufgetreten',
            EXAMPLE_NOT_FOUND: 'Beispiel {id} wurde nicht gefunden'
        },
        validation: {
            IS_STRING: '{property} muss ein Text sein',
            NOT_EMPTY: '{property} darf nicht leer sein',
            MIN_LENGTH: '{property} muss mindestens {constraints.0} Zeichen lang sein',
            IS_EMAIL: '{property} muss eine gültige E-Mail-Adresse sein'
        }
    }
}

const json = value => JSON.stringify(value, null, 2) + '\n'

export const ENV_EXAMPLE = `# Port of the API (the Next.js frontend uses 3000)
PORT=${PORT}

# Origins that may call the API from a browser (comma separated)
CORS_ORIGIN=${FRONTEND_ORIGIN}
`

export const GITIGNORE = `node_modules\ndist\ncoverage\n.env\n*.log\n`

const translationFiles = Object.fromEntries(
    LOCALES.flatMap(locale =>
        Object.entries(TRANSLATIONS[locale]).map(([namespace, messages]) => [
            `src/i18n/${locale}/${namespace}.json`,
            json(messages)
        ])
    )
)

/** Files written into ./backend (on top of the NestJS starter). */
export const files = {
    ...translationFiles,

    '.gitignore': GITIGNORE,
    '.env': ENV_EXAMPLE,
    '.env.example': ENV_EXAMPLE,

    'src/main.ts': `import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { configureApp } from './setup.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app);

  const swagger = new DocumentBuilder()
    .setTitle('API')
    .setDescription('Error messages are translated: send Accept-Language (or ?lang=, or the x-lang header).')
    .setVersion('1.0')
    .addGlobalParameters({
      name: 'Accept-Language',
      in: 'header',
      required: false,
      schema: { type: 'string', enum: ${JSON.stringify(LOCALES)}, default: '${DEFAULT_LOCALE}' },
    })
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swagger));

  const port = Number(app.get(ConfigService).get('PORT') ?? ${PORT});
  await app.listen(port);
}

await bootstrap();
`,

    // Shared by main.ts and the e2e tests: validation, translated errors and CORS.
    'src/setup.ts': `import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { I18nValidationPipe } from 'nestjs-i18n';
import { AllExceptionsFilter } from './common/all-exceptions.filter.js';
import { ValidationExceptionFilter } from './common/validation-exception.filter.js';

export function configureApp(app: INestApplication) {
  const config = app.get(ConfigService);

  app.useGlobalPipes(new I18nValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  // The validation filter is registered last so it is checked first (Nest evaluates global filters in reverse order).
  app.useGlobalFilters(new AllExceptionsFilter(), new ValidationExceptionFilter());
  app.enableCors({
    origin: (config.get<string>('CORS_ORIGIN') ?? '${FRONTEND_ORIGIN}').split(','),
    credentials: true,
  });
}
`,

    'src/app.module.ts': `import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { fileURLToPath } from 'url';
import { AcceptLanguageResolver, HeaderResolver, I18nModule, QueryResolver } from 'nestjs-i18n';
import { AppController } from './app.controller.js';
import { ExamplesController } from './examples/examples.controller.js';
import { HealthController } from './health/health.controller.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    I18nModule.forRoot({
      // English is the default language when nothing (or an unsupported language) is requested.
      fallbackLanguage: '${DEFAULT_LOCALE}',
      fallbacks: { 'nl-*': 'nl', 'fr-*': 'fr', 'de-*': 'de', 'en-*': 'en' },
      loaderOptions: {
        path: fileURLToPath(new URL('./i18n', import.meta.url)),
        watch: !['production', 'test'].includes(process.env.NODE_ENV ?? ''),
      },
      // Order matters: ?lang=nl, then the x-lang header, then Accept-Language.
      resolvers: [{ use: QueryResolver, options: ['lang'] }, new HeaderResolver(['x-lang']), AcceptLanguageResolver],
    }),
  ],
  controllers: [AppController, HealthController, ExamplesController],
})
export class AppModule {}
`,

    'src/app.controller.ts': `import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { I18n, I18nContext } from 'nestjs-i18n';

@ApiTags('app')
@Controller()
export class AppController {
  @Get()
  getHello(@I18n() i18n: I18nContext) {
    return { message: i18n.t('common.HELLO'), language: i18n.lang };
  }
}
`,

    'src/health/health.controller.ts': `import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  check() {
    return { status: 'ok' };
  }
}
`,

    'src/common/app.exception.ts': `import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * An error with a translatable message. \`key\` is a key from src/i18n/<language>/errors.json,
 * for example 'errors.EXAMPLE_NOT_FOUND'. \`args\` fills in placeholders such as {id}.
 */
export class AppException extends HttpException {
  constructor(
    public readonly key: string,
    status: HttpStatus,
    public readonly args?: Record<string, unknown>,
  ) {
    super(key, status);
  }
}
`,

    'src/common/validation-exception.filter.ts': `import { ArgumentsHost, Catch } from '@nestjs/common';
import type { Request } from 'express';
import { I18nValidationException, I18nValidationExceptionFilter } from 'nestjs-i18n';

/**
 * Translates class-validator errors (messages come from src/i18n/<language>/validation.json) and returns them
 * in the same JSON shape as every other error of this API.
 */
@Catch(I18nValidationException)
export class ValidationExceptionFilter extends I18nValidationExceptionFilter {
  constructor() {
    super({ detailedErrors: false });
  }

  protected override buildResponseBody(host: ArgumentsHost, _exception: I18nValidationException, errors: object) {
    const request = host.switchToHttp().getRequest<Request>();
    return {
      statusCode: 400,
      error: 'errors.BAD_REQUEST',
      message: errors,
      path: request.url,
      timestamp: new Date().toISOString(),
    };
  }
}
`,

    'src/common/all-exceptions.filter.ts': `import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { I18nContext } from 'nestjs-i18n';
import { AppException } from './app.exception.js';

const STATUS_KEYS: Record<number, string> = {
  400: 'errors.BAD_REQUEST',
  401: 'errors.UNAUTHORIZED',
  403: 'errors.FORBIDDEN',
  404: 'errors.NOT_FOUND',
  409: 'errors.CONFLICT',
};

/** Turns every error into the same JSON shape, with the message in the language of the request. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();

    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    // Deliberate HttpExceptions (such as a 503 for an unavailable database) are answered, not logged as crashes.
    if (!(exception instanceof HttpException)) this.logger.error(exception instanceof Error ? exception.stack : String(exception));

    const key = exception instanceof AppException ? exception.key : (STATUS_KEYS[status] ?? 'errors.INTERNAL');
    const args = exception instanceof AppException ? exception.args : undefined;
    const i18n = I18nContext.current(host);

    response.status(status).json({
      statusCode: status,
      error: key,
      message: i18n ? i18n.t(key, { args }) : key,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
`,

    'src/examples/dto/create-example.dto.ts': `import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';

export class CreateExampleDto {
  @ApiProperty({ example: 'Ada' })
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @IsNotEmpty({ message: i18nValidationMessage('validation.NOT_EMPTY') })
  @MinLength(2, { message: i18nValidationMessage('validation.MIN_LENGTH') })
  name!: string;

  @ApiProperty({ example: 'ada@example.com' })
  @IsEmail({}, { message: i18nValidationMessage('validation.IS_EMAIL') })
  email!: string;
}
`,

    'src/examples/examples.controller.ts': `import { Body, Controller, Get, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AppException } from '../common/app.exception.js';
import { CreateExampleDto } from './dto/create-example.dto.js';

/** Example endpoints that show translated validation errors and translated exceptions. */
@ApiTags('examples')
@Controller('examples')
export class ExamplesController {
  @Post()
  create(@Body() dto: CreateExampleDto) {
    return { id: 1, name: dto.name, email: dto.email };
  }

  @Get(':id')
  findOne(@Param('id') id: string): never {
    throw new AppException('errors.EXAMPLE_NOT_FOUND', HttpStatus.NOT_FOUND, { id });
  }
}
`,

    'src/i18n/i18n.spec.ts': `import { readdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));

const LANGUAGES = ${JSON.stringify([...LOCALES].sort())};

function read(language: string, namespace: string): Record<string, string> {
  return JSON.parse(readFileSync(join(here, language, namespace + '.json'), 'utf8'));
}

describe('translations', () => {
  it('exist for exactly nl, fr, en and de', () => {
    const folders = readdirSync(here, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(folders).toEqual(LANGUAGES);
  });

  it('have the same files and keys in every language', () => {
    const namespaces = readdirSync(join(here, 'en')).map((file) => file.replace('.json', ''));
    for (const namespace of namespaces) {
      const keys = Object.keys(read('en', namespace)).sort();
      for (const language of LANGUAGES) {
        expect(Object.keys(read(language, namespace)).sort()).toEqual(keys);
      }
    }
  });

  it('never contain empty texts', () => {
    for (const language of LANGUAGES) {
      for (const file of readdirSync(join(here, language))) {
        const messages = read(language, file.replace('.json', ''));
        for (const [key, value] of Object.entries(messages)) {
          expect(value.trim().length).toBeGreaterThan(0);
          expect(key).toBeTruthy();
        }
      }
    }
  });
});
`,

    'src/common/app.exception.spec.ts': `import { HttpStatus } from '@nestjs/common';
import { AppException } from './app.exception.js';

describe('AppException', () => {
  it('keeps the translation key, the arguments and the status', () => {
    const exception = new AppException('errors.EXAMPLE_NOT_FOUND', HttpStatus.NOT_FOUND, { id: '7' });
    expect(exception.key).toBe('errors.EXAMPLE_NOT_FOUND');
    expect(exception.args).toEqual({ id: '7' });
    expect(exception.getStatus()).toBe(404);
  });
});
`,

    'test/app.e2e-spec.ts': `import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/setup.js';

const HELLO: Record<string, string> = {
  en: 'Hello from the API!',
  nl: 'Hallo vanuit de API!',
  fr: "Bonjour depuis l'API !",
  de: 'Hallo von der API!',
};

describe('API (e2e)', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('language detection', () => {
    it.each(Object.entries(HELLO))('answers in %s when Accept-Language asks for it', async (language, text) => {
      const response = await http().get('/').set('Accept-Language', language).expect(200);
      expect(response.body).toEqual({ message: text, language });
    });

    it('defaults to English without a language', async () => {
      const response = await http().get('/').expect(200);
      expect(response.body.message).toBe(HELLO.en);
    });

    it('falls back to English for an unsupported language', async () => {
      const response = await http().get('/').set('Accept-Language', 'es').expect(200);
      expect(response.body.message).toBe(HELLO.en);
    });

    it('understands regional variants such as nl-BE', async () => {
      const response = await http().get('/').set('Accept-Language', 'nl-BE').expect(200);
      expect(response.body.message).toBe(HELLO.nl);
    });

    it('lets ?lang= win over the x-lang header and Accept-Language', async () => {
      const response = await http().get('/?lang=fr').set('x-lang', 'de').set('Accept-Language', 'nl').expect(200);
      expect(response.body.message).toBe(HELLO.fr);
    });

    it('lets the x-lang header win over Accept-Language', async () => {
      const response = await http().get('/').set('x-lang', 'de').set('Accept-Language', 'nl').expect(200);
      expect(response.body.message).toBe(HELLO.de);
    });
  });

  describe('validation errors', () => {
    it('are translated (Dutch)', async () => {
      const response = await http().post('/examples').set('Accept-Language', 'nl').send({ name: '', email: 'nope' }).expect(400);
      const text = JSON.stringify(response.body);
      expect(text).toContain('mag niet leeg zijn');
      expect(text).toContain('geldig e-mailadres');
      expect(response.body).toMatchObject({ statusCode: 400, error: 'errors.BAD_REQUEST', path: '/examples' });
      expect(Array.isArray(response.body.message)).toBe(true);
    });

    it('are translated (French)', async () => {
      const response = await http().post('/examples').set('Accept-Language', 'fr').send({ name: 'Ada', email: 'nope' }).expect(400);
      expect(JSON.stringify(response.body)).toContain('adresse e-mail valide');
    });

    it('are translated (German) and in English by default', async () => {
      const german = await http().post('/examples').set('Accept-Language', 'de').send({ name: 'Ada', email: 'x' }).expect(400);
      expect(JSON.stringify(german.body)).toContain('gültige E-Mail-Adresse');
      const english = await http().post('/examples').send({ name: 'Ada', email: 'x' }).expect(400);
      expect(JSON.stringify(english.body)).toContain('valid email address');
    });

    it('accept a valid body', async () => {
      const response = await http().post('/examples').send({ name: 'Ada', email: 'ada@example.com' }).expect(201);
      expect(response.body).toEqual({ id: 1, name: 'Ada', email: 'ada@example.com' });
    });
  });

  describe('exceptions', () => {
    it('AppException messages are translated and get their arguments', async () => {
      const response = await http().get('/examples/7').set('Accept-Language', 'de').expect(404);
      expect(response.body).toMatchObject({
        statusCode: 404,
        error: 'errors.EXAMPLE_NOT_FOUND',
        message: 'Beispiel 7 wurde nicht gefunden',
        path: '/examples/7',
      });
    });

    it('unknown routes get a translated 404', async () => {
      const dutch = await http().get('/does-not-exist').set('Accept-Language', 'nl').expect(404);
      expect(dutch.body.message).toBe('Niet gevonden');
      const english = await http().get('/does-not-exist').expect(404);
      expect(english.body.message).toBe('Not found');
    });
  });

  describe('health and CORS', () => {
    it('GET /health returns ok', async () => {
      const response = await http().get('/health').expect(200);
      expect(response.body).toEqual({ status: 'ok' });
    });

    it('allows the frontend origin', async () => {
      const response = await http().get('/health').set('Origin', '${FRONTEND_ORIGIN}').expect(200);
      expect(response.headers['access-control-allow-origin']).toBe('${FRONTEND_ORIGIN}');
    });
  });
});
`
}

const replaceOnce = (text, from, to) => {
    if (!text.includes(from)) throw new Error(`Template changed, cannot find: ${from}`)
    return text.replace(from, () => to)
}

/**
 * The files of the backend. Without a database this is `files`; with a database (answers of the database question)
 * the module, health check, translations, .env files and tests are extended for it.
 */
export function buildFiles(database = null) {
    if (!database) return files
    const db = databases[database.id].backend(database)
    const result = { ...files, ...db.files }

    result['.env'] = ENV_EXAMPLE + db.env
    result['.env.example'] = ENV_EXAMPLE + db.envExample
    for (const locale of LOCALES) {
        result[`src/i18n/${locale}/errors.json`] = json({ ...TRANSLATIONS[locale].errors, ...db.errors[locale] })
    }

    let appModule = files['src/app.module.ts']
    appModule = replaceOnce(
        appModule,
        "import { HealthController } from './health/health.controller.js';\n",
        "import { DatabaseModule } from './database/database.module.js';\nimport { HealthController } from './health/health.controller.js';\n"
    )
    appModule = replaceOnce(
        appModule,
        '    ConfigModule.forRoot({ isGlobal: true }),\n',
        '    ConfigModule.forRoot({ isGlobal: true }),\n    DatabaseModule,\n'
    )
    result['src/app.module.ts'] = appModule

    // The e2e tests never need a real database: DatabaseService is replaced by a fake.
    let e2e = files['test/app.e2e-spec.ts']
    e2e = replaceOnce(
        e2e,
        "import { configureApp } from '../src/setup.js';\n",
        "import { DatabaseService } from '../src/database/database.service.js';\nimport { configureApp } from '../src/setup.js';\n"
    )
    e2e = replaceOnce(
        e2e,
        "describe('API (e2e)', () => {\n",
        `const DATABASE_DOWN: Record<string, string> = ${JSON.stringify(
            Object.fromEntries(LOCALES.map(locale => [locale, db.errors[locale].DATABASE_UNAVAILABLE]))
        )};

// A fake database: the tests do not need PostgreSQL.
const database = { ping: vi.fn().mockResolvedValue(true) };

describe('API (e2e)', () => {\n`
    )
    e2e = replaceOnce(
        e2e,
        'const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();',
        'const moduleRef = await Test.createTestingModule({ imports: [AppModule] })\n      .overrideProvider(DatabaseService)\n      .useValue(database)\n      .compile();'
    )
    e2e = replaceOnce(
        e2e,
        `    it('GET /health returns ok', async () => {
      const response = await http().get('/health').expect(200);
      expect(response.body).toEqual({ status: 'ok' });
    });
`,
        `    it('GET /health returns ok when the database answers', async () => {
      const response = await http().get('/health').expect(200);
      expect(response.body).toEqual({ status: 'ok', database: 'up' });
    });

    it.each(Object.entries(DATABASE_DOWN))(
      'GET /health returns a translated 503 in %s when the database is down',
      async (language, text) => {
        database.ping.mockResolvedValueOnce(false);
        const response = await http().get('/health').set('Accept-Language', language).expect(503);
        expect(response.body).toMatchObject({
          statusCode: 503,
          error: 'errors.DATABASE_UNAVAILABLE',
          message: text,
          path: '/health',
        });
      },
    );
`
    )
    result['test/app.e2e-spec.ts'] = e2e
    return result
}

/** Adds the i18n files to nest-cli.json so they are copied to dist/ when building. */
export async function patchNestCli(root) {
    const file = path.join(root, 'nest-cli.json')
    const config = JSON.parse(await fs.readFile(file, 'utf8'))
    config.compilerOptions = {
        ...config.compilerOptions,
        assets: [{ include: 'i18n/**/*.json', watchAssets: true }]
    }
    await fs.writeFile(file, JSON.stringify(config, null, 2) + '\n')
}

export async function write(root, rel, content) {
    const target = path.join(root, rel)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, content)
}

const exists = file =>
    fs.stat(file).then(
        () => true,
        () => false
    )

export const nestjs = {
    id: 'nestjs',
    label: 'NestJS',
    description: 'NestJS (latest) + i18n (nl, fr, en, de) + validation + Swagger + config + Prettier, in ./backend',
    dir: DIR,
    /** The API the frontend talks to (the frontend uses it for its language link and status card). */
    api: { port: PORT },

    /** Question: which database? (PostgreSQL only for now), followed by that database's own questions. */
    async ask({ projectDir = process.cwd(), prompts = { select, input, password }, registry = databases } = {}) {
        const choice = await prompts.select({
            message: 'Welke database wil je gebruiken?',
            choices: [
                ...Object.values(registry).map(db => ({ name: db.label, value: db.id, description: db.description })),
                { name: 'Geen database (later)', value: 'none' }
            ]
        })
        if (choice === 'none') return { database: null }
        return { database: await registry[choice].ask({ projectDir, prompts }) }
    },

    next(answers) {
        const db = answers?.database
        return [
            `cd ${DIR}`,
            ...(db?.mode === 'docker' ? ['npm run db:up       (start PostgreSQL in Docker)'] : []),
            ...(db?.mode === 'local' ? ['npm run db:check    (test the database connection)'] : []),
            'npm run start:dev',
            `API: http://localhost:${PORT}  |  docs: http://localhost:${PORT}/docs`
        ]
    },

    /** Extra result lines for the end of the run: { ok, text }. */
    summary(answers) {
        const db = answers?.database
        if (!db) return []
        const where = `${db.host}:${db.port}/${db.database}`
        if (db.mode === 'docker') return [{ ok: true, text: `PostgreSQL (Docker) ingesteld: ${where}` }]
        if (db.connection === 'failed') {
            return [
                {
                    ok: false,
                    text: `Geen verbinding met PostgreSQL op ${where}. Controleer ./${DIR}/.env en start de database; test daarna met npm run db:check`
                }
            ]
        }
        return [{ ok: true, text: `Verbonden met PostgreSQL op ${where}` }]
    },

    async steps({ projectDir, exec = run, answers = {} }) {
        const database = answers?.database ?? null
        const root = path.join(projectDir, DIR)
        if (await exists(root)) throw new Error(`De map ./${DIR} bestaat al. Verwijder of hernoem ze eerst.`)

        const steps = [
            {
                title: 'NestJS aanmaken',
                weight: 3,
                run: () =>
                    exec(
                        'npx',
                        [
                            '--yes',
                            '@nestjs/cli@latest',
                            'new',
                            DIR,
                            '--package-manager',
                            'npm',
                            '--skip-git',
                            '--skip-install',
                            '--strict'
                        ],
                        { cwd: projectDir }
                    )
            },
            {
                title: 'Backend dependencies installeren',
                weight: 4,
                run: () => exec('npm', ['install'], { cwd: root })
            },
            {
                title: 'i18n, validatie, Swagger en config installeren',
                weight: 2,
                run: () =>
                    exec(
                        'npm',
                        [
                            'install',
                            'nestjs-i18n@latest',
                            'class-validator@latest',
                            'class-transformer@latest',
                            '@nestjs/config@latest',
                            '@nestjs/swagger@latest'
                        ],
                        { cwd: root }
                    )
            },
            ...(database
                ? [
                      {
                          title: `Database-driver installeren (${databases[database.id].label})`,
                          weight: 2,
                          run: async () => {
                              const definition = databases[database.id]
                              await exec('npm', ['install', ...definition.dependencies], { cwd: root })
                              await exec('npm', ['install', '--save-dev', ...definition.devDependencies], {
                                  cwd: root
                              })
                          }
                      }
                  ]
                : []),
            {
                title: 'Prettier installeren (backend)',
                weight: 2,
                run: () =>
                    exec('npm', ['install', '--save-dev', 'prettier@latest', 'prettier-plugin-tailwindcss@latest'], {
                        cwd: root
                    })
            },
            {
                title: 'i18n en API configureren',
                weight: 1,
                run: async () => {
                    // Replace the starter controller/service/specs by the i18n versions
                    for (const rel of [
                        'src/app.controller.ts',
                        'src/app.service.ts',
                        'src/app.controller.spec.ts',
                        'test/app.e2e-spec.ts'
                    ]) {
                        await fs.rm(path.join(root, rel), { force: true })
                    }
                    for (const [rel, content] of Object.entries(buildFiles(database))) await write(root, rel, content)
                    await patchNestCli(root)
                    if (database) {
                        const pkgPath = path.join(root, 'package.json')
                        const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'))
                        pkg.scripts = { ...pkg.scripts, ...databases[database.id].backend(database).scripts }
                        await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
                    }
                }
            }
        ]

        steps.push(
            {
                title: 'Prettier configureren (backend)',
                weight: 2,
                run: async () => {
                    await write(root, '.prettierrc', PRETTIERRC)
                    await write(root, '.prettierignore', PRETTIERIGNORE_BACKEND)

                    const pkgPath = path.join(root, 'package.json')
                    const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'))
                    pkg.scripts = { ...pkg.scripts, format: 'prettier --write .', 'format:check': 'prettier --check .' }
                    await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n')

                    await exec('npx', ['--no-install', 'prettier', '--write', '.'], { cwd: root })
                }
            },
            {
                title: 'Backend controleren (build, lint en tests)',
                weight: 4,
                run: async () => {
                    await exec('npm', ['run', 'build'], { cwd: root })
                    await exec('npm', ['run', 'lint'], { cwd: root })
                    await exec('npm', ['test'], { cwd: root })
                    await exec('npm', ['run', 'test:e2e'], { cwd: root })
                }
            }
        )

        if (database?.mode === 'local') {
            steps.push({
                title: 'Databaseverbinding testen',
                weight: 1,
                run: async () => {
                    // A database that is not reachable (yet) must not undo a finished install: report it at the end.
                    try {
                        await exec('npm', ['run', 'db:check'], { cwd: root })
                        database.connection = 'ok'
                    } catch {
                        database.connection = 'failed'
                    }
                }
            })
        }

        return steps
    }
}

export const PRETTIERIGNORE_BACKEND = 'node_modules\ndist\ncoverage\npackage-lock.json\n'
