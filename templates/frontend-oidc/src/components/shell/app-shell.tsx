import { type ReactNode, Suspense } from 'react'
import { getTranslations } from 'next-intl/server'
import { Content } from '@/components/ui'
import { ACCOUNT_URL } from '@/lib/oidc'
import { APP_NAV } from '@/lib/nav'
import { getSession } from '@/lib/session'
import { type ShellSection, ShellView } from './shell-view'

/**
 * A page in the shell of the Pasport design: the sidebar (this app's pages, then the account, organisation and
 * platform pages of the login server), the topbar (language, theme, the user's menu) and the content.
 * Only the content and APP_NAV (src/lib/nav.ts) belong to this app; the rest is the same in every app.
 */
export function AppPage({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
    return (
        // The session is read per request: inside Suspense the rest of the page can still be prerendered
        <Suspense fallback={null}>
            <Shell wide={wide}>{children}</Shell>
        </Suspense>
    )
}

async function Shell({ children, wide }: { children: ReactNode; wide: boolean }) {
    const session = await getSession()
    const t = await getTranslations('Shell')
    const nav = await getTranslations('Nav')
    // On the login server ACCOUNT_URL is empty (its own pages); in a linked app it is the login server's frontend
    const account = (path: string) => ACCOUNT_URL + path
    const external = Boolean(ACCOUNT_URL)
    const admin = session?.tenant?.role === 'admin'
    const sections: ShellSection[] = [
        { items: APP_NAV.map(item => ({ href: item.href, label: nav(item.label), icon: item.icon, external: false })) }
    ]
    if (session) {
        sections.push({
            title: t('sectionAccount'),
            items: [
                { href: '/profile', label: t('profile'), icon: 'user', external: false },
                { href: account('/security'), label: t('security'), icon: 'lock', external }
            ]
        })
        if (admin)
            sections.push({
                title: session.tenant?.name ?? t('sectionOrganisation'),
                items: [
                    { href: account('/members'), label: t('members'), icon: 'users', external },
                    { href: account('/licenses'), label: t('licenses'), icon: 'creditcard', external },
                    { href: account('/audit'), label: t('audit'), icon: 'archive', external }
                ]
            })
        if (session.superadmin)
            sections.push({
                title: t('sectionPlatform'),
                items: [
                    { href: account('/admin'), label: t('platform'), icon: 'shield', external },
                    ...(admin
                        ? []
                        : [{ href: account('/audit'), label: t('audit'), icon: 'archive' as const, external }])
                ]
            })
    }
    return (
        <ShellView
            sections={sections}
            user={
                session
                    ? {
                          name: session.name || session.email,
                          email: session.email,
                          organisation: session.tenant?.name ?? t('sectionPlatform'),
                          profile: '/profile',
                          security: account('/security'),
                          external
                      }
                    : null
            }
        >
            <Content wide={wide}>{children}</Content>
        </ShellView>
    )
}
