'use client'

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { type NavItem, Shell } from '@/components/pasport/shell'
import { usePathname } from '@/i18n/navigation'
import { APP_NAV } from '@/lib/nav'
import { BRAND } from '@/lib/brand'
import { useAccount } from './account'

/**
 * A page in the shell of the Pasport design (src/components/pasport/shell.tsx): the rail with the pages of APP_NAV
 * (src/lib/nav.ts), the topbar (search for a page with ⌘K, light or dark, the language, and the account when the
 * project has a login) and the content. Every page sits in it; `wide` uses the whole width.
 */
export function AppPage({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
    const t = useTranslations('Nav')
    const pathname = usePathname()
    const { account, menu } = useAccount()
    const nav: NavItem[] = APP_NAV.map(item => ({
        key: item.href,
        name: t(item.label),
        icon: item.icon,
        href: item.href
    }))
    // The most specific page is active (/ only on the home page)
    const active = APP_NAV.filter(item => (item.href === '/' ? pathname === '/' : pathname.startsWith(item.href))).sort(
        (a, b) => b.href.length - a.href.length
    )[0]
    const menuActive = menu.find(item => item.href && pathname.startsWith(item.href))
    return (
        <Shell
            brandSub={BRAND}
            nav={nav}
            menuItems={menu}
            activeKey={active?.href ?? menuActive?.key ?? ''}
            account={account}
            wide={wide}
        >
            {children}
        </Shell>
    )
}
