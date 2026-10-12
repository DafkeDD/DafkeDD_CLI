/**
 * Optional "test login/register" feature of the NestJS backend. Needs a database: users are stored in ONE table that is
 * always named <database name> + "users" (database "shop" gives the table "shopusers"). No ORM: plain SQL with pg.
 *
 * Production-minded choices:
 * - passwords are hashed with scrypt (built into Node, random salt per user, constant-time comparison)
 * - the session is a signed JWT in an httpOnly, SameSite=Lax cookie (Secure in production): scripts cannot read it
 * - login and register are rate limited per IP, and an unknown email takes as long as a wrong password
 * - JWT_SECRET is generated per project by the CLI and lives in .env (never committed)
 */

export const COOKIE = 'session'
export const SESSION_SECONDS = 60 * 60 * 24 * 7
export const DEFAULT_RATE_LIMIT = 10

/** The users table: the name of the database followed by "users". */
export const usersTable = database => {
    const name = `${database}users`
    if (name.length > 63) throw new Error(`De tabelnaam "${name}" is langer dan 63 tekens (limiet van PostgreSQL)`)
    return name
}

export const PACKAGES = {
    dependencies: ['@nestjs/jwt@latest', 'cookie-parser@latest', '@nestjs/throttler@latest'],
    devDependencies: ['@types/cookie-parser@latest']
}

export const ERRORS = {
    en: {
        EMAIL_TAKEN: 'This email address is already registered',
        INVALID_CREDENTIALS: 'Incorrect email address or password',
        TOO_MANY_REQUESTS: 'Too many attempts, try again later'
    },
    nl: {
        EMAIL_TAKEN: 'Dit e-mailadres is al geregistreerd',
        INVALID_CREDENTIALS: 'Onjuist e-mailadres of wachtwoord',
        TOO_MANY_REQUESTS: 'Te veel pogingen, probeer het later opnieuw'
    },
    fr: {
        EMAIL_TAKEN: 'Cette adresse e-mail est déjà enregistrée',
        INVALID_CREDENTIALS: 'Adresse e-mail ou mot de passe incorrect',
        TOO_MANY_REQUESTS: 'Trop de tentatives, réessayez plus tard'
    },
    de: {
        EMAIL_TAKEN: 'Diese E-Mail-Adresse ist bereits registriert',
        INVALID_CREDENTIALS: 'E-Mail-Adresse oder Passwort ist falsch',
        TOO_MANY_REQUESTS: 'Zu viele Versuche, bitte versuchen Sie es später erneut'
    }
}

export const VALIDATION = {
    en: { MAX_LENGTH: '{property} must be at most {constraints.0} characters long' },
    nl: { MAX_LENGTH: '{property} mag maximaal {constraints.0} tekens lang zijn' },
    fr: { MAX_LENGTH: '{property} doit contenir au maximum {constraints.0} caractères' },
    de: { MAX_LENGTH: '{property} darf höchstens {constraints.0} Zeichen lang sein' }
}

export const envLines = ({ jwtSecret }) =>
    [
        '',
        '# Login: secret that signs the session cookie. Keep it private and use a different one in production.',
        "# Generate one: node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\"",
        `JWT_SECRET='${jwtSecret}'`,
        '',
        '# Maximum login/register attempts per minute per IP address',
        `AUTH_RATE_LIMIT=${DEFAULT_RATE_LIMIT}`,
        ''
    ].join('\n')

export const EXAMPLE_SECRET = 'change-me-to-a-long-random-string'

const byLocale = key =>
    JSON.stringify(Object.fromEntries(Object.keys(ERRORS).map(locale => [locale, ERRORS[locale][key]])))

/** Files written into ./backend for the login feature. `table` is the name of the users table. */
export const authFiles = table => ({
    'src/users/users.table.ts': `/** The one table of this backend: the name of the database followed by "users". */
export const USERS_TABLE = '${table}';
`,

    'src/users/users.service.ts': `import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { USERS_TABLE } from './users.table.js';

export interface User {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
}

export interface UserWithHash extends User {
  passwordHash: string;
}

/** Only these fields ever leave the API: never the password hash. */
export const publicUser = (user: User): User => ({
  id: user.id,
  name: user.name,
  email: user.email,
  createdAt: user.createdAt,
});

const TABLE = '"' + USERS_TABLE + '"';
const PUBLIC_COLUMNS = 'id, name, email, created_at AS "createdAt"';

/** All SQL for the users table. Plain queries with parameters ($1, $2, ...): never build SQL from user input. */
@Injectable()
export class UsersService implements OnModuleInit {
  private readonly logger = new Logger(UsersService.name);
  private ready: Promise<void> | null = null;

  constructor(private readonly database: DatabaseService) {}

  async onModuleInit() {
    // The API also starts while the database is down: the table is then created on first use.
    try {
      await this.ensureTable();
    } catch {
      this.logger.warn('The ' + USERS_TABLE + ' table could not be created yet (is the database running?)');
    }
  }

  /** Creates the table (and the unique index on the email address) when it does not exist yet. */
  ensureTable(): Promise<void> {
    this.ready ??= this.createTable().catch((error: unknown) => {
      this.ready = null;
      throw error;
    });
    return this.ready;
  }

  private async createTable() {
    await this.database.query(
      [
        'CREATE TABLE IF NOT EXISTS ' + TABLE + ' (',
        'id uuid PRIMARY KEY DEFAULT gen_random_uuid(),',
        'name text NOT NULL,',
        'email text NOT NULL,',
        'password_hash text NOT NULL,',
        'created_at timestamptz NOT NULL DEFAULT now()',
        ')',
      ].join(' '),
    );
    await this.database.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS "' + USERS_TABLE + '_email_key" ON ' + TABLE + ' (lower(email))',
    );
  }

  async create(input: { name: string; email: string; passwordHash: string }): Promise<User> {
    await this.ensureTable();
    const result = await this.database.query<User>(
      'INSERT INTO ' + TABLE + ' (name, email, password_hash) VALUES ($1, $2, $3) RETURNING ' + PUBLIC_COLUMNS,
      [input.name, input.email, input.passwordHash],
    );
    return result.rows[0];
  }

  async findByEmail(email: string): Promise<UserWithHash | null> {
    await this.ensureTable();
    const result = await this.database.query<UserWithHash>(
      'SELECT ' + PUBLIC_COLUMNS + ', password_hash AS "passwordHash" FROM ' + TABLE + ' WHERE lower(email) = lower($1)',
      [email],
    );
    return result.rows[0] ?? null;
  }

  async findById(id: string): Promise<User | null> {
    await this.ensureTable();
    const result = await this.database.query<User>(
      'SELECT ' + PUBLIC_COLUMNS + ' FROM ' + TABLE + ' WHERE id = $1',
      [id],
    );
    return result.rows[0] ?? null;
  }
}
`,

    'src/users/users.module.ts': `import { Module } from '@nestjs/common';
import { UsersService } from './users.service.js';

@Module({
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
`,

    'src/users/users.service.spec.ts': `import { Logger } from '@nestjs/common';
import { publicUser, UsersService } from './users.service.js';
import { USERS_TABLE } from './users.table.js';

function setup(rows: unknown[] = []) {
  const query = vi.fn().mockResolvedValue({ rows });
  const service = new UsersService({ query } as never);
  return { query, service };
}

describe('UsersService', () => {
  it('uses ONE table, named after the database followed by "users"', () => {
    expect(USERS_TABLE).toBe('${table}');
    expect(USERS_TABLE.endsWith('users')).toBe(true);
  });

  it('creates the table and a unique index on the lower-case email once', async () => {
    const { query, service } = setup();
    await service.ensureTable();
    await service.ensureTable();
    const sql = query.mock.calls.map((call) => String(call[0]));
    expect(sql).toHaveLength(2);
    expect(sql[0]).toContain('CREATE TABLE IF NOT EXISTS "' + USERS_TABLE + '"');
    expect(sql[0]).toContain('password_hash');
    expect(sql[1]).toContain('CREATE UNIQUE INDEX IF NOT EXISTS');
    expect(sql[1]).toContain('lower(email)');
  });

  it('tries to create the table again after a failure (database was down)', async () => {
    const query = vi
      .fn()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValue({ rows: [] });
    const service = new UsersService({ query } as never);
    await expect(service.ensureTable()).rejects.toThrow('down');
    await expect(service.ensureTable()).resolves.toBeUndefined();
  });

  it('starts without crashing when the database is down', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const service = new UsersService({ query: vi.fn().mockRejectedValue(new Error('down')) } as never);
    await expect(service.onModuleInit()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('inserts with parameters, never with values in the SQL', async () => {
    const { query, service } = setup([{ id: '1', name: 'Ada', email: 'ada@example.com' }]);
    const user = await service.create({ name: "Ada'; DROP TABLE x;--", email: 'ada@example.com', passwordHash: 'h' });
    expect(user.id).toBe('1');
    const [sql, params] = query.mock.calls.at(-1) as [string, string[]];
    expect(sql).toContain('INSERT INTO "' + USERS_TABLE + '"');
    expect(sql).not.toContain('DROP TABLE');
    expect(params).toEqual(["Ada'; DROP TABLE x;--", 'ada@example.com', 'h']);
  });

  it('finds users by email (case-insensitive) and by id, and returns null when there is none', async () => {
    const { query, service } = setup([]);
    expect(await service.findByEmail('Ada@Example.com')).toBeNull();
    expect(await service.findById('1')).toBeNull();
    const sqls = query.mock.calls.map((call) => String(call[0]));
    expect(sqls.some((sql) => sql.includes('WHERE lower(email) = lower($1)'))).toBe(true);
    expect(sqls.some((sql) => sql.includes('WHERE id = $1'))).toBe(true);
  });

  it('publicUser keeps only id, name, email and createdAt', () => {
    const user = { id: '1', name: 'Ada', email: 'a@b.c', createdAt: new Date(0), passwordHash: 'secret' };
    expect(publicUser(user)).toEqual({ id: '1', name: 'Ada', email: 'a@b.c', createdAt: new Date(0) });
  });

  it('never selects the password hash for the public user', async () => {
    const { query, service } = setup([]);
    await service.findById('1');
    const sql = String(query.mock.calls.at(-1)?.[0]);
    expect(sql).not.toContain('password_hash');
  });
});
`,

    'src/auth/auth.constants.ts': `export const SESSION_COOKIE = '${COOKIE}';
export const SESSION_SECONDS = ${SESSION_SECONDS};
`,

    'src/auth/password.ts': `import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';

// scrypt with a random salt per password. The parameters are stored in the hash, so they can be raised later.
const N = 2 ** 15;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;

function derive(password: string, salt: Buffer, cost: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, KEY_LENGTH, { N: cost, r: R, p: P, maxmem: 128 * cost * R * 2 }, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

/** Returns "scrypt$<N>$<salt>$<hash>". */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, N);
  return ['scrypt', N, salt.toString('hex'), key.toString('hex')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, cost, saltHex, keyHex] = stored.split('$');
  if (scheme !== 'scrypt' || !cost || !saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, 'hex');
  const actual = await derive(password, Buffer.from(saltHex, 'hex'), Number(cost));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
`,

    'src/auth/password.spec.ts': `import { hashPassword, verifyPassword } from './password.js';

describe('passwords', () => {
  it('are stored as a salted scrypt hash, never as text', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(hash).not.toContain('correct horse battery');
  });

  it('give a different hash every time (random salt)', async () => {
    expect(await hashPassword('same password')).not.toBe(await hashPassword('same password'));
  });

  it('verify the right password and reject a wrong one', async () => {
    const hash = await hashPassword('s3cret-password');
    expect(await verifyPassword('s3cret-password', hash)).toBe(true);
    expect(await verifyPassword('S3cret-password', hash)).toBe(false);
    expect(await verifyPassword('', hash)).toBe(false);
  });

  it('reject malformed hashes instead of throwing', async () => {
    expect(await verifyPassword('x', '')).toBe(false);
    expect(await verifyPassword('x', 'plain-text')).toBe(false);
    expect(await verifyPassword('x', 'md5$1$aa$bb')).toBe(false);
  });
});
`,

    'src/auth/dto/register.dto.ts': `import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';

const clean = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const email = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);

export class RegisterDto {
  @ApiProperty({ example: 'Ada Lovelace' })
  @Transform(clean)
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @IsNotEmpty({ message: i18nValidationMessage('validation.NOT_EMPTY') })
  @MaxLength(100, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  name!: string;

  @ApiProperty({ example: 'ada@example.com' })
  @Transform(email)
  @IsEmail({}, { message: i18nValidationMessage('validation.IS_EMAIL') })
  @MaxLength(254, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  email!: string;

  @ApiProperty({ example: 'a-long-password', minLength: 8 })
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @MinLength(8, { message: i18nValidationMessage('validation.MIN_LENGTH') })
  @MaxLength(128, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  password!: string;
}
`,

    'src/auth/dto/login.dto.ts': `import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';

export class LoginDto {
  @ApiProperty({ example: 'ada@example.com' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: i18nValidationMessage('validation.IS_EMAIL') })
  email!: string;

  @ApiProperty({ example: 'a-long-password' })
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @IsNotEmpty({ message: i18nValidationMessage('validation.NOT_EMPTY') })
  @MaxLength(128, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  password!: string;
}
`,

    'src/auth/auth.service.ts': `import { HttpStatus, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AppException } from '../common/app.exception.js';
import { publicUser, User, UsersService } from '../users/users.service.js';
import type { LoginDto } from './dto/login.dto.js';
import type { RegisterDto } from './dto/register.dto.js';
import { hashPassword, verifyPassword } from './password.js';

// Checked when the email does not exist, so a login attempt takes equally long either way.
const DUMMY_HASH = await hashPassword('not-a-real-password');

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    if (await this.users.findByEmail(dto.email)) {
      throw new AppException('errors.EMAIL_TAKEN', HttpStatus.CONFLICT);
    }
    try {
      const user = await this.users.create({
        name: dto.name,
        email: dto.email,
        passwordHash: await hashPassword(dto.password),
      });
      return this.session(user);
    } catch (error) {
      // Two people registering the same address at the same moment: the unique index catches the second one.
      if ((error as { code?: string }).code === '23505') {
        throw new AppException('errors.EMAIL_TAKEN', HttpStatus.CONFLICT);
      }
      throw error;
    }
  }

  async login(dto: LoginDto) {
    const user = await this.users.findByEmail(dto.email);
    const valid = await verifyPassword(dto.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !valid) throw new AppException('errors.INVALID_CREDENTIALS', HttpStatus.UNAUTHORIZED);
    return this.session(user);
  }

  private async session(user: User) {
    return { user: publicUser(user), token: await this.jwt.signAsync({ sub: user.id }) };
  }
}
`,

    'src/auth/auth.guard.ts': `import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { AppException } from '../common/app.exception.js';
import { SESSION_COOKIE } from './auth.constants.js';

export type AuthenticatedRequest = Request & { userId: string };

/** Lets a request through when it carries a valid session cookie. Sets request.userId. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token: unknown = request.cookies?.[SESSION_COOKIE];
    if (typeof token !== 'string') throw new AppException('errors.UNAUTHORIZED', HttpStatus.UNAUTHORIZED);
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string }>(token);
      request.userId = payload.sub;
      return true;
    } catch {
      throw new AppException('errors.UNAUTHORIZED', HttpStatus.UNAUTHORIZED);
    }
  }
}
`,

    'src/auth/auth.controller.ts': `import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';
import { AppException } from '../common/app.exception.js';
import { publicUser, UsersService } from '../users/users.service.js';
import { SESSION_COOKIE, SESSION_SECONDS } from './auth.constants.js';
import { AuthGuard, type AuthenticatedRequest } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
    private readonly config: ConfigService,
  ) {}

  // httpOnly: scripts cannot read the cookie. SameSite=Lax: it is not sent along with cross-site requests.
  // Secure (HTTPS only) as soon as NODE_ENV=production.
  private cookieOptions() {
    return {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: this.config.get<string>('NODE_ENV') === 'production',
      path: '/',
    };
  }

  @Post('register')
  @UseGuards(ThrottlerGuard)
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) response: Response) {
    const { user, token } = await this.auth.register(dto);
    response.cookie(SESSION_COOKIE, token, { ...this.cookieOptions(), maxAge: SESSION_SECONDS * 1000 });
    return user;
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) response: Response) {
    const { user, token } = await this.auth.login(dto);
    response.cookie(SESSION_COOKIE, token, { ...this.cookieOptions(), maxAge: SESSION_SECONDS * 1000 });
    return user;
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@Res({ passthrough: true }) response: Response) {
    response.clearCookie(SESSION_COOKIE, this.cookieOptions());
    return { status: 'ok' };
  }

  @Get('me')
  @UseGuards(AuthGuard)
  async me(@Req() request: AuthenticatedRequest) {
    const user = await this.users.findById(request.userId);
    if (!user) throw new AppException('errors.UNAUTHORIZED', HttpStatus.UNAUTHORIZED);
    return publicUser(user);
  }
}
`,

    'src/auth/auth.module.ts': `import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { UsersModule } from '../users/users.module.js';
import { SESSION_SECONDS } from './auth.constants.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';

@Module({
  imports: [
    UsersModule,
    // Login and register: at most AUTH_RATE_LIMIT attempts per minute per IP address.
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        { ttl: 60_000, limit: Number(config.get<string>('AUTH_RATE_LIMIT') ?? ${DEFAULT_RATE_LIMIT}) },
      ],
    }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: SESSION_SECONDS },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthGuard],
})
export class AuthModule {}
`,

    'test/auth.e2e-spec.ts': `import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { DatabaseService } from '../src/database/database.service.js';
import { configureApp } from '../src/setup.js';
import { UsersService, type User, type UserWithHash } from '../src/users/users.service.js';

process.env.JWT_SECRET ??= 'test-only-secret';

/** An in-memory users table: these tests need no database. */
class FakeUsers {
  rows: UserWithHash[] = [];

  async onModuleInit() {}

  async findByEmail(email: string) {
    return this.rows.find((row) => row.email.toLowerCase() === email.toLowerCase()) ?? null;
  }

  async findById(id: string): Promise<User | null> {
    return this.rows.find((row) => row.id === id) ?? null;
  }

  async create(input: { name: string; email: string; passwordHash: string }): Promise<User> {
    const row = { id: crypto.randomUUID(), createdAt: new Date(), ...input };
    this.rows.push(row);
    return { id: row.id, name: row.name, email: row.email, createdAt: row.createdAt };
  }
}

async function createApp(users: FakeUsers) {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DatabaseService)
    .useValue({ ping: vi.fn().mockResolvedValue(true), query: vi.fn().mockResolvedValue({ rows: [] }) })
    .overrideProvider(UsersService)
    .useValue(users)
    .compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>();
  configureApp(app);
  await app.init();
  return app;
}

const cookieOf = (response: request.Response) => {
  const header = response.headers['set-cookie'] as unknown as string[] | undefined;
  return header?.find((cookie) => cookie.startsWith('session=')) ?? '';
};

const INVALID: Record<string, string> = ${byLocale('INVALID_CREDENTIALS')};
const TAKEN: Record<string, string> = ${byLocale('EMAIL_TAKEN')};
const BLOCKED: Record<string, string> = ${byLocale('TOO_MANY_REQUESTS')};

describe('login and register (e2e)', () => {
  let app: INestApplication<App>;
  let users: FakeUsers;
  const http = () => request(app.getHttpServer());
  const ada = { name: 'Ada Lovelace', email: 'ada@example.com', password: 'a-long-password' };

  beforeAll(async () => {
    process.env.AUTH_RATE_LIMIT = '1000';
    users = new FakeUsers();
    app = await createApp(users);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    users.rows = [];
  });

  describe('register', () => {
    it('creates the user, answers without the password and logs in with a safe cookie', async () => {
      const response = await http().post('/auth/register').send(ada).expect(201);
      expect(response.body).toMatchObject({ name: 'Ada Lovelace', email: 'ada@example.com' });
      expect(response.body.id).toBeTruthy();
      expect(JSON.stringify(response.body)).not.toMatch(/password|scrypt/i);
      const cookie = cookieOf(response);
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Lax');
      expect(cookie).toContain('Path=/');
    });

    it('stores a scrypt hash, never the password', async () => {
      await http().post('/auth/register').send(ada).expect(201);
      expect(users.rows[0].passwordHash.startsWith('scrypt$')).toBe(true);
      expect(users.rows[0].passwordHash).not.toContain(ada.password);
    });

    it('normalises the email address (trimmed, lower case)', async () => {
      await http().post('/auth/register').send({ ...ada, email: '  ADA@Example.COM ' }).expect(201);
      expect(users.rows[0].email).toBe('ada@example.com');
    });

    it.each(Object.entries(TAKEN))('refuses a second account with the same email (%s)', async (language, text) => {
      await http().post('/auth/register').send(ada).expect(201);
      const response = await http()
        .post('/auth/register')
        .set('Accept-Language', language)
        .send({ ...ada, email: 'ADA@example.com' })
        .expect(409);
      expect(response.body).toMatchObject({ statusCode: 409, error: 'errors.EMAIL_TAKEN', message: text });
    });

    it('translates validation errors (Dutch) and creates nothing', async () => {
      const response = await http()
        .post('/auth/register')
        .set('Accept-Language', 'nl')
        .send({ name: '', email: 'nope', password: 'short' })
        .expect(400);
      const text = JSON.stringify(response.body);
      expect(text).toContain('mag niet leeg zijn');
      expect(text).toContain('geldig e-mailadres');
      expect(text).toContain('minstens 8 tekens');
      expect(users.rows).toHaveLength(0);
    });

    it('limits the length of every field', async () => {
      await http()
        .post('/auth/register')
        .send({ ...ada, password: 'x'.repeat(129) })
        .expect(400);
      await http()
        .post('/auth/register')
        .send({ ...ada, name: 'x'.repeat(101) })
        .expect(400);
    });

    it('refuses unknown fields', async () => {
      await http()
        .post('/auth/register')
        .send({ ...ada, isAdmin: true })
        .expect(400);
    });
  });

  describe('login', () => {
    beforeEach(async () => {
      await http().post('/auth/register').send(ada).expect(201);
    });

    it('logs in with the right password and sets the session cookie', async () => {
      const response = await http()
        .post('/auth/login')
        .send({ email: 'ADA@example.com', password: ada.password })
        .expect(200);
      expect(response.body.email).toBe('ada@example.com');
      expect(cookieOf(response)).toContain('HttpOnly');
    });

    it.each(Object.entries(INVALID))('gives the same translated error for a wrong password (%s)', async (language, text) => {
      const response = await http()
        .post('/auth/login')
        .set('Accept-Language', language)
        .send({ email: ada.email, password: 'wrong-password' })
        .expect(401);
      expect(response.body).toMatchObject({ statusCode: 401, error: 'errors.INVALID_CREDENTIALS', message: text });
    });

    it('does not reveal whether an email address exists', async () => {
      const wrong = await http().post('/auth/login').send({ email: ada.email, password: 'nope-nope-nope' });
      const unknown = await http().post('/auth/login').send({ email: 'nobody@example.com', password: 'nope-nope-nope' });
      expect(unknown.status).toBe(wrong.status);
      expect(unknown.body.message).toBe(wrong.body.message);
    });
  });

  describe('session', () => {
    it('GET /auth/me returns the logged in user', async () => {
      const agent = request.agent(app.getHttpServer());
      await agent.post('/auth/register').send(ada).expect(201);
      const response = await agent.get('/auth/me').expect(200);
      expect(response.body).toMatchObject({ name: 'Ada Lovelace', email: 'ada@example.com' });
      expect(JSON.stringify(response.body)).not.toMatch(/password|scrypt/i);
    });

    it('GET /auth/me without a cookie is a translated 401', async () => {
      const response = await http().get('/auth/me').set('Accept-Language', 'de').expect(401);
      expect(response.body).toMatchObject({ statusCode: 401, error: 'errors.UNAUTHORIZED' });
      expect(response.body.message).not.toBe('errors.UNAUTHORIZED');
    });

    it('GET /auth/me with a forged cookie is a 401', async () => {
      await http().get('/auth/me').set('Cookie', 'session=not.a.jwt').expect(401);
    });

    it('logging out clears the cookie', async () => {
      const response = await http().post('/auth/logout').expect(200);
      expect(response.body).toEqual({ status: 'ok' });
      expect(cookieOf(response)).toMatch(/session=;/);
    });

    it('a deleted user can no longer use an old cookie', async () => {
      const agent = request.agent(app.getHttpServer());
      await agent.post('/auth/register').send(ada).expect(201);
      users.rows = [];
      await agent.get('/auth/me').expect(401);
    });
  });
});

describe('rate limit (e2e)', () => {
  it.each(Object.entries(BLOCKED))('blocks too many login attempts with a translated 429 (%s)', async (language, text) => {
    process.env.AUTH_RATE_LIMIT = '3';
    const app = await createApp(new FakeUsers());
    try {
      const attempt = () =>
        request(app.getHttpServer())
          .post('/auth/login')
          .set('Accept-Language', language)
          .send({ email: 'ada@example.com', password: 'wrong-password' });
      for (let i = 0; i < 3; i++) await attempt().expect(401);
      const blocked = await attempt().expect(429);
      expect(blocked.body).toMatchObject({ statusCode: 429, error: 'errors.TOO_MANY_REQUESTS', message: text });
    } finally {
      await app.close();
      process.env.AUTH_RATE_LIMIT = '1000';
    }
  });
});
`
})
