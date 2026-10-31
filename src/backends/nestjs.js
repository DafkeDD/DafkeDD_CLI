import fs from 'node:fs/promises'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { confirm, input, password, select } from '../prompts.js'
import { allowEidDownload, EID_MOCK_PIN } from '../eid.js'
import { denyInstallScripts } from '../npm.js'
import { run } from '../runner.js'
import { PRETTIERRC } from '../frontends/nextjs.js'
import { databases } from '../databases/index.js'
import { emptyDatabase } from '../databases/existing.js'
import * as login from './auth.js'
import * as oidc from './oidc.js'
import * as appBackend from './app.js'
import { backendReadme } from './docs.js'

/**
 * npm overrides of the backend: a dependency of a dependency (of NestJS) at a version without a known vulnerability,
 * until NestJS itself asks for it. The CI fails on `npm audit --audit-level=high`; remove an entry once NestJS has it.
 * - multer: GHSA-q7qp-rjg7-q26m (denial of service, fixed in 2.5.0), used by @nestjs/platform-express.
 */
export const SECURITY_OVERRIDES = { multer: '^2.5.0' }
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
            PAYLOAD_TOO_LARGE: 'The request is too large',
            INTERNAL: 'Something went wrong on the server',
            EXAMPLE_NOT_FOUND: 'Example {id} was not found'
        },
        validation: {
            IS_STRING: '{property} must be a text',
            NOT_EMPTY: '{property} must not be empty',
            MIN_LENGTH: '{property} must be at least {constraints.0} characters long',
            IS_EMAIL: '{property} must be a valid email address',
            IS_IN: '{property} must be one of: {constraints.0}',
            IS_OBJECT: '{property} must be an object',
            IS_INT: '{property} must be a whole number',
            MIN: '{property} must be at least {constraints.0}',
            MAX: '{property} must be at most {constraints.0}',
            MATCHES: '{property} has an invalid format',
            IS_BOOLEAN: '{property} must be true or false',
            IS_UUID: '{property} must be an id (uuid)',
            IS_DATE: '{property} must be a date (ISO 8601)',
            IS_ARRAY: '{property} must be a list',
            ARRAY_MAX_SIZE: '{property} may have at most {constraints.0} items',
            IS_NUMBER: '{property} must be a number',
            MAX_LENGTH: '{property} must be at most {constraints.0} characters long'
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
            PAYLOAD_TOO_LARGE: 'Het verzoek is te groot',
            INTERNAL: 'Er is iets misgegaan op de server',
            EXAMPLE_NOT_FOUND: 'Voorbeeld {id} werd niet gevonden'
        },
        validation: {
            IS_STRING: '{property} moet een tekst zijn',
            NOT_EMPTY: '{property} mag niet leeg zijn',
            MIN_LENGTH: '{property} moet minstens {constraints.0} tekens lang zijn',
            IS_EMAIL: '{property} moet een geldig e-mailadres zijn',
            IS_IN: '{property} moet een van deze waarden zijn: {constraints.0}',
            IS_OBJECT: '{property} moet een object zijn',
            IS_INT: '{property} moet een geheel getal zijn',
            MIN: '{property} moet minstens {constraints.0} zijn',
            MAX: '{property} mag hoogstens {constraints.0} zijn',
            MATCHES: '{property} heeft een ongeldige vorm',
            IS_BOOLEAN: '{property} moet true of false zijn',
            IS_UUID: '{property} moet een id (uuid) zijn',
            IS_DATE: '{property} moet een datum zijn (ISO 8601)',
            IS_ARRAY: '{property} moet een lijst zijn',
            ARRAY_MAX_SIZE: '{property} mag hoogstens {constraints.0} elementen hebben',
            IS_NUMBER: '{property} moet een getal zijn',
            MAX_LENGTH: '{property} mag hoogstens {constraints.0} tekens lang zijn'
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
            PAYLOAD_TOO_LARGE: 'La requête est trop volumineuse',
            INTERNAL: 'Une erreur est survenue sur le serveur',
            EXAMPLE_NOT_FOUND: "L'exemple {id} est introuvable"
        },
        validation: {
            IS_STRING: '{property} doit être une chaîne de caractères',
            NOT_EMPTY: 'Le champ {property} ne doit pas être vide',
            MIN_LENGTH: '{property} doit contenir au moins {constraints.0} caractères',
            IS_EMAIL: '{property} doit être une adresse e-mail valide',
            IS_IN: "{property} doit être l'une de ces valeurs : {constraints.0}",
            IS_OBJECT: '{property} doit être un objet',
            IS_INT: '{property} doit être un nombre entier',
            MIN: '{property} doit être au moins {constraints.0}',
            MAX: '{property} doit être au plus {constraints.0}',
            MATCHES: "{property} n'a pas un format valable",
            IS_BOOLEAN: '{property} doit être true ou false',
            IS_UUID: '{property} doit être un identifiant (uuid)',
            IS_DATE: '{property} doit être une date (ISO 8601)',
            IS_ARRAY: '{property} doit être une liste',
            ARRAY_MAX_SIZE: '{property} peut contenir au plus {constraints.0} éléments',
            IS_NUMBER: '{property} doit être un nombre',
            MAX_LENGTH: '{property} doit contenir au maximum {constraints.0} caractères'
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
            PAYLOAD_TOO_LARGE: 'Die Anfrage ist zu groß',
            INTERNAL: 'Auf dem Server ist ein Fehler aufgetreten',
            EXAMPLE_NOT_FOUND: 'Beispiel {id} wurde nicht gefunden'
        },
        validation: {
            IS_STRING: '{property} muss ein Text sein',
            NOT_EMPTY: '{property} darf nicht leer sein',
            MIN_LENGTH: '{property} muss mindestens {constraints.0} Zeichen lang sein',
            IS_EMAIL: '{property} muss eine gültige E-Mail-Adresse sein',
            IS_IN: '{property} muss einer dieser Werte sein: {constraints.0}',
            IS_OBJECT: '{property} muss ein Objekt sein',
            IS_INT: '{property} muss eine ganze Zahl sein',
            MIN: '{property} muss mindestens {constraints.0} sein',
            MAX: '{property} darf höchstens {constraints.0} sein',
            MATCHES: '{property} hat ein ungültiges Format',
            IS_BOOLEAN: '{property} muss true oder false sein',
            IS_UUID: '{property} muss eine ID (uuid) sein',
            IS_DATE: '{property} muss ein Datum sein (ISO 8601)',
            IS_ARRAY: '{property} muss eine Liste sein',
            ARRAY_MAX_SIZE: '{property} darf höchstens {constraints.0} Einträge haben',
            IS_NUMBER: '{property} muss eine Zahl sein',
            MAX_LENGTH: '{property} darf höchstens {constraints.0} Zeichen lang sein'
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

    // Documentation of every endpoint (replaces the README of the NestJS starter)
    'README.md': backendReadme({
        translations: { en: { errors: TRANSLATIONS.en.errors } },
        port: PORT,
        origin: FRONTEND_ORIGIN
    }),

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
    .setDescription(
      'Error messages are translated: send Accept-Language (or ?lang=, or the x-lang header). ' +
        'Every error has the shape { statusCode, error, message, path, timestamp }.',
    )
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
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { I18n, I18nContext } from 'nestjs-i18n';

@ApiTags('app')
@Controller()
export class AppController {
  @Get()
  @ApiOperation({ summary: 'Greeting in the language of the request' })
  @ApiOkResponse({
    description: 'The message and the language that was used',
    schema: { example: { message: 'Hello from the API!', language: 'en' } },
  })
  getHello(@I18n() i18n: I18nContext) {
    return { message: i18n.t('common.HELLO'), language: i18n.lang };
  }
}
`,

    'src/health/health.controller.ts': `import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({ summary: 'Is the API running?' })
  @ApiOkResponse({ schema: { example: { status: 'ok' } } })
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
  413: 'errors.PAYLOAD_TOO_LARGE',
};

/**
 * The status of an error of the body parser (a body that is too large or not valid JSON): it has a \`type\` and a 4xx
 * \`status\`. Such a request is the fault of the caller, so it is answered (413, 400 …) and not logged as a crash.
 */
function parserStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const { status, type } = error as { status?: unknown; type?: unknown };
  return typeof type === 'string' && typeof status === 'number' && status >= 400 && status < 500 ? status : undefined;
}

/** Turns every error into the same JSON shape, with the message in the language of the request. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();

    const refused = exception instanceof HttpException ? undefined : parserStatus(exception);
    const status =
      exception instanceof HttpException ? exception.getStatus() : (refused ?? HttpStatus.INTERNAL_SERVER_ERROR);
    // Deliberate HttpExceptions (such as a 503 for an unavailable database) and a body the parser refuses are
    // answered, not logged as crashes.
    if (!(exception instanceof HttpException) && !refused)
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));

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
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AppException } from '../common/app.exception.js';
import { CreateExampleDto } from './dto/create-example.dto.js';

/** Example endpoints that show translated validation errors and translated exceptions. */
@ApiTags('examples')
@Controller('examples')
export class ExamplesController {
  @Post()
  @ApiOperation({ summary: 'Example with validation: invalid input gives a translated 400' })
  @ApiCreatedResponse({ schema: { example: { id: 1, name: 'Ada', email: 'ada@example.com' } } })
  @ApiBadRequestResponse({ description: 'errors.BAD_REQUEST, with a translated message per field' })
  create(@Body() dto: CreateExampleDto) {
    return { id: 1, name: dto.name, email: dto.email };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Example of a translated exception: always answers 404' })
  @ApiNotFoundResponse({ description: 'errors.EXAMPLE_NOT_FOUND, translated' })
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

    it('a body that is too large is a translated 413, not a crash', async () => {
      const response = await http()
        .post('/examples')
        .set('Accept-Language', 'nl')
        .send({ name: 'x'.repeat(200 * 1024), email: 'ada@example.com' })
        .expect(413);
      expect(response.body).toMatchObject({ statusCode: 413, error: 'errors.PAYLOAD_TOO_LARGE', message: 'Het verzoek is te groot' });
    });

    it('a body that is not valid JSON is a 400, not a crash', async () => {
      const response = await http().post('/examples').set('Content-Type', 'application/json').send('{"name":').expect(400);
      expect(response.body).toMatchObject({ statusCode: 400, error: 'errors.BAD_REQUEST' });
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
export function buildFiles(
    database = null,
    { auth = null, oidc: oidcAnswers = null, app = null, appOptions = appBackend.DEFAULT_OPTIONS } = {}
) {
    if ((auth || oidcAnswers || app) && !database) throw new Error('Login en registratie hebben een database nodig')
    if ([auth, oidcAnswers, app].filter(Boolean).length > 1)
        throw new Error('Kies de eenvoudige login, de OIDC-server of een gekoppelde app, niet meerdere')
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
const database = {
  ping: vi.fn().mockResolvedValue(true),
  query: vi.fn().mockResolvedValue({ rows: [] }),
};

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

    if (auth) {
        Object.assign(result, login.authFiles(login.usersTable(database.database)))
        result['.env'] += login.envLines({ jwtSecret: auth.jwtSecret, proxySecret: auth.proxySecret ?? '' })
        result['.env.example'] += login.envLines({ jwtSecret: login.EXAMPLE_SECRET, proxySecret: login.EXAMPLE_SECRET })
        for (const locale of LOCALES) {
            result[`src/i18n/${locale}/errors.json`] = json({
                ...JSON.parse(result[`src/i18n/${locale}/errors.json`]),
                ...login.ERRORS[locale]
            })
            result[`src/i18n/${locale}/validation.json`] = json({
                ...TRANSLATIONS[locale].validation,
                ...login.VALIDATION[locale]
            })
        }
        result['src/main.ts'] = replaceOnce(
            files['src/main.ts'],
            ".setVersion('1.0')",
            `.setVersion('1.0')\n    .addCookieAuth('${login.COOKIE}')`
        )
        result['src/app.module.ts'] = replaceOnce(
            replaceOnce(
                result['src/app.module.ts'],
                "import { DatabaseModule } from './database/database.module.js';\n",
                "import { AuthModule } from './auth/auth.module.js';\nimport { DatabaseModule } from './database/database.module.js';\n"
            ),
            '    DatabaseModule,\n',
            '    DatabaseModule,\n    AuthModule,\n'
        )
        result['src/setup.ts'] = replaceOnce(
            replaceOnce(
                files['src/setup.ts'],
                "import { INestApplication } from '@nestjs/common';\n",
                "import { INestApplication } from '@nestjs/common';\nimport cookieParser from 'cookie-parser';\n"
            ),
            '  app.enableCors({',
            [
                '  app.use(cookieParser());',
                '  // Which proxies in front of the API may tell the address of the browser (X-Forwarded-For): TRUST_PROXY.',
                "  app.getHttpAdapter().getInstance().set('trust proxy', trustProxy(config.get<string>('TRUST_PROXY')));",
                '  app.enableCors({'
            ].join('\n')
        )
        result['src/setup.ts'] = replaceOnce(
            result['src/setup.ts'],
            'export function configureApp(',
            [
                '/**',
                ' * TRUST_PROXY as Express reads it: empty is `loopback` (this computer), `true` or `false`, a number of proxies',
                ' * (`1` on Cloud Run), or addresses and ranges like `loopback, 10.0.0.0/8`. Never the raw text: Express would read',
                ' * `1` as the address 0.0.0.1 and refuse `true`.',
                ' */',
                'export function trustProxy(value: string | undefined): boolean | number | string {',
                "  const setting = value?.trim() ?? '';",
                "  if (!setting) return 'loopback';",
                "  if (setting === 'true' || setting === 'false') return setting === 'true';",
                '  return /^\\d+$/.test(setting) ? Number(setting) : setting;',
                '}',
                '',
                'export function configureApp('
            ].join('\n')
        )
        result['src/common/all-exceptions.filter.ts'] = replaceOnce(
            files['src/common/all-exceptions.filter.ts'],
            "  413: 'errors.PAYLOAD_TOO_LARGE',\n",
            "  413: 'errors.PAYLOAD_TOO_LARGE',\n  429: 'errors.TOO_MANY_REQUESTS',\n"
        )
        // The main e2e spec creates the whole app, so it needs a JWT secret too
        result['test/app.e2e-spec.ts'] = replaceOnce(
            result['test/app.e2e-spec.ts'],
            '// A fake database: the tests do not need PostgreSQL.\n',
            "process.env.JWT_SECRET ??= 'test-only-secret';\n\n// A fake database: the tests do not need PostgreSQL.\n"
        )
    }
    if (oidcAnswers) {
        Object.assign(
            result,
            oidc.oidcFiles({ usersTable: login.usersTable(database.database), database: database.database, port: PORT })
        )
        result['.env'] += oidc.envLines(oidcAnswers, { port: PORT })
        result['.env.example'] += oidc.envLines(oidcAnswers, { port: PORT, example: true })
        for (const locale of LOCALES) {
            result[`src/i18n/${locale}/oidc.json`] = json(oidc.MESSAGES[locale])
            result[`src/i18n/${locale}/mail.json`] = json(oidc.MAIL_MESSAGES[locale])
            result[`src/i18n/${locale}/billing.json`] = json(oidc.BILLING_MESSAGES[locale])
            result[`src/i18n/${locale}/invoices.json`] = json(oidc.INVOICE_MESSAGES[locale])
            result[`src/i18n/${locale}/support.json`] = json(oidc.SUPPORT_MESSAGES[locale])
            result[`src/i18n/${locale}/errors.json`] = json({
                ...JSON.parse(result[`src/i18n/${locale}/errors.json`]),
                ...oidc.ERROR_MESSAGES[locale]
            })
            result[`src/i18n/${locale}/validation.json`] = json({
                ...TRANSLATIONS[locale].validation,
                ...login.VALIDATION[locale]
            })
        }
        // The member and platform endpoints need the access token of the OIDC server
        result['src/main.ts'] = replaceOnce(
            files['src/main.ts'],
            ".setVersion('1.0')",
            ".setVersion('1.0')\n    .addBearerAuth()"
        )
        result['src/app.module.ts'] = replaceOnce(
            replaceOnce(
                result['src/app.module.ts'],
                "import { HealthController } from './health/health.controller.js';\n",
                "import { HealthController } from './health/health.controller.js';\nimport { OidcModule } from './oidc/oidc.module.js';\nimport { TenantsModule } from './tenants/tenants.module.js';\nimport { BillingModule } from './billing/billing.module.js';\nimport { VaultModule } from './vault/vault.module.js';\nimport { NotificationsModule } from './notifications/notifications.module.js';\nimport { SupportModule } from './support/support.module.js';\nimport { StatsModule } from './stats/stats.module.js';\n"
            ),
            '    DatabaseModule,\n',
            '    DatabaseModule,\n    OidcModule,\n    TenantsModule,\n    BillingModule,\n    VaultModule,\n    NotificationsModule,\n    SupportModule,\n    StatsModule,\n'
        )
        result['src/setup.ts'] = replaceOnce(
            replaceOnce(
                replaceOnce(
                    replaceOnce(
                        files['src/setup.ts'],
                        "import { INestApplication } from '@nestjs/common';\n",
                        "import { INestApplication } from '@nestjs/common';\nimport cookieParser from 'cookie-parser';\n"
                    ),
                    "import { I18nValidationPipe } from 'nestjs-i18n';\n",
                    "import { json, type NextFunction, type Request, type Response } from 'express';\nimport { I18nValidationPipe } from 'nestjs-i18n';\n"
                ),
                'export function configureApp(app: INestApplication) {\n  const config = app.get(ConfigService);\n',
                `/** Uploads of images in base64 (at most 2 MiB, a third more in base64): they get a larger JSON body than 100 kB. */
export const UPLOAD_PATHS = ['/tenants/current/tickets/attachments', '/admin/tickets/attachments'];

export function configureApp(app: INestApplication) {
  const config = app.get(ConfigService);

  // Before the parser of Nest (registered in app.init()), which then skips the body that is read already. Wrapped:
  // Nest leaves out its own parser for every route when it finds a middleware named jsonParser.
  const uploads = json({ limit: '3mb' });
  app.use(UPLOAD_PATHS, function uploadParser(request: Request, response: Response, next: NextFunction) {
    uploads(request, response, next);
  });
`
            ),
            '  app.enableCors({',
            '  app.use(cookieParser());\n  app.enableCors({'
        )
        // The main e2e spec creates the whole app: it gets an in-memory OIDC store and a test master key
        let e2e = replaceOnce(
            result['test/app.e2e-spec.ts'],
            "import { DatabaseService } from '../src/database/database.service.js';\n",
            "import { randomBytes } from 'node:crypto';\nimport { AUDIT_STORE } from '../src/audit/audit.store.js';\nimport { MemoryAuditStore } from '../src/audit/memory-audit.store.js';\nimport { MemoryNotificationsStore } from '../src/notifications/memory-notifications.store.js';\nimport { NOTIFICATIONS_STORE } from '../src/notifications/notifications.store.js';\nimport { BILLING_STORE } from '../src/billing/store/billing.store.js';\nimport { MemoryBillingStore } from '../src/billing/store/memory-billing.store.js';\nimport { DatabaseService } from '../src/database/database.service.js';\nimport { MemoryOidcStore } from '../src/oidc/store/memory-oidc.store.js';\nimport { OIDC_STORE } from '../src/oidc/store/oidc.store.js';\n"
        )
        e2e = replaceOnce(
            e2e,
            '// A fake database: the tests do not need PostgreSQL.\n',
            "process.env.OIDC_MASTER_KEY ??= randomBytes(32).toString('hex');\n\n// A fake database: the tests do not need PostgreSQL.\n"
        )
        result['test/app.e2e-spec.ts'] = replaceOnce(
            e2e,
            '      .useValue(database)\n',
            '      .useValue(database)\n      .overrideProvider(OIDC_STORE)\n      .useValue(new MemoryOidcStore())\n      .overrideProvider(BILLING_STORE)\n      .useValue(new MemoryBillingStore())\n      .overrideProvider(AUDIT_STORE)\n      .useValue(new MemoryAuditStore())\n      .overrideProvider(NOTIFICATIONS_STORE)\n      .useValue(new MemoryNotificationsStore())\n'
        )
    }
    if (app) Object.assign(result, appFiles(result, database, app, appBackend.options(appOptions)))
    result['README.md'] = backendReadme({
        database,
        auth: Boolean(auth),
        oidc: Boolean(oidcAnswers),
        app,
        appOptions: app ? appBackend.options(appOptions) : undefined,
        tenantRole: oidcAnswers
            ? oidc.tenantRole(database.database)
            : app
              ? appBackend.tenantRole(database.database)
              : null,
        port: app ? appBackend.APP_PORT : PORT,
        origin: app ? appOrigin(app) : FRONTEND_ORIGIN,
        table: auth ? login.usersTable(database.database) : null,
        translations: {
            en: {
                errors: JSON.parse(result['src/i18n/en/errors.json']),
                ...(oidcAnswers ? { oidc: oidc.MESSAGES.en, billing: oidc.BILLING_MESSAGES.en } : {})
            }
        }
    })
    return result
}

/** The frontend of an app linked to a login server (the port it was linked with). */
const appOrigin = link => `http://localhost:${link.port}`

/**
 * The changes for an app linked to a login server (Pasport): its own port and CORS origin, the access tokens of the
 * login server on every route (PasportModule, a global guard), the notes per organisation (NotesModule, RLS), and
 * @Public() on the routes that stay open. `result` holds the files with the database so far.
 */
function appFiles(result, database, link, choice) {
    const changed = appBackend.appFiles({ database: database.database, link, choice })
    const env = text =>
        replaceOnce(
            replaceOnce(text, `PORT=${PORT}\n`, `PORT=${appBackend.APP_PORT}\n`),
            `CORS_ORIGIN=${FRONTEND_ORIGIN}\n`,
            `CORS_ORIGIN=${appOrigin(link)}\n`
        ).replace(
            '# Port of the API (the Next.js frontend uses 3000)',
            '# Port of the API (the login server uses 4000)'
        )
    const options = appBackend.optionLines(choice, { appName: link.name })
    changed['.env'] = env(result['.env']) + appBackend.envLines(link) + options
    // The secret of the app (the eHealth vault) never in .env.example
    changed['.env.example'] = env(result['.env.example']) + appBackend.envLines(link, { example: true }) + options
    if (choice.files) changed['.gitignore'] = result['.gitignore'] + 'storage\n'
    for (const locale of LOCALES) {
        changed[`src/i18n/${locale}/errors.json`] = json({
            ...JSON.parse(result[`src/i18n/${locale}/errors.json`]),
            ...appBackend.ERRORS[locale],
            ...(choice.files ? appBackend.FILES_ERRORS[locale] : {})
        })
        changed[`src/i18n/${locale}/validation.json`] = json({
            ...TRANSLATIONS[locale].validation,
            ...appBackend.VALIDATION[locale]
        })
    }
    changed['src/main.ts'] = replaceOnce(
        files['src/main.ts'],
        ".setVersion('1.0')",
        ".setVersion('1.0')\n    .addBearerAuth()"
    )
    changed['src/main.ts'] = replaceOnce(
        changed['src/main.ts'],
        `get('PORT') ?? ${PORT})`,
        `get('PORT') ?? ${appBackend.APP_PORT})`
    )
    changed['src/setup.ts'] = replaceOnce(result['src/setup.ts'], `?? '${FRONTEND_ORIGIN}'`, `?? '${appOrigin(link)}'`)
    // The CORS test of the main e2e spec: the frontend of this app
    changed['test/app.e2e-spec.ts'] = replaceOnce(
        result['test/app.e2e-spec.ts'],
        `.set('Origin', '${FRONTEND_ORIGIN}').expect(200);
      expect(response.headers['access-control-allow-origin']).toBe('${FRONTEND_ORIGIN}');`,
        `.set('Origin', '${appOrigin(link)}').expect(200);
      expect(response.headers['access-control-allow-origin']).toBe('${appOrigin(link)}');`
    )
    changed['src/app.module.ts'] = replaceOnce(
        replaceOnce(
            result['src/app.module.ts'],
            "import { HealthController } from './health/health.controller.js';\n",
            "import { HealthController } from './health/health.controller.js';\nimport { NotesModule } from './notes/notes.module.js';\nimport { PasportModule } from './pasport/pasport.module.js';\n"
        ),
        '    DatabaseModule,\n',
        '    DatabaseModule,\n    PasportModule,\n    NotesModule,\n' +
            (choice.files ? '    FilesModule,\n' : '') +
            (choice.mail ? '    MailModule,\n' : '')
    )
    changed['src/app.module.ts'] = replaceOnce(
        changed['src/app.module.ts'],
        "import { NotesModule } from './notes/notes.module.js';\n",
        "import { NotesModule } from './notes/notes.module.js';\n" +
            (choice.files ? "import { FilesModule } from './files/files.module.js';\n" : '') +
            (choice.mail ? "import { MailModule } from './mail/mail.module.js';\n" : '')
    )
    if (choice.files) {
        // An upload is the raw file as the body (src/files); the limit is a little above the largest file
        changed['src/setup.ts'] = replaceOnce(
            replaceOnce(
                changed['src/setup.ts'],
                "import { ConfigService } from '@nestjs/config';\n",
                "import { ConfigService } from '@nestjs/config';\nimport type { NestExpressApplication } from '@nestjs/platform-express';\nimport { UPLOAD_TYPES } from './files/files.controller.js';\nimport { MAX_FILE_BYTES } from './files/files.service.js';\n"
            ),
            '  app.useGlobalPipes(',
            "  (app as NestExpressApplication).useBodyParser('raw', { type: UPLOAD_TYPES, limit: MAX_FILE_BYTES + 1024 * 1024 });\n  app.useGlobalPipes("
        )
    }
    // Every route needs a token of the login server, except these (the status card of the frontend, the examples)
    const open = (rel, controller, from) => {
        let content = replaceOnce(result[rel], controller, '@Public()\n' + controller)
        content = replaceOnce(
            content,
            "from '@nestjs/swagger';\n",
            `from '@nestjs/swagger';\nimport { Public } from '${from}';\n`
        )
        changed[rel] = content
    }
    open('src/app.controller.ts', '@Controller()\n', './pasport/access.js')
    open('src/health/health.controller.ts', "@Controller('health')\n", '../pasport/access.js')
    open('src/examples/examples.controller.ts', "@Controller('examples')\n", '../pasport/access.js')
    return changed
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
    docsFile: 'api.md',
    /** The API the frontend talks to (the frontend uses it for its language link and status card). */
    api: { port: PORT },

    /** Question: which database? (PostgreSQL only for now), followed by that database's own questions. */
    async ask({
        projectDir = process.cwd(),
        hasFrontend = false,
        prompts = { select, input, password, confirm },
        registry = databases
    } = {}) {
        const choice = await prompts.select({
            message: 'Welke database wil je gebruiken?',
            choices: [
                ...Object.values(registry).map(db => ({ name: db.label, value: db.id, description: db.description })),
                { name: 'Geen database (later)', value: 'none' }
            ]
        })
        if (choice === 'none') return { database: null, auth: false, oidc: null }
        const database = await registry[choice].ask({ projectDir, prompts })

        // Login: a simple test login (needs the frontend pages) or our own multi-tenant OpenID Connect server
        const table = login.usersTable(database.database)
        const how = await prompts.select({
            message: 'Login toevoegen?',
            choices: [
                {
                    name: 'Eigen OIDC-server (multi-tenant, OpenID Connect)',
                    value: 'oidc',
                    description: `Login met PKCE, tokens, tenants met Row-Level Security; tabel ${table}`
                },
                ...(hasFrontend
                    ? [
                          {
                              name: 'Inloggen via je bestaande Pasport OIDC-server (koppelcode)',
                              value: 'linked',
                              description:
                                  'Eén account voor al je apps: e-mail, passkey, eID en tweestaps via de server; een app met eigen data per organisatie'
                          },
                          {
                              name: 'Eenvoudige test-login (login- en registerpagina)',
                              value: 'simple',
                              description: `E-mail en wachtwoord met een sessiecookie; tabel ${table}`
                          }
                      ]
                    : []),
                { name: 'Geen login', value: 'none' }
            ]
        })
        // Linked to an existing login server: the CLI goes on with the questions of that app (linked.js)
        if (how === 'linked') return { database, auth: false, oidc: null, switchTo: 'linked' }
        const oidcAnswers = how === 'oidc' ? await oidc.ask({ projectDir, prompts, hasFrontend }) : null
        return { database, auth: how === 'simple', oidc: oidcAnswers }
    },

    next(answers) {
        const db = answers?.database
        return [
            `cd ${DIR}`,
            ...(db?.mode === 'docker' ? ['npm run db:up       (start PostgreSQL in Docker)'] : []),
            ...(db?.mode === 'local' ? ['npm run db:check    (test the database connection)'] : []),
            'npm run start:dev',
            `API: http://localhost:${PORT}  |  docs: http://localhost:${PORT}/docs`,
            ...(answers?.auth
                ? ['Login: http://localhost:3000/login  |  register: http://localhost:3000/register']
                : []),
            ...(answers?.oidc
                ? [
                      `OIDC: http://localhost:${PORT}/oidc/.well-known/openid-configuration`,
                      ...(answers.oidc.loginUi
                          ? ['Log in: http://localhost:3000/login  |  register: http://localhost:3000/register']
                          : []),
                      `npm run mail:dev    (Mailpit in Docker: every mail at ${oidc.MAILPIT_URL}; SMTP settings in .env)`,
                      ...(answers.oidc.loginUi
                          ? [
                                `eID: npm run eid:mock in ./frontend (virtual card reader, PIN ${EID_MOCK_PIN}), or a real card with the DafkeDD eID program`
                            ]
                          : []),
                      'npm run oidc:user -- --email ada@example.com --name "Ada" --tenant acme --role admin   (add a user)',
                      'npm run demo:data   (demo organisations, users, apps, invoices and tickets; npm run demo:clear takes them away)'
                  ]
                : [])
        ]
    },

    /** Extra result lines for the end of the run: { ok, text }. */
    summary(answers) {
        const db = answers?.database
        if (!db) return []
        const where = `${db.host}:${db.port}/${db.database}`
        const auth = answers?.auth
            ? [
                  {
                      ok: true,
                      text: `Login en registratie ingesteld (tabel ${login.usersTable(db.database)}, wordt bij de eerste start van de API aangemaakt)`
                  }
              ]
            : []
        if (answers?.oidc) {
            auth.push({
                ok: true,
                text: `OIDC-server ingesteld: superadmin ${answers.oidc.adminEmail}, tijdelijk wachtwoord ${answers.oidc.adminPassword} (enkel nu getoond). Bij de eerste login stel je tweestapsverificatie in (QR-code); organisaties maak je aan op http://localhost:3000/admin`
            })
            const demo = answers.oidc.demo
            if (demo)
                auth.push(
                    demo.added
                        ? {
                              ok: true,
                              text: `Demodata toegevoegd: an.peeters@demo.example.com (beheerder, arts), bram.janssens@, sofie.maes@ en koen.wouters@demo.example.com, wachtwoord ${demo.password} (enkel nu getoond). Weghalen: npm run demo:clear`
                          }
                        : {
                              ok: demo.added !== false,
                              text: `Demodata: start de database${db.mode === 'docker' ? ' (npm run db:up)' : ''} en voer in ./${DIR} npm run demo:data -- --password ${demo.password} uit`
                          }
                )
            auth.push({
                ok: true,
                text: `Inloggen en registreren met de Belgische eID staat aan (OIDC_EID=test: ook de testkaart van npm run eid:mock, pincode ${EID_MOCK_PIN}; zet OIDC_EID=on in productie)`
            })
        }
        if (db.mode === 'docker') return [{ ok: true, text: `PostgreSQL (Docker) ingesteld: ${where}` }, ...auth]
        if (db.connection === 'failed') {
            return [
                {
                    ok: false,
                    text: `Geen verbinding met PostgreSQL op ${where}. Controleer ./${DIR}/.env en start de database; test daarna met npm run db:check`
                },
                ...auth
            ]
        }
        return [{ ok: true, text: `Verbonden met PostgreSQL op ${where}` }, ...auth]
    },

    async steps({
        projectDir,
        exec = run,
        answers = {},
        secret = () => randomBytes(48).toString('hex'),
        // Shared with the frontend: { proxy } (API_PROXY_SECRET of the simple login)
        secrets = null,
        emptyEarlier = database => emptyDatabase(database, { exec })
    }) {
        const database = answers?.database ?? null
        const withAuth = Boolean(database && answers?.auth)
        const withOidc = database && answers?.oidc ? answers.oidc : null
        // An app linked to a login server (see linked.js): its tokens, its own database
        const withApp = database && answers?.app ? answers.app : null
        const appChoice = appBackend.options(answers?.appOptions)
        const appPackages = appBackend.packages(appChoice)
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
                run: async () => {
                    // npm 12+: no install scripts (and no warnings about them), see src/npm.js
                    await denyInstallScripts(root)
                    await exec('npm', ['install'], { cwd: root })
                }
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
            ...(withAuth
                ? [
                      {
                          title: 'Login-pakketten installeren (JWT, cookies, rate limiting)',
                          weight: 2,
                          run: async () => {
                              await exec('npm', ['install', ...login.PACKAGES.dependencies], { cwd: root })
                              await exec('npm', ['install', '--save-dev', ...login.PACKAGES.devDependencies], {
                                  cwd: root
                              })
                          }
                      }
                  ]
                : []),
            ...(withOidc
                ? [
                      {
                          title: 'OIDC-pakketten installeren (cookies)',
                          weight: 1,
                          run: async () => {
                              // DafkeDD eID comes from its release on GitHub (a URL): npm 12+ needs .npmrc for it
                              await allowEidDownload(root, exec, write)
                              await exec('npm', ['install', ...oidc.PACKAGES.dependencies], { cwd: root })
                              await exec('npm', ['install', '--save-dev', ...oidc.PACKAGES.devDependencies], {
                                  cwd: root
                              })
                          }
                      }
                  ]
                : []),
            ...(withApp && appPackages.dependencies.length
                ? [
                      {
                          title: `Pakketten van de app installeren (${[appChoice.mail && 'mail', appChoice.files && 'bestanden'].filter(Boolean).join(', ')})`,
                          weight: 1,
                          run: async () => {
                              await exec('npm', ['install', ...appPackages.dependencies], { cwd: root })
                              if (appPackages.devDependencies.length)
                                  await exec('npm', ['install', '--save-dev', ...appPackages.devDependencies], {
                                      cwd: root
                                  })
                          }
                      }
                  ]
                : []),
            {
                title: 'Prettier installeren (backend)',
                weight: 2,
                run: async () => {
                    // Fixed versions of dependencies of dependencies with a known vulnerability (npm audit in the CI)
                    const pkgPath = path.join(root, 'package.json')
                    const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'))
                    pkg.overrides = { ...pkg.overrides, ...SECURITY_OVERRIDES }
                    await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
                    await exec(
                        'npm',
                        ['install', '--save-dev', 'prettier@latest', 'prettier-plugin-tailwindcss@latest'],
                        {
                            cwd: root
                        }
                    )
                }
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
                    for (const [rel, content] of Object.entries(
                        buildFiles(database, {
                            auth: withAuth ? { jwtSecret: secret(), proxySecret: secrets?.proxy ?? secret() } : null,
                            oidc: withOidc,
                            app: withApp,
                            appOptions: appChoice
                        })
                    ))
                        await write(root, rel, content)
                    await patchNestCli(root)
                    if (database) {
                        const pkgPath = path.join(root, 'package.json')
                        const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'))
                        pkg.scripts = {
                            ...pkg.scripts,
                            ...databases[database.id].backend(database).scripts,
                            ...(withOidc ? oidc.SCRIPTS : {}),
                            ...(withApp ? appBackend.scripts(appChoice) : {})
                        }
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

        // The database of an earlier project with this name: emptied when that was the answer (postgres ask)
        if (database?.reset)
            steps.push({
                title: 'Vorige database leegmaken',
                weight: 1,
                run: () => emptyEarlier(database)
            })
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
        // Demo data, only when asked: it needs the database now (local; with Docker after npm run db:up)
        if (withOidc?.demo && database?.mode === 'local')
            steps.push({
                title: 'Demodata toevoegen',
                weight: 1,
                run: async () => {
                    if (database.connection !== 'ok') return
                    try {
                        await exec('npm', ['run', 'demo:data', '--', '--password', withOidc.demo.password], {
                            cwd: root
                        })
                        withOidc.demo.added = true
                    } catch (error) {
                        // Not fatal for the install: the summary says how to add it later
                        withOidc.demo.added = false
                        withOidc.demo.error = error instanceof Error ? error.message : String(error)
                    }
                }
            })

        return steps
    }
}

export const PRETTIERIGNORE_BACKEND = 'node_modules\ndist\ncoverage\npackage-lock.json\n'
