import { type ReactNode, Suspense } from 'react'
import { getTranslations } from 'next-intl/server'
import { ACCOUNT_URL, OIDC_CLIENT_ID } from '@/lib/oidc'
import { APP_NAV } from '@/lib/nav'
import { getSession } from '@/lib/session'
import { LoginRedirect } from './login-redirect'
import { type ShellSection, ShellView } from './shell-view'

/**
 * A page in the shell of the Pasport design (src/components/shell/shell-view.tsx): the rail with this app's own pages
 * only (APP_NAV in src/lib/nav.ts), the topbar (search, notifications, theme, the user's menu with profile, security,
 * language and log out) and the content. The portal of the login server (its dashboard, apps, users, invoices, vault,
 * support and the superadmin panel) is not repeated here: it is on the login server itself. Only the content and
 * APP_NAV belong to this app; the rest is the same in every app.
 *
 * Every page is protected: the proxy (src/proxy.ts) already sends a browser without a session to /login; this is the
 * second line for a session that ended while the page was open.
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
    if (!session) return <LoginRedirect />
    const t = await getTranslations('Shell')
    const nav = await getTranslations('Nav')
    // ACCOUNT_URL: the frontend of the login server (the security page and the bell open there)
    const external = Boolean(ACCOUNT_URL)
    const sections: ShellSection[] = [
        {
            items: APP_NAV.map(item => ({ href: item.href, label: nav(item.label), icon: item.icon, external: false }))
        }
    ]
    return (
        <ShellView
            admin={false}
            wide={wide}
            accountUrl={ACCOUNT_URL}
            app={OIDC_CLIENT_ID}
            sections={sections}
            user={{
                name: session.name || session.email,
                email: session.email,
                organisation: !session.tenant ? t('superadmin') : session.tenant.name,
                profile: '/profile',
                security: ACCOUNT_URL + '/security',
                external,
                superadmin: session.superadmin
            }}
        >
            {children}
        </ShellView>
    )
}
