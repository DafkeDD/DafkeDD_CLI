import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { select } from '@inquirer/prompts';
import { run } from '../runner.js';

const DIR = 'frontend';
const LOCALES = ['en', 'nl', 'fr', 'de'];
const DEFAULT_LOCALE = 'en';

// DafkeDD UI: componentenbibliotheek met een eigen CLI (dafke-ui). De CLI staat nog niet op npm,
// dus halen we de repo tijdelijk op, draaien de CLI in ./frontend en ruimen de kloon weer op.
const UI_REPO = 'https://github.com/DafkeDD/DafkeDD_UI.git';
const UI_BRANCH = 'main';
const UI_CONFIG = {
  componentsDir: 'src/components/ui',
  cssEntry: 'src/components/ui/ui.css',
  importAlias: '@/components/ui',
};

// Prettier-instellingen (exact zoals opgegeven)
const PRETTIERRC = `{
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
`;

// De DafkeDD UI-bestanden blijven ongemoeid, anders ziet 'dafke-ui update' ze als "zelf aangepast".
// AGENTS.md en next-env.d.ts worden door Next.js zelf herschreven (ook bij 'next dev').
const PRETTIERIGNORE = `node_modules
.next
out
build
package-lock.json
AGENTS.md
next-env.d.ts
dafke-ui.lock.json
src/components/ui
`;

// Alle teksten bestaan in elke taal. Voeg je een taal toe aan LOCALES, voeg dan ook hier een vertaling toe.
const MESSAGES = {
  en: {
    HomePage: {
      title: 'Welcome',
      description: 'Next.js, Tailwind CSS and next-intl are ready to use.',
      start: 'Get started',
      docs: 'Documentation',
      stackNext: 'App Router, TypeScript',
      stackTailwind: 'Utility-first styling',
      stackIntl: 'NL, FR, EN, DE',
      stackIcons: 'Thousands of icons',
    },
    Settings: { language: 'Language', theme: 'Theme', light: 'Light', dark: 'Dark', system: 'System' },
  },
  nl: {
    HomePage: {
      title: 'Welkom',
      description: 'Next.js, Tailwind CSS en next-intl zijn klaar voor gebruik.',
      start: 'Aan de slag',
      docs: 'Documentatie',
      stackNext: 'App Router, TypeScript',
      stackTailwind: 'Utility-first styling',
      stackIntl: 'NL, FR, EN, DE',
      stackIcons: 'Duizenden iconen',
    },
    Settings: { language: 'Taal', theme: 'Thema', light: 'Licht', dark: 'Donker', system: 'Systeem' },
  },
  fr: {
    HomePage: {
      title: 'Bienvenue',
      description: "Next.js, Tailwind CSS et next-intl sont prêts à l'emploi.",
      start: 'Commencer',
      docs: 'Documentation',
      stackNext: 'App Router, TypeScript',
      stackTailwind: 'Style utilitaire',
      stackIntl: 'NL, FR, EN, DE',
      stackIcons: "Des milliers d'icônes",
    },
    Settings: { language: 'Langue', theme: 'Thème', light: 'Clair', dark: 'Sombre', system: 'Système' },
  },
  de: {
    HomePage: {
      title: 'Willkommen',
      description: 'Next.js, Tailwind CSS und next-intl sind einsatzbereit.',
      start: "Los geht's",
      docs: 'Dokumentation',
      stackNext: 'App Router, TypeScript',
      stackTailwind: 'Utility-first-Styling',
      stackIntl: 'NL, FR, EN, DE',
      stackIcons: 'Tausende Icons',
    },
    Settings: { language: 'Sprache', theme: 'Design', light: 'Hell', dark: 'Dunkel', system: 'System' },
  },
};

const files = {
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

  // Next.js 16 gebruikt proxy.ts (voorheen middleware.ts)
  'src/proxy.ts': `import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

export default createMiddleware(routing);

export const config = {
  matcher: '/((?!api|trpc|_next|_vercel|.*\\\\..*).*)',
};
`,

  // Vertalingen: altijd in alle talen (en, nl, fr, de)
  ...Object.fromEntries(
    LOCALES.map((locale) => [`messages/${locale}.json`, JSON.stringify(MESSAGES[locale], null, 2) + '\n']),
  ),

  'src/app/[locale]/layout.tsx': `import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { ThemeSwitcher } from '@/components/theme-switcher';
import { ThemeScript } from '@/components/theme-script';
import { routing } from '@/i18n/routing';
import '../globals.css';

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <ThemeScript />
        <NextIntlClientProvider>
          <header className="flex justify-end gap-2 p-4">
            <LocaleSwitcher />
            <ThemeSwitcher />
          </header>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
`,

  'src/app/[locale]/page.tsx': `import { use } from 'react';
import { useTranslations } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';

export default function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  setRequestLocale(locale);
  const t = useTranslations('HomePage');

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-4xl font-bold">{t('title')}</h1>
      <p className="text-lg text-gray-600 dark:text-gray-400">{t('description')}</p>
    </main>
  );
}
`,

  // Thema: wordt vóór het schilderen gezet (geen flits). DafkeDD UI en Tailwind lezen data-theme.
  // useServerInsertedHTML voegt het script enkel tijdens de serverweergave in, zodat React in de browser geen waarschuwing geeft.
  // Bij een taalwissel zet Next de attributen van <html> terug: de observer past het opgeslagen thema dan opnieuw toe.
  'src/components/theme-script.tsx': `'use client';

import { useEffect } from 'react';
import { useServerInsertedHTML } from 'next/navigation';

const code = \`(function(){try{var p=localStorage.getItem('theme');if(p!=='light'&&p!=='dark')p='system';var d=p==='dark'||(p==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);var r=document.documentElement;r.setAttribute('data-theme',d?'dark':'light');r.style.colorScheme=d?'dark':'light'}catch(e){}})()\`;

function applyStored() {
  try {
    const stored = localStorage.getItem('theme');
    const dark = stored === 'dark' || (stored !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
    const root = document.documentElement;
    root.setAttribute('data-theme', dark ? 'dark' : 'light');
    root.style.colorScheme = dark ? 'dark' : 'light';
  } catch {}
}

export function ThemeScript() {
  useServerInsertedHTML(() => <script dangerouslySetInnerHTML={{ __html: code }} />);

  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      if (!root.hasAttribute('data-theme')) applyStored();
    });
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  return null;
}
`,

  'src/components/theme-switcher.tsx': `'use client';

import { useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';

type Theme = 'light' | 'dark' | 'system';

const KEY = 'theme';
const EVENT = 'themechange';

function read(): Theme {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

function apply(theme: Theme) {
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  const root = document.documentElement;
  root.setAttribute('data-theme', dark ? 'dark' : 'light');
  root.style.colorScheme = dark ? 'dark' : 'light';
}

function subscribe(onChange: () => void) {
  const media = matchMedia('(prefers-color-scheme: dark)');
  const onMedia = () => {
    if (read() === 'system') apply('system');
  };
  const onStorage = () => {
    apply(read());
    onChange();
  };
  media.addEventListener('change', onMedia);
  window.addEventListener('storage', onStorage);
  window.addEventListener(EVENT, onChange);
  return () => {
    media.removeEventListener('change', onMedia);
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(EVENT, onChange);
  };
}

export function ThemeSwitcher() {
  const t = useTranslations('Settings');
  const theme = useSyncExternalStore(subscribe, read, () => 'system' as Theme);

  function change(next: Theme) {
    try {
      localStorage.setItem(KEY, next);
    } catch {}
    apply(next);
    window.dispatchEvent(new Event(EVENT));
  }

  return (
    <select
      aria-label={t('theme')}
      value={theme}
      onChange={(event) => change(event.target.value as Theme)}
      className="bg-background text-foreground rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-gray-700"
    >
      <option value="light">{t('light')}</option>
      <option value="dark">{t('dark')}</option>
      <option value="system">{t('system')}</option>
    </select>
  );
}
`,

  'src/components/locale-switcher.tsx': `'use client';

import { useTransition } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';

function languageName(locale: string) {
  const name = new Intl.DisplayNames([locale], { type: 'language' }).of(locale) ?? locale;
  return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1);
}

export function LocaleSwitcher() {
  const t = useTranslations('Settings');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  function change(next: string) {
    startTransition(() => {
      router.replace(pathname, { locale: next as (typeof routing.locales)[number] });
    });
  }

  return (
    <select
      aria-label={t('language')}
      value={locale}
      disabled={isPending}
      onChange={(event) => change(event.target.value)}
      className="bg-background text-foreground rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-gray-700"
    >
      {routing.locales.map((value) => (
        <option key={value} value={value}>
          {languageName(value)}
        </option>
      ))}
    </select>
  );
}
`,
};

// Voorbeeld mét DafkeDD UI (enkel bij "alle componenten"): gebruikt het thema en de componenten van de bibliotheek.
const uiFiles = {
  'src/app/[locale]/layout.tsx': `import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { ThemeSwitcher } from '@/components/theme-switcher';
import { ThemeScript } from '@/components/theme-script';
import { ThemeProvider } from '@/components/ui';
import { routing } from '@/i18n/routing';
import '../globals.css';

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <ThemeScript />
        <ThemeProvider>
          <NextIntlClientProvider>
            <header className="relative z-10 flex flex-wrap items-center justify-between gap-3 px-6 py-5 sm:px-10">
              <div className="flex items-center gap-2.5">
                <span className="grid size-7 place-items-center rounded-lg bg-[var(--accent)] text-sm font-bold text-[var(--accent-fg)]">
                  D
                </span>
                <span className="text-[15px] font-semibold tracking-tight">DafkeDD</span>
              </div>
              <div className="flex gap-2">
                <LocaleSwitcher />
                <ThemeSwitcher />
              </div>
            </header>
            {children}
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
`,

  'src/app/[locale]/page.tsx': `import { use } from 'react';
import { useTranslations } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { LuArrowRight, LuGlobe, LuLayers, LuPalette, LuSparkles } from 'react-icons/lu';
import { Badge, Button } from '@/components/ui';

export default function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  setRequestLocale(locale);
  const t = useTranslations('HomePage');

  const stack = [
    { name: 'Next.js', text: t('stackNext'), icon: LuLayers },
    { name: 'Tailwind CSS', text: t('stackTailwind'), icon: LuPalette },
    { name: 'next-intl', text: t('stackIntl'), icon: LuGlobe },
    { name: 'react-icons', text: t('stackIcons'), icon: LuSparkles }
  ];

  return (
    <main className="relative flex flex-1 flex-col items-center justify-center gap-7 overflow-x-clip px-6 pt-10 pb-16 text-center">
      <div className="pointer-events-none absolute top-[-200px] left-1/2 h-[640px] w-[900px] -translate-x-1/2 bg-[radial-gradient(closest-side,color-mix(in_srgb,var(--accent)_14%,transparent),transparent)]" />

      <Badge tone="accent" dot>
        DafkeDD UI
      </Badge>

      <div className="relative flex flex-col items-center gap-3.5">
        <h1 className="text-5xl font-bold tracking-tight sm:text-6xl">{t('title')}</h1>
        <p className="max-w-md text-lg leading-relaxed text-[var(--text-2)]">{t('description')}</p>
      </div>

      <div className="relative flex flex-wrap justify-center gap-2.5">
        <Button className="h-11 gap-2 px-5">
          {t('start')}
          <LuArrowRight aria-hidden />
        </Button>
        <Button variant="secondary" className="h-11 px-5">
          {t('docs')}
        </Button>
      </div>

      <div className="relative mt-10 grid w-full max-w-3xl grid-cols-2 gap-3 text-left sm:grid-cols-4">
        {stack.map(({ name, text, icon: Icon }) => (
          <div key={name} className="flex flex-col gap-2.5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <span className="grid size-8 place-items-center rounded-[10px] bg-[var(--accent-tint)] text-[var(--accent)]">
              <Icon aria-hidden />
            </span>
            <span className="text-sm font-semibold">{name}</span>
            <span className="text-[13px] leading-snug text-[var(--text-3)]">{text}</span>
          </div>
        ))}
      </div>
    </main>
  );
}
`,

  // Zelfde opslagsleutels als de ThemeProvider van DafkeDD UI ('lui-theme'), zodat het script en de provider overeenkomen.
  // Bij een taalwissel zet Next de attributen van <html> terug: thema en dichtheid worden dan opnieuw toegepast.
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
`,

  'src/components/theme-switcher.tsx': `'use client';

import { useTranslations } from 'next-intl';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, useTheme } from '@/components/ui';
import type { Theme } from '@/components/ui';

export function ThemeSwitcher() {
  const t = useTranslations('Settings');
  const { theme, setTheme } = useTheme();

  return (
    <div className="w-36">
      <Select value={theme} onValueChange={(value) => setTheme(value as Theme)}>
        <SelectTrigger size="sm" aria-label={t('theme')}>
          <SelectValue placeholder={t(theme)} style={{ color: 'var(--text)' }} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="light">{t('light')}</SelectItem>
          <SelectItem value="dark">{t('dark')}</SelectItem>
          <SelectItem value="system">{t('system')}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
`,

  'src/components/locale-switcher.tsx': `'use client';

import { useTransition } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui';
import { usePathname, useRouter } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';

function languageName(locale: string) {
  const name = new Intl.DisplayNames([locale], { type: 'language' }).of(locale) ?? locale;
  return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1);
}

export function LocaleSwitcher() {
  const t = useTranslations('Settings');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  function change(next: string) {
    startTransition(() => {
      router.replace(pathname, { locale: next as (typeof routing.locales)[number] });
    });
  }

  return (
    <div className="w-40">
      <Select value={locale} onValueChange={change} disabled={isPending}>
        <SelectTrigger size="sm" aria-label={t('language')}>
          <SelectValue placeholder={languageName(locale)} style={{ color: 'var(--text)' }} />
        </SelectTrigger>
        <SelectContent>
          {routing.locales.map((value) => (
            <SelectItem key={value} value={value}>
              {languageName(value)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
`,
};

// Met DafkeDD UI komen kleuren en lettertype uit de tokens van de bibliotheek (base.css stijlt de body).
const UI_GLOBALS_CSS = `@import 'tailwindcss';
@import '../components/ui/ui.css';

@custom-variant dark (&:where([data-theme='dark'], [data-theme='dark'] *));

@theme inline {
  --color-background: var(--bg);
  --color-foreground: var(--text);
  --font-sans: var(--font);
  --font-mono: var(--mono);
}
`;

// next.config.ts van create-next-app bevat o.a. de Tailwind-koppeling: nooit overschrijven, enkel next-intl toevoegen.
async function patchNextConfig(root) {
  const file = path.join(root, 'next.config.ts');
  let content = await fs.readFile(file, 'utf8');
  if (content.includes('next-intl/plugin')) return;

  content = content.replace(/^(import[^\n]*\n)/m, `$1import createNextIntlPlugin from 'next-intl/plugin';\n`);
  content = content.replace(
    /export default nextConfig;?/,
    'const withNextIntl = createNextIntlPlugin();\n\nexport default withNextIntl(nextConfig);',
  );
  if (!content.includes('withNextIntl(nextConfig)') || !content.includes('next-intl/plugin')) {
    throw new Error('Kon next.config.ts niet automatisch aanpassen voor next-intl.');
  }
  await fs.writeFile(file, content);
}

// Dark mode via data-theme (zoals DafkeDD UI) in plaats van enkel prefers-color-scheme.
async function patchGlobalsCss(root) {
  const file = path.join(root, 'src/app/globals.css');
  let content = await fs.readFile(file, 'utf8');
  if (content.includes('data-theme')) return;

  const variant = "@custom-variant dark (&:where([data-theme='dark'], [data-theme='dark'] *));";
  content = content.replace(/(@import\s+["']tailwindcss["'];?[ \t]*\r?\n)/, `$1\n${variant}\n`);
  if (!content.includes(variant)) content = `${variant}\n${content}`;

  const media = /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{([^}]*)\}\s*\}/;
  if (media.test(content)) {
    content = content.replace(media, "[data-theme='dark'] {$1}");
  } else {
    content += "\n[data-theme='dark'] {\n  --background: #0a0a0a;\n  --foreground: #ededed;\n}\n";
  }
  await fs.writeFile(file, content);
}

async function write(root, rel, content) {
  const target = path.join(root, rel);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content);
}

export const nextjs = {
  id: 'nextjs',
  label: 'Next.js',
  description: 'Next.js (laatste) + Tailwind CSS (laatste) + next-intl (laatste) + react-icons + Prettier, in ./frontend',
  dir: DIR,
  next: [`cd ${DIR}`, 'npm run dev'],

  async ask() {
    const ui = await select({
      message: 'DafkeDD UI installeren?',
      choices: [
        { name: 'Ja, alle componenten', value: 'all', description: 'Config, tokens, helpers en alle componenten' },
        { name: 'Ja, enkel de basis (init)', value: 'init', description: 'Daarna zelf componenten toevoegen met dafke-ui add' },
        { name: 'Nee', value: 'none' },
      ],
    });
    return { ui };
  },

  async steps({ projectDir, answers }) {
    const root = path.join(projectDir, DIR);
    const exists = await fs.stat(root).then(() => true, () => false);
    if (exists) throw new Error(`De map ./${DIR} bestaat al. Verwijder of hernoem ze eerst.`);

    let uiTmp = null;
    const cleanupUi = async () => {
      if (uiTmp) await fs.rm(uiTmp, { recursive: true, force: true });
      uiTmp = null;
    };

    const steps = [
      {
        title: 'Next.js + Tailwind CSS aanmaken',
        weight: 3,
        run: () =>
          run('npx', [
            '--yes', 'create-next-app@latest', DIR,
            '--ts', '--tailwind', '--eslint', '--app', '--src-dir',
            '--import-alias', '@/*', '--use-npm',
            '--skip-install', '--disable-git', '--yes',
          ], { cwd: projectDir }),
      },
      {
        title: 'Dependencies installeren',
        weight: 4,
        run: () => run('npm', ['install'], { cwd: root }),
      },
      {
        title: 'next-intl installeren',
        weight: 2,
        run: () => run('npm', ['install', 'next-intl@latest'], { cwd: root }),
      },
      {
        title: 'react-icons installeren',
        weight: 2,
        run: () => run('npm', ['install', 'react-icons@latest'], { cwd: root }),
      },
      {
        title: 'Prettier installeren',
        weight: 2,
        run: () =>
          run('npm', ['install', '--save-dev', 'prettier@latest', 'prettier-plugin-tailwindcss@latest'], { cwd: root }),
      },
      {
        title: 'next-intl configureren',
        weight: 1,
        run: async () => {
          // Standaard template-pagina's vervangen door de [locale]-versie
          await fs.rm(path.join(root, 'src/app/page.tsx'), { force: true });
          await fs.rm(path.join(root, 'src/app/layout.tsx'), { force: true });
          const withUi = answers?.ui === 'all';
          for (const [rel, content] of Object.entries({ ...files, ...(withUi ? uiFiles : {}) })) {
            await write(root, rel, content);
          }
          await patchNextConfig(root);
          if (withUi) await write(root, 'src/app/globals.css', UI_GLOBALS_CSS);
          else await patchGlobalsCss(root);
        },
      },
    ];

    if (answers?.ui && answers.ui !== 'none') {
      const cli = () => path.join(uiTmp, 'packages', 'cli', 'bin', 'dafke-ui.mjs');
      steps.push(
        {
          title: 'DafkeDD UI ophalen',
          weight: 2,
          run: async () => {
            uiTmp = await fs.mkdtemp(path.join(os.tmpdir(), 'dafkedd-ui-'));
            try {
              await run('git', ['clone', '--depth', '1', '--branch', UI_BRANCH, '--single-branch', UI_REPO, uiTmp]);
            } catch (err) {
              await cleanupUi();
              throw err;
            }
          },
        },
        {
          title: 'DafkeDD UI installeren',
          weight: 2,
          run: async () => {
            try {
              await write(root, 'dafke-ui.json', JSON.stringify(UI_CONFIG, null, 2) + '\n');
              await run('node', [cli(), 'init', '--yes'], { cwd: root });
              if (answers.ui === 'all') await run('node', [cli(), 'add', '--all'], { cwd: root });

              // CSS-verzamelbestand van DafkeDD UI laden in de globale stylesheet
              const css = path.join(root, 'src/app/globals.css');
              const importLine = '@import "../components/ui/ui.css";';
              let content = await fs.readFile(css, 'utf8');
              if (!content.includes(importLine)) {
                content = content.replace(/(@import\s+["']tailwindcss["'];?\r?\n)/, `$1${importLine}\n`);
                if (!content.includes(importLine)) content = `${importLine}\n${content}`;
                await fs.writeFile(css, content);
              }
            } finally {
              await cleanupUi();
            }
          },
        },
      );
    }

    steps.push(
      {
        title: 'Prettier configureren',
        weight: 2,
        run: async () => {
          await write(root, '.prettierrc', PRETTIERRC);
          await write(root, '.prettierignore', PRETTIERIGNORE);

          const pkgPath = path.join(root, 'package.json');
          const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'));
          pkg.scripts = { ...pkg.scripts, format: 'prettier --write .', 'format:check': 'prettier --check .' };
          await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

          await run('npx', ['--no-install', 'prettier', '--write', '.'], { cwd: root });
        },
      },
      {
        title: 'Project controleren (build)',
        weight: 3,
        run: () => run('npm', ['run', 'build'], { cwd: root }),
      },
    );

    return steps;
  },
};
