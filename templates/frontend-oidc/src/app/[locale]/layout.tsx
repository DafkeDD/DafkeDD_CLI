import type { ReactNode } from 'react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { hasLocale, NextIntlClientProvider } from 'next-intl'
import { setRequestLocale } from 'next-intl/server'
import { ThemeScript } from '@/components/theme-script'
import { ThemeProvider } from '@/components/ui'
import { routing } from '@/i18n/routing'
import { APP_NAME, BRAND } from '@/lib/brand'
// The fonts of the Pasport design, self-hosted from npm (no request to Google; globals.css hands them to the tokens)
import '@fontsource-variable/hanken-grotesk'
import '@fontsource-variable/jetbrains-mono'
import '../globals.css'

export const metadata: Metadata = { title: APP_NAME ?? BRAND }

export function generateStaticParams() {
    return routing.locales.map(locale => ({ locale }))
}

/**
 * Every page: the theme (light, dark or the system's), the texts of the language. The shell (sidebar and topbar) or
 * the login screen comes from the page itself: AppPage or AuthPage (src/components/shell).
 */
export default async function LocaleLayout({
    children,
    params
}: {
    children: ReactNode
    params: Promise<{ locale: string }>
}) {
    const { locale } = await params
    if (!hasLocale(routing.locales, locale)) notFound()
    setRequestLocale(locale)

    return (
        <html lang={locale} suppressHydrationWarning>
            <body>
                <ThemeScript />
                <ThemeProvider>
                    <NextIntlClientProvider>{children}</NextIntlClientProvider>
                </ThemeProvider>
            </body>
        </html>
    )
}
