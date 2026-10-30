'use client'

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { AppTour } from '@/components/pasport/app-tour'
import { EidReminder, EidRequired, useEidRequired } from '@/components/pasport/eid-required'
import { PortalBell, PortalShell } from '@/components/pasport/portal-shell'
import { openTour } from '@/components/pasport/tour'
import type { NavItem } from '@/components/pasport/shell'
import { Icon } from '@/components/pasport/ui'
import { usePathname } from '@/i18n/navigation'
import { APP_NAME, BRAND } from '@/lib/brand'

export type ShellItem = { href: string; label: string; icon: string; external: boolean }
export type ShellSection = { title?: string; items: ShellItem[] }
export type ShellUser = {
    name: string
    email: string
    /** The opaque id of the account (sub): the tour remembers it, never the email address. */
    account: string
    organisation: string
    profile: string
    security: string
    external: boolean
    /** A superadmin never needs its eID: no reminder. */
    superadmin?: boolean
}

/** The brand mark of the Pasport design: the shield on an accent tile (dark in the superadmin panel). */
export function BrandMark({ admin = false, small = false }: { admin?: boolean; small?: boolean }) {
    return (
        <div
            className={'brand-mark' + (small ? ' sm' : '')}
            style={admin ? { background: 'var(--text)', color: 'var(--surface)' } : undefined}
        >
            <Icon name='shield' />
        </div>
    )
}

/**
 * The shell of the Pasport design (src/components/pasport/shell.tsx) around a page of this app: the rail with the
 * sections of AppPage (app-shell.tsx), the topbar with the search, the notifications, the theme and the user's menu
 * (profile, security, the tour, status, language, log out). `admin` is the superadmin panel: the dark brand mark. The
 * first-login tour (app-tour.tsx) is for the users of the app, never for a superadmin (the support team).
 */
export function ShellView({
    sections,
    user,
    admin = false,
    wide = false,
    accountUrl = '',
    app = '',
    children
}: {
    sections: ShellSection[]
    user: ShellUser
    admin?: boolean
    wide?: boolean
    /** The frontend of the login server in a linked app ('' on the login server): where notifications open. */
    accountUrl?: string
    /** The client id of this app: the login server sends the account back here after reading the eID. */
    app?: string
    children: ReactNode
}) {
    const t = useTranslations('Shell')
    const tour = useTranslations('AppTour')
    const pathname = usePathname()
    // An API call answered 403 oidc.EID_REQUIRED (OIDC_EID_REQUIRED, no eID linked yet): the eID screen instead
    const eidRequired = useEidRequired()
    const items = sections.flatMap(section => section.items)
    const isActive = (item: ShellItem) =>
        !item.external && (item.href === '/' ? pathname === '/' : pathname.startsWith(item.href))
    // The most specific item is active (/admin and /admin/apps: only the second)
    const active = items.filter(isActive).sort((a, b) => b.href.length - a.href.length)[0]
    const key = (item: ShellItem) => item.href + '#' + item.label
    const nav: NavItem[] = sections.flatMap(section => [
        ...(section.title ? [{ label: section.title }] : []),
        ...section.items.map(item => ({
            key: key(item),
            name: item.label,
            icon: item.icon,
            href: item.href,
            external: item.external
        }))
    ])
    const menu: NavItem[] = [
        { key: 'profile', name: t('profile'), icon: 'user', href: user.profile },
        { key: 'security', name: t('security'), icon: 'lock', href: user.security, external: user.external },
        // The tour is for the users of the app, not for the support team
        ...(user.superadmin || admin ? [] : [{ key: 'tour', name: tour('menu'), icon: 'compass', onClick: openTour }])
    ]
    const activeKey = active
        ? key(active)
        : pathname.startsWith(user.profile)
          ? 'profile'
          : !user.external && pathname.startsWith(user.security)
            ? 'security'
            : ''

    if (eidRequired) return <EidRequired email={user.email} accountUrl={accountUrl} app={app} />
    return (
        <PortalShell
            brandName={APP_NAME ?? BRAND}
            brandSub={admin ? t('superadmin') : APP_NAME ? BRAND : t('customerPortal')}
            adminMark={admin}
            nav={nav}
            menuItems={menu}
            activeKey={activeKey}
            user={user.name}
            userSub={user.organisation}
            email={user.email}
            wide={wide}
            bell={<PortalBell accountUrl={accountUrl} admin={admin} />}
        >
            {!user.superadmin && (
                <EidReminder href={accountUrl + '/security' + (app ? '?app=' + encodeURIComponent(app) : '')} />
            )}
            {children}
            {!user.superadmin && !admin && <AppTour account={user.account} name={user.name} />}
        </PortalShell>
    )
}
