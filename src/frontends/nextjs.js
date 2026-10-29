import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { allowEidDownload, EID_MOCK_SCRIPT, EID_PACKAGE } from '../eid.js'
import { denyInstallScripts } from '../npm.js'
import { run } from '../runner.js'
import { AUTH_MESSAGES, authFiles } from './auth.js'
import { frontendReadme } from './docs.js'
import {
    AUDIT_MESSAGES,
    envLocal,
    LICENSE_MESSAGES,
    NAV_MESSAGES,
    NOTES_MESSAGES,
    APP_LICENSE_MESSAGES,
    OIDC_MESSAGES,
    oidcFrontendFiles,
    SHELL_MESSAGES,
    siteFrontendFiles
} from './oidc.js'
import {
    AUTH_SCREEN_MESSAGES,
    INVITE_MESSAGES,
    EID_GATE_MESSAGES,
    PASSWORD_MESSAGES,
    PROFILE_MESSAGES,
    REGISTER_MESSAGES
} from './pasport-messages.js'
import { PORTAL_MESSAGES } from './portal-messages.js'

export const DIR = 'frontend'
export const LOCALES = ['en', 'nl', 'fr', 'de']
export const DEFAULT_LOCALE = 'en'

// DafkeDD UI: a component library with a CLI of its own (dafke-ui). That CLI is not on npm yet,
// so the repository is fetched temporarily, its CLI runs in ./frontend and the clone is removed again.
export const UI_REPO = 'https://github.com/DafkeDD/DafkeDD_UI.git'
export const UI_BRANCH = 'developer'
export const UI_CONFIG = {
    componentsDir: 'src/components/ui',
    cssEntry: 'src/components/ui/ui.css',
    importAlias: '@/components/ui'
}

// Prettier-instellingen (exact zoals opgegeven)
export const PRETTIERRC = `{
    "arrowParens": "avoid",
    "singleQuote": true,
    "jsxSingleQuote": true,
    "tabWidth": 4,
    "trailingComma": "none",
    "semi": false,
    "proseWrap": "always",
    "printWidth": 120,
    "plugins": ["prettier-plugin-tailwindcss"],
    "overrides": [
        {
            "files": ["*.json", "*.jsonc"],
            "options": {
                "tabWidth": 4,
                "printWidth": 120,
                "trailingComma": "none"
            }
        }
    ]
}
`

// The DafkeDD UI files are left alone, otherwise 'dafke-ui update' sees them as "modified".
// AGENTS.md and next-env.d.ts are rewritten by Next.js itself (also by 'next dev').
export const PRETTIERIGNORE = `node_modules
.next
out
build
package-lock.json
AGENTS.md
next-env.d.ts
dafke-ui.lock.json
src/components/ui
`

// Every text exists in every language. When you add a language to LOCALES, add its translation here too.
export const MESSAGES = {
    en: {
        HomePage: {
            title: 'Welcome',
            description: 'Next.js, Tailwind CSS and next-intl are ready to use.',
            stackNext: 'App Router, TypeScript',
            stackTailwind: 'Utility-first styling',
            stackIntl: 'NL, FR, EN, DE',
            stackDesign: 'The design of every project'
        }
    },
    nl: {
        HomePage: {
            title: 'Welkom',
            description: 'Next.js, Tailwind CSS en next-intl zijn klaar voor gebruik.',
            stackNext: 'App Router, TypeScript',
            stackTailwind: 'Utility-first styling',
            stackIntl: 'NL, FR, EN, DE',
            stackDesign: 'Het design van elk project'
        }
    },
    fr: {
        HomePage: {
            title: 'Bienvenue',
            description: "Next.js, Tailwind CSS et next-intl sont prêts à l'emploi.",
            stackNext: 'App Router, TypeScript',
            stackTailwind: 'Style utilitaire',
            stackIntl: 'NL, FR, EN, DE',
            stackDesign: 'Le design de chaque projet'
        }
    },
    de: {
        HomePage: {
            title: 'Willkommen',
            description: 'Next.js, Tailwind CSS und next-intl sind einsatzbereit.',
            stackNext: 'App Router, TypeScript',
            stackTailwind: 'Utility-first-Styling',
            stackIntl: 'NL, FR, EN, DE',
            stackDesign: 'Das Design jedes Projekts'
        }
    }
}

export const files = {
    'src/i18n/routing.ts': `import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: ${JSON.stringify(LOCALES)},
  defaultLocale: '${DEFAULT_LOCALE}',
  // Geen taal in de URL: /nl en /en bestaan niet, de taal komt uit cookie of browsertaal
  localePrefix: 'never',
});
`,

    'src/i18n/navigation.ts': `import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
`,

    'src/i18n/request.ts': `import { hasLocale } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';
import { routing } from './routing';

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;

  return {
    locale,
    messages: (await import(\`../../messages/\${locale}.json\`)).default,
  };
});
`,

    // Next.js 16 uses proxy.ts (formerly middleware.ts)
    'src/proxy.ts': `import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

export default createMiddleware(routing);

export const config = {
  matcher: '/((?!api|trpc|_next|_vercel|.*\\\\..*).*)',
};
`,

    // Translations: always in every language (en, nl, fr, de)
    ...Object.fromEntries(
        LOCALES.map(locale => [`messages/${locale}.json`, JSON.stringify(MESSAGES[locale], null, 2) + '\n'])
    )
}

// The theme before the first paint (DafkeDD UI): every frontend, its layout comes with the Pasport design.
export const uiFiles = {
    // The same storage keys as the ThemeProvider of DafkeDD UI ('lui-theme'), so the script and the provider agree.
    // On a language switch Next resets the attributes of <html>: the theme and the density are then applied again.
    'src/components/theme-script.tsx': `'use client';

import { useEffect } from 'react';
import { useServerInsertedHTML } from 'next/navigation';

const code = \`(function(){try{var t=localStorage.getItem('lui-theme')||'system';var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);var r=document.documentElement;r.setAttribute('data-theme',d?'dark':'light');r.style.colorScheme=d?'dark':'light';var y=localStorage.getItem('lui-theme-density');if(y)r.setAttribute('data-density',y)}catch(e){}})()\`;

function applyStored() {
  try {
    const stored = localStorage.getItem('lui-theme') || 'system';
    const dark = stored === 'dark' || (stored === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    const root = document.documentElement;
    root.setAttribute('data-theme', dark ? 'dark' : 'light');
    root.style.colorScheme = dark ? 'dark' : 'light';
    root.setAttribute('data-density', localStorage.getItem('lui-theme-density') || 'regular');
  } catch {}
}

export function ThemeScript() {
  useServerInsertedHTML(() => <script dangerouslySetInnerHTML={{ __html: code }} />);

  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      if (!root.hasAttribute('data-theme') || !root.hasAttribute('data-density')) applyStored();
    });
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme', 'data-density'] });
    return () => observer.disconnect();
  }, []);

  return null;
}
`
}

// With DafkeDD UI the colours and the font come from the tokens of the library (base.css styles the body).
export const UI_GLOBALS_CSS = `@import 'tailwindcss';
@import '../components/ui/ui.css';

@custom-variant dark (&:where([data-theme='dark'], [data-theme='dark'] *));

@theme inline {
  --color-background: var(--bg);
  --color-foreground: var(--text);
  --font-sans: var(--font);
  --font-mono: var(--mono);
}

/* The fonts of the design (@fontsource-variable, loaded by the layout with the OIDC login) */
:root {
  --font: 'Hanken Grotesk Variable', 'Hanken Grotesk', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  --mono: 'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace;
}
`

/**
 * Texts of the backend status card. They are only added to the message files when a backend is installed.
 * Every language needs the same keys (checked by the tests).
 */
export const API_MESSAGES = {
    en: {
        title: 'Backend connection',
        api: 'API',
        loading: 'Connecting…',
        online: 'Connected',
        offline: 'Not reachable',
        database: 'Database',
        databaseUp: 'Connected',
        databaseDown: 'Not reachable',
        hint: 'Start the API: cd backend && npm run start:dev'
    },
    nl: {
        title: 'Verbinding met de backend',
        api: 'API',
        loading: 'Verbinden…',
        online: 'Verbonden',
        offline: 'Niet bereikbaar',
        database: 'Database',
        databaseUp: 'Verbonden',
        databaseDown: 'Niet bereikbaar',
        hint: 'Start de API: cd backend && npm run start:dev'
    },
    fr: {
        title: 'Connexion au backend',
        api: 'API',
        loading: 'Connexion…',
        online: 'Connecté',
        offline: 'Injoignable',
        database: 'Base de données',
        databaseUp: 'Connectée',
        databaseDown: 'Injoignable',
        hint: "Démarrez l'API : cd backend && npm run start:dev"
    },
    de: {
        title: 'Verbindung zum Backend',
        api: 'API',
        loading: 'Verbindung wird hergestellt…',
        online: 'Verbunden',
        offline: 'Nicht erreichbar',
        database: 'Datenbank',
        databaseUp: 'Verbunden',
        databaseDown: 'Nicht erreichbar',
        hint: 'API starten: cd backend && npm run start:dev'
    }
}

/**
 * Files that connect the frontend to the backend: an API client that sends the selected language
 * (Accept-Language, so server errors come back in that language), a hook for client components and a status card
 * for the example page.
 */
export const apiFiles = api => ({
    'src/lib/api.ts': `export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '${api.url ?? `http://localhost:${api.port}`}';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body: unknown,
  ) {
    super(message);
  }
}

/**
 * Calls the backend and sends the language of the user (Accept-Language), so error messages from the server
 * come back in that language. Use useApi() inside client components, or pass getLocale() on the server.
 */
export async function apiFetch<T>(path: string, locale: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Accept-Language', locale);
  // credentials: 'include' sends the session cookie of a logged in user along
  const response = await fetch(API_URL + path, { ...init, headers, credentials: 'include' });
  const body = await response.json().catch(() => null);
  // Validation errors come back as a list of messages (already in the selected language)
  const message = Array.isArray(body?.message) ? body.message.join('\\n') : body?.message;
  if (!response.ok) throw new ApiError(response.status, message ?? response.statusText, body);
  return body as T;
}
`,

    'src/lib/use-api.ts': `'use client';

import { useMemo } from 'react';
import { useLocale } from 'next-intl';
import { apiFetch } from './api';

/** API client for client components: always sends the language that is currently selected. */
export function useApi() {
  const locale = useLocale();
  return useMemo(
    () => ({
      get: <T>(path: string) => apiFetch<T>(path, locale),
      post: <T>(path: string, body: unknown) =>
        apiFetch<T>(path, locale, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
    }),
    [locale],
  );
}
`,

    'src/components/api-status.tsx': `'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/pasport/ui';
import { ApiError } from '@/lib/api';
import { useApi } from '@/lib/use-api';

type Status =
  | { state: 'loading' }
  | { state: 'offline' }
  | { state: 'online'; message: string; language: string; database: 'up' | 'down' | 'none'; databaseMessage?: string };

/** Shows that the frontend can reach the API, which language the API answered in and whether the database works. */
export function ApiStatus() {
  const t = useTranslations('ApiStatus');
  const api = useApi();
  const [status, setStatus] = useState<Status>({ state: 'loading' });

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const hello = await api.get<{ message: string; language: string }>('/');
        let database: 'up' | 'down' | 'none' = 'none';
        let databaseMessage: string | undefined;
        try {
          const health = await api.get<{ status: string; database?: string }>('/health');
          database = health.database === 'up' ? 'up' : 'none';
        } catch (error) {
          // The API answers 503 with a message in the selected language when its database is down.
          if (error instanceof ApiError && error.status === 503) {
            database = 'down';
            databaseMessage = error.message;
          }
        }
        if (active) setStatus({ state: 'online', message: hello.message, language: hello.language, database, databaseMessage });
      } catch {
        if (active) setStatus({ state: 'offline' });
      }
    })();
    return () => {
      active = false;
    };
  }, [api]);

  return (
    <section
      aria-live="polite"
      className="card card-pad flex w-full flex-col gap-4 text-left"
    >
      <h2 className="text-sm font-semibold">{t('title')}</h2>
      <ul className="flex flex-col gap-3 text-[13px]">
        <li className="flex items-start gap-2.5">
          <Icon name="server" size={16} className="mt-0.5 shrink-0" />
          <span>
            <strong>{t('api')}: </strong>
            {status.state === 'loading' && t('loading')}
            {status.state === 'offline' && <span className="text-[var(--red)]">{t('offline')}</span>}
            {status.state === 'online' && (
              <>
                <span className="text-[var(--green)]">{t('online')}</span>
                {' · '}
                {status.message}{' '}
                <span className="rounded-full border border-current/25 px-1.5 py-0.5 text-[11px] uppercase">
                  {status.language}
                </span>
              </>
            )}
          </span>
        </li>
        {status.state === 'online' && status.database !== 'none' && (
          <li className="flex items-start gap-2.5">
            <Icon name="database" size={16} className="mt-0.5 shrink-0" />
            <span>
              <strong>{t('database')}: </strong>
              {status.database === 'up' ? (
                <span className="text-[var(--green)]">{t('databaseUp')}</span>
              ) : (
                <span className="text-[var(--red)]">{status.databaseMessage ?? t('databaseDown')}</span>
              )}
            </span>
          </li>
        )}
      </ul>
      {status.state === 'offline' && <p className="text-xs opacity-70">{t('hint')}</p>}
    </section>
  );
}
`
})

const replaceOnce = (text, from, to) => {
    if (!text.includes(from)) throw new Error(`Template changed, cannot find: ${from}`)
    return text.replace(from, () => to)
}

/** The texts of the Pasport design in a project without the OpenID Connect login: the shell, the login screen, Nav. */
export const siteMessages = locale => ({
    Nav: NAV_MESSAGES[locale],
    Shell: SHELL_MESSAGES[locale],
    AuthScreen: AUTH_SCREEN_MESSAGES[locale],
    Portal: { Shell: PORTAL_MESSAGES[locale].Shell }
})

/**
 * Every frontend in the Pasport design. Without the OpenID Connect login (the login server and the apps linked to it
 * bring theirs): the layout, the home page in the shell (AppPage), the components and styles of the design, the
 * design check and their texts. The language and the theme are in the topbar of the shell.
 */
export function sitePages(fileMap, { api = null, appName = null } = {}) {
    const result = { ...fileMap }
    if (api?.oidc) return result
    Object.assign(result, siteFrontendFiles({ appName }))
    for (const locale of LOCALES)
        result[`messages/${locale}.json`] =
            JSON.stringify({ ...MESSAGES[locale], ...siteMessages(locale) }, null, 2) + '\n'
    return result
}

/**
 * Adds the backend connection to a set of frontend files: API client, status card, texts and the card on the page.
 * With the OIDC login (the login server itself, or an app linked to it) the frontend gets the Pasport design: its own
 * layout, home page, shell and login screen, built with DafkeDD UI (see oidcSteps: always installed then).
 */
export function withApi(fileMap, api, { ui }) {
    const result = {
        ...fileMap,
        ...(api.oidc ? uiFiles : {}),
        ...apiFiles(api),
        ...(api.auth ? authFiles() : {}),
        ...(api.oidc
            ? oidcFrontendFiles({
                  apiPort: api.port,
                  linked: Boolean(api.linked),
                  appName: api.linked?.name ?? null,
                  pasportApiUrl: api.linked?.apiUrl ?? ''
              })
            : {})
    }
    for (const locale of LOCALES) {
        result[`messages/${locale}.json`] =
            JSON.stringify(
                {
                    ...MESSAGES[locale],
                    ApiStatus: API_MESSAGES[locale],
                    ...(api.auth ? { Auth: AUTH_MESSAGES[locale] } : {}),
                    ...(api.oidc ? {} : siteMessages(locale)),
                    ...(api.oidc
                        ? {
                              Oidc: OIDC_MESSAGES[locale],
                              Licenses: LICENSE_MESSAGES[locale],
                              Audit: AUDIT_MESSAGES[locale],
                              Shell: SHELL_MESSAGES[locale],
                              Nav: NAV_MESSAGES[locale],
                              AuthScreen: AUTH_SCREEN_MESSAGES[locale],
                              Password: PASSWORD_MESSAGES[locale],
                              EidGate: EID_GATE_MESSAGES[locale],
                              Profile: PROFILE_MESSAGES[locale],
                              Portal: PORTAL_MESSAGES[locale],
                              ...(api.linked
                                  ? {}
                                  : { Register: REGISTER_MESSAGES[locale], Invite: INVITE_MESSAGES[locale] }),
                              ...(api.linked
                                  ? { Notes: NOTES_MESSAGES[locale], AppLicense: APP_LICENSE_MESSAGES[locale] }
                                  : {})
                          }
                        : {})
                },
                null,
                2
            ) + '\n'
    }
    if (api.oidc) return result
    // The home page in the shell: the status card of the API, and the account when the project has the simple login
    const page = 'src/app/[locale]/page.tsx'
    let content = replaceOnce(
        result[page],
        "import { AppPage } from '@/components/shell/app-shell'\n",
        "import { ApiStatus } from '@/components/api-status'\n" +
            (api.auth ? "import { AuthLinks } from '@/components/auth-links'\n" : '') +
            "import { AppPage } from '@/components/shell/app-shell'\n"
    )
    content = replaceOnce(
        content,
        '                </div>\n            </div>\n        </AppPage>',
        '                </div>\n' +
            (api.auth ? '                <AuthLinks />\n' : '') +
            '                <ApiStatus />\n            </div>\n        </AppPage>'
    )
    result[page] = content
    return result
}

/** next dev and next start on another port (package.json scripts). */
export async function setPort(root, port) {
    const file = path.join(root, 'package.json')
    const pkg = JSON.parse(await fs.readFile(file, 'utf8'))
    pkg.scripts = { ...pkg.scripts }
    for (const name of ['dev', 'start'])
        if (typeof pkg.scripts[name] === 'string' && !/ -p \d+/.test(pkg.scripts[name]))
            pkg.scripts[name] = `${pkg.scripts[name]} -p ${port}`
    await fs.writeFile(file, JSON.stringify(pkg, null, 2) + '\n')
}

// The next.config.ts of create-next-app holds the Tailwind setup among others: never overwrite it, only add next-intl.
export async function patchNextConfig(root) {
    const file = path.join(root, 'next.config.ts')
    let content = await fs.readFile(file, 'utf8')
    if (content.includes('next-intl/plugin')) return

    content = content.replace(/^(import[^\n]*\n)/m, `$1import createNextIntlPlugin from 'next-intl/plugin';\n`)
    content = content.replace(
        /export default nextConfig;?/,
        'const withNextIntl = createNextIntlPlugin();\n\nexport default withNextIntl(nextConfig);'
    )
    if (!content.includes('withNextIntl(nextConfig)') || !content.includes('next-intl/plugin')) {
        throw new Error('Kon next.config.ts niet automatisch aanpassen voor next-intl.')
    }
    await fs.writeFile(file, content)
}

// Dark mode through data-theme (like DafkeDD UI) instead of only prefers-color-scheme.
export async function patchGlobalsCss(root) {
    const file = path.join(root, 'src/app/globals.css')
    let content = await fs.readFile(file, 'utf8')
    if (content.includes('data-theme')) return

    const variant = "@custom-variant dark (&:where([data-theme='dark'], [data-theme='dark'] *));"
    content = content.replace(/(@import\s+["']tailwindcss["'];?[ \t]*\r?\n)/, `$1\n${variant}\n`)
    if (!content.includes(variant)) content = `${variant}\n${content}`

    const media = /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{([^}]*)\}\s*\}/
    if (media.test(content)) {
        content = content.replace(media, "[data-theme='dark'] {$1}")
    } else {
        content += "\n[data-theme='dark'] {\n  --background: #0a0a0a;\n  --foreground: #ededed;\n}\n"
    }
    await fs.writeFile(file, content)
}

/**
 * ESLint leaves the DafkeDD UI components alone (src/components/ui): they are the library's code, updated with
 * 'dafke-ui update', just like Prettier (.prettierignore).
 */
export async function ignoreUiInEslint(root) {
    const file = path.join(root, 'eslint.config.mjs')
    const content = await fs.readFile(file, 'utf8').catch(() => null)
    if (!content || content.includes('src/components/ui/**')) return
    const patched = content.replace(
        /globalIgnores\(\[/,
        "globalIgnores([\n        // DafkeDD UI: the library's own code (dafke-ui update)\n        'src/components/ui/**',"
    )
    if (patched !== content) await fs.writeFile(file, patched)
}

export async function write(root, rel, content) {
    const target = path.join(root, rel)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, content)
}

/** The fonts of the Pasport design (the layout of the OIDC login imports them). */
export const FONT_PACKAGES = [
    '@fontsource-variable/hanken-grotesk@latest',
    '@fontsource-variable/jetbrains-mono@latest'
]

/** DafkeDD UI: always all of it, in every project (the Pasport design builds on its theme and components). */
export const uiFor = () => 'all'

/**
 * DafkeDD UI in a frontend, with its CLI from the clone of the UI repository (`cli`): dafke-ui.json, init, every
 * component (`all`), ESLint skips its folder, and its stylesheet loaded from src/app/globals.css. Also used by
 * `update` for a frontend made before every project had it.
 */
export async function setupDafkeUi({ root, exec = run, cli, all = true }) {
    await write(root, 'dafke-ui.json', JSON.stringify(UI_CONFIG, null, 2) + '\n')
    await exec('node', [cli, 'init', '--yes'], { cwd: root })
    await ignoreUiInEslint(root)
    if (all) await exec('node', [cli, 'add', '--all'], { cwd: root })
    // Load the CSS bundle of DafkeDD UI in the global stylesheet
    const css = path.join(root, 'src/app/globals.css')
    const importLine = '@import "../components/ui/ui.css";'
    let content = await fs.readFile(css, 'utf8')
    if (!/components\/ui\/ui\.css/.test(content)) {
        content = content.replace(/(@import\s+["']tailwindcss["'];?\r?\n)/, `$1${importLine}\n`)
        if (!content.includes(importLine)) content = `${importLine}\n${content}`
        await fs.writeFile(css, content)
    }
}

/** A shallow clone of the UI repository (branch UI_BRANCH) in a temporary folder; returns the folder. */
export async function cloneDafkeUi(exec = run) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dafkedd-ui-'))
    try {
        await exec('git', ['clone', '--depth', '1', '--branch', UI_BRANCH, '--single-branch', UI_REPO, dir])
        return dir
    } catch (error) {
        await fs.rm(dir, { recursive: true, force: true })
        throw error
    }
}

/** The CLI of DafkeDD UI in a clone of its repository. */
export const dafkeUiCli = dir => path.join(dir, 'packages', 'cli', 'bin', 'dafke-ui.mjs')

export const nextjs = {
    id: 'nextjs',
    label: 'Next.js',
    description:
        'Next.js (laatste) + Tailwind CSS (laatste) + next-intl (laatste) + DafkeDD UI in het Pasport-design + Prettier, in ./frontend',
    dir: DIR,
    docsFile: 'frontend.md',
    next: [`cd ${DIR}`, 'npm run dev'],

    /** No question: every project gets DafkeDD UI and the Pasport design. */
    async ask() {
        return { ui: 'all' }
    },

    async steps({ projectDir, answers, api = null, exec = run }) {
        const root = path.join(projectDir, DIR)
        // The OIDC login (login server or linked app) is built with DafkeDD UI: the Pasport design, the same everywhere
        const ui = uiFor(answers, api)
        const exists = await fs.stat(root).then(
            () => true,
            () => false
        )
        if (exists) throw new Error(`De map ./${DIR} bestaat al. Verwijder of hernoem ze eerst.`)

        let uiTmp = null
        const cleanupUi = async () => {
            if (uiTmp) await fs.rm(uiTmp, { recursive: true, force: true })
            uiTmp = null
        }

        const steps = [
            {
                title: 'Next.js + Tailwind CSS aanmaken',
                weight: 3,
                run: () =>
                    exec(
                        'npx',
                        [
                            '--yes',
                            'create-next-app@latest',
                            DIR,
                            '--ts',
                            '--tailwind',
                            '--eslint',
                            '--app',
                            '--src-dir',
                            '--import-alias',
                            '@/*',
                            '--use-npm',
                            '--skip-install',
                            '--disable-git',
                            '--yes'
                        ],
                        { cwd: projectDir }
                    )
            },
            {
                title: 'Dependencies installeren',
                weight: 4,
                run: async () => {
                    // npm 12+: no install scripts (and no warnings about them), see src/npm.js
                    await denyInstallScripts(root)
                    await exec('npm', ['install'], { cwd: root })
                }
            },
            {
                title: 'next-intl installeren',
                weight: 2,
                run: () => exec('npm', ['install', 'next-intl@latest'], { cwd: root })
            },
            // The fonts of the Pasport design, self-hosted (the build never needs Google Fonts); its icons are its own
            {
                title: 'Lettertypen installeren (Hanken Grotesk, JetBrains Mono)',
                weight: 1,
                run: () => exec('npm', ['install', ...FONT_PACKAGES], { cwd: root })
            },
            // Login with the Belgian eID: the React hooks of DafkeDD eID (from its release on GitHub)
            ...(api?.oidc && !api.linked
                ? [
                      {
                          title: 'DafkeDD eID installeren',
                          weight: 1,
                          run: async () => {
                              await allowEidDownload(root, exec, write)
                              await exec('npm', ['install', EID_PACKAGE], { cwd: root })
                          }
                      }
                  ]
                : []),
            {
                title: 'Prettier installeren',
                weight: 2,
                run: () =>
                    exec('npm', ['install', '--save-dev', 'prettier@latest', 'prettier-plugin-tailwindcss@latest'], {
                        cwd: root
                    })
            },
            {
                title: 'next-intl configureren',
                weight: 1,
                run: async () => {
                    // Replace the default pages of the template by the [locale] version
                    await fs.rm(path.join(root, 'src/app/page.tsx'), { force: true })
                    await fs.rm(path.join(root, 'src/app/layout.tsx'), { force: true })
                    const withUi = ui === 'all'
                    // Every project in the Pasport design: without the OpenID Connect login its own home page and shell
                    let all = sitePages({ ...files, ...uiFiles }, { api, appName: path.basename(projectDir) })
                    // With a backend the frontend also gets the API client, the status card and their texts
                    if (api) all = withApi(all, api, { ui: withUi })
                    for (const [rel, content] of Object.entries(all)) await write(root, rel, content)
                    // Documentation of this frontend (replaces the README of create-next-app)
                    await write(root, 'README.md', frontendReadme({ ui, api, locales: LOCALES, apiPort: api?.port }))
                    // Login through the OIDC server: where it is, and the secret of the session cookie (never committed)
                    if (api?.oidc)
                        await write(root, '.env.local', envLocal({ apiPort: api.port, linked: api.linked ?? null }))
                    // Linked next to the login server on this computer: its own port (3000 is that server's frontend)
                    if (api?.linked) await setPort(root, api.linked.port)
                    await patchNextConfig(root)
                    if (withUi) await write(root, 'src/app/globals.css', UI_GLOBALS_CSS)
                    else await patchGlobalsCss(root)
                }
            }
        ]

        if (ui !== 'none') {
            const cli = () => path.join(uiTmp, 'packages', 'cli', 'bin', 'dafke-ui.mjs')
            steps.push(
                {
                    title: 'DafkeDD UI ophalen',
                    weight: 2,
                    run: async () => {
                        uiTmp = await fs.mkdtemp(path.join(os.tmpdir(), 'dafkedd-ui-'))
                        try {
                            await exec('git', [
                                'clone',
                                '--depth',
                                '1',
                                '--branch',
                                UI_BRANCH,
                                '--single-branch',
                                UI_REPO,
                                uiTmp
                            ])
                        } catch (err) {
                            await cleanupUi()
                            throw err
                        }
                    }
                },
                {
                    title: 'DafkeDD UI installeren',
                    weight: 2,
                    run: async () => {
                        try {
                            await setupDafkeUi({ root, exec, cli: cli(), all: ui === 'all' })
                        } finally {
                            await cleanupUi()
                        }
                    }
                }
            )
        }

        steps.push(
            {
                title: 'Prettier configureren',
                weight: 2,
                run: async () => {
                    await write(root, '.prettierrc', PRETTIERRC)
                    await write(root, '.prettierignore', PRETTIERIGNORE)

                    const pkgPath = path.join(root, 'package.json')
                    const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'))
                    pkg.scripts = { ...pkg.scripts, format: 'prettier --write .', 'format:check': 'prettier --check .' }
                    // A virtual card reader with a test eID (PIN 1234) that may log in on this frontend
                    if (api?.oidc && !api.linked) pkg.scripts['eid:mock'] = EID_MOCK_SCRIPT
                    // The Pasport design, checked (also in the CI): scripts/check-design.mjs
                    pkg.scripts['check:design'] = 'node scripts/check-design.mjs'
                    await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n')

                    await exec('npx', ['--no-install', 'prettier', '--write', '.'], { cwd: root })
                }
            },
            {
                title: 'Project controleren (build)',
                weight: 3,
                run: () => exec('npm', ['run', 'build'], { cwd: root })
            }
        )

        return steps
    }
}
