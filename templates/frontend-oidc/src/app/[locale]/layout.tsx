import type { ReactNode } from 'react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { hasLocale, NextIntlClientProvider } from 'next-intl'
import { setRequestLocale } from 'next-intl/server'
import { ThemeScript } from '@/components/theme-script'
import { ToastProvider } from '@/components/pasport/toast'
import { ThemeProvider } from '@/components/ui'
import { routing } from '@/i18n/routing'
import { APP_NAME, BRAND } from '@/lib/brand'
// The fonts of the Pasport design, self-hosted from npm (no request to Google; globals.css hands them to the tokens)
import '@fontsource-variable/hanken-grotesk'
import '@fontsource-variable/jetbrains-mono'
import '../globals.css'
// The Pasport design: tokens, the shell, the login screens and every component class (after the DafkeDD UI styles)
import '../../styles/pasport.css'

export const metadata: Metadata = { title: APP_NAME ?? BRAND }

export function generateStaticParams() {
    return routing.locales.map(locale => ({ locale }))
}

/**
 * Every page: the theme (light, dark or the system's), the texts of the language, the toasts. The shell (rail and
 * topbar) or the login screen comes from the page itself: AppPage (src/components/shell) or AuthLayout
 * (src/components/pasport/auth-layout.tsx).
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
                    <NextIntlClientProvider>
                        <ToastProvider>{children}</ToastProvider>
                    </NextIntlClientProvider>
                </ThemeProvider>
            </body>
        </html>
    )
}
