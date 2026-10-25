import { type ReactNode, Suspense } from 'react'
import { getTranslations } from 'next-intl/server'
import { ACCOUNT_URL } from '@/lib/oidc'
import { APP_NAV } from '@/lib/nav'
import { getSession } from '@/lib/session'
import { LoginRedirect } from './login-redirect'
import { type ShellSection, ShellView } from './shell-view'

/**
 * A page in the shell of the Pasport design (src/components/shell/shell-view.tsx): the rail with this app's pages,
 * then the pages of the organisation (admins) and the platform (superadmins) of the login server, the topbar (search,
 * notifications, theme, the user's menu with profile, security, language and log out) and the content. Only the content and APP_NAV
 * (src/lib/nav.ts) belong to this app; the rest is the same in every app.
 *
 * Every page is protected: the proxy (src/proxy.ts) already sends a browser without a session to /login; this is the
 * second line for a session that ended while the page was open. `admin`: the superadmin panel (the dark brand mark and
 * the platform pages in the rail).
 */
export function AppPage({
    children,
    wide = false,
    admin = false
}: {
    children: ReactNode
    wide?: boolean
    admin?: boolean
}) {
    return (
        // The session is read per request: inside Suspense the rest of the page can still be prerendered
        <Suspense fallback={null}>
            <Shell wide={wide} admin={admin}>
                {children}
            </Shell>
        </Suspense>
    )
}

async function Shell({ children, wide, admin }: { children: ReactNode; wide: boolean; admin: boolean }) {
    const session = await getSession()
    if (!session) return <LoginRedirect />
    const t = await getTranslations('Shell')
    const p = await getTranslations('Portal.Shell')
    const nav = await getTranslations('Nav')
    // ACCOUNT_URL: the frontend of the login server, with the portal and the superadmin panel
    const account = (path: string) => ACCOUNT_URL + path
    const external = Boolean(ACCOUNT_URL)
    const tenantAdmin = session.tenant?.role === 'admin'
    const sections: ShellSection[] = []
    if (admin)
        sections.push({
            items: [
                { href: account('/admin/tenants'), label: p('tenants'), icon: 'building', external },
                { href: account('/admin/tickets'), label: p('tickets'), icon: 'ticket', external },
                { href: account('/admin/catalog'), label: p('catalog'), icon: 'grid', external },
                { href: account('/admin/audit'), label: p('activity'), icon: 'activity', external }
            ]
        })
    else {
        sections.push({
            items: APP_NAV.map(item => ({ href: item.href, label: nav(item.label), icon: item.icon, external: false }))
        })
        // The portal of the login server: the apps of the organisation, and for its admins its users and invoices
        sections.push({
            title: session.tenant?.name ?? t('sectionOrganisation'),
            items: [
                { href: account('/dashboard'), label: p('dashboard'), icon: 'dashboard', external },
                { href: account('/marketplace'), label: p('marketplace'), icon: 'compass', external },
                ...(tenantAdmin
                    ? [
                          { href: account('/users'), label: p('users'), icon: 'users', external },
                          { href: account('/invoices'), label: p('invoices'), icon: 'invoice', external },
                          { href: account('/audit'), label: p('activity'), icon: 'activity', external }
                      ]
                    : []),
                { href: account('/support'), label: p('support'), icon: 'ticket', external }
            ]
        })
    }
    if (session.superadmin)
        sections.push(
            admin
                ? {
                      title: t('sectionPortal'),
                      items: [{ href: '/', label: t('portal'), icon: 'home', external: false }]
                  }
                : {
                      title: t('sectionPlatform'),
                      items: [{ href: account('/admin'), label: p('platform'), icon: 'shield', external }]
                  }
        )
    return (
        <ShellView
            admin={admin}
            wide={wide}
            accountUrl={ACCOUNT_URL}
            sections={sections}
            user={{
                name: session.name || session.email,
                email: session.email,
                organisation: admin || !session.tenant ? t('superadmin') : session.tenant.name,
                profile: '/profile',
                security: account(admin ? '/admin/security' : '/security'),
                external
            }}
        >
            {children}
        </ShellView>
    )
}
