import fs from 'node:fs/promises';
import path from 'node:path';
import { run } from '../runner.js';

const DIR = 'frontend';
const LOCALES = ['nl', 'en'];
const DEFAULT_LOCALE = 'nl';

const files = {
  'next.config.ts': `import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const nextConfig: NextConfig = {};

const withNextIntl = createNextIntlPlugin();
export default withNextIntl(nextConfig);
`,

  'src/i18n/routing.ts': `import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: ${JSON.stringify(LOCALES)},
  defaultLocale: '${DEFAULT_LOCALE}',
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

  'messages/nl.json': JSON.stringify(
    { HomePage: { title: 'Welkom', description: 'Next.js, Tailwind CSS en next-intl zijn klaar voor gebruik.' } },
    null, 2) + '\n',
  'messages/en.json': JSON.stringify(
    { HomePage: { title: 'Welcome', description: 'Next.js, Tailwind CSS and next-intl are ready to use.' } },
    null, 2) + '\n',

  'src/app/[locale]/layout.tsx': `import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
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
    <html lang={locale}>
      <body>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
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
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-4xl font-bold">{t('title')}</h1>
      <p className="text-lg text-gray-600">{t('description')}</p>
    </main>
  );
}
`,
};

async function write(root, rel, content) {
  const target = path.join(root, rel);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content);
}

export const nextjs = {
  id: 'nextjs',
  label: 'Next.js',
  description: 'Next.js (laatste) + Tailwind CSS (laatste) + next-intl (laatste), in ./frontend',
  dir: DIR,
  next: [`cd ${DIR}`, 'npm run dev'],

  async steps({ projectDir }) {
    const root = path.join(projectDir, DIR);
    const exists = await fs.stat(root).then(() => true, () => false);
    if (exists) throw new Error(`De map ./${DIR} bestaat al. Verwijder of hernoem ze eerst.`);

    return [
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
        title: 'next-intl configureren',
        weight: 1,
        run: async () => {
          // Standaard template-pagina's vervangen door de [locale]-versie
          await fs.rm(path.join(root, 'src/app/page.tsx'), { force: true });
          await fs.rm(path.join(root, 'src/app/layout.tsx'), { force: true });
          for (const [rel, content] of Object.entries(files)) await write(root, rel, content);
        },
      },
      {
        title: 'Project controleren (build)',
        weight: 3,
        run: () => run('npm', ['run', 'build'], { cwd: root }),
      },
    ];
  },
};
