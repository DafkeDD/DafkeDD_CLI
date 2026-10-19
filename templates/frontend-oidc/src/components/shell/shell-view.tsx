'use client'

import { type ReactNode, useRef } from 'react'
import { useTranslations } from 'next-intl'
import {
    AppMain,
    AppShell,
    Avatar,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
    Icon,
    type IconName,
    Sidebar,
    SidebarBrand,
    SidebarItem,
    SidebarNav,
    SidebarSection,
    ThemeToggle,
    Topbar,
    TopbarSpacer
} from '@/components/ui'
import { LocaleSwitcher } from '@/components/locale-switcher'
import { Presence } from '@/components/presence'
import { Link, usePathname, useRouter } from '@/i18n/navigation'
import { APP_NAME, BRAND } from '@/lib/brand'

export type ShellItem = { href: string; label: string; icon: IconName; external: boolean }
export type ShellSection = { title?: string; items: ShellItem[] }
export type ShellUser = {
    name: string
    email: string
    organisation: string
    profile: string
    security: string
    external: boolean
}

/** The brand mark of the Pasport design: the shield on an accent tile. */
export function BrandMark({ size = 40 }: { size?: number }) {
    return (
        <span
            className='grid flex-none place-items-center rounded-[var(--r-md)] bg-[var(--accent)] text-[var(--accent-fg)] shadow-[var(--sh-sm)]'
            style={{ width: size, height: size }}
        >
            <Icon name='shield' size={Math.round(size * 0.55)} />
        </span>
    )
}

/** The sidebar, the topbar and the content (see AppPage in app-shell.tsx, which gathers the items). */
export function ShellView({
    sections,
    user,
    children
}: {
    sections: ShellSection[]
    user: ShellUser | null
    children: ReactNode
}) {
    const t = useTranslations('Shell')
    const pathname = usePathname()
    const router = useRouter()
    const logout = useRef<HTMLFormElement>(null)
    const active = (item: ShellItem) =>
        !item.external && (item.href === '/' ? pathname === '/' : pathname.startsWith(item.href))

    return (
        <AppShell className='min-h-screen'>
            {user && <Presence />}
            <Sidebar>
                <SidebarBrand
                    logo={<Icon name='shield' />}
                    name={APP_NAME ?? BRAND}
                    subtitle={APP_NAME ? BRAND : t('account')}
                />
                <SidebarNav>
                    {sections.map((section, index) => (
                        <div key={section.title ?? index} className='contents'>
                            {section.title && <SidebarSection>{section.title}</SidebarSection>}
                            {section.items.map(item => (
                                <SidebarItem
                                    key={item.href + item.label}
                                    asChild
                                    icon={<Icon name={item.icon} />}
                                    active={active(item)}
                                >
                                    {item.external ? (
                                        <a href={item.href}>{item.label}</a>
                                    ) : (
                                        <Link href={item.href}>{item.label}</Link>
                                    )}
                                </SidebarItem>
                            ))}
                        </div>
                    ))}
                </SidebarNav>
            </Sidebar>
            <AppMain>
                <Topbar>
                    <TopbarSpacer />
                    <LocaleSwitcher />
                    <ThemeToggle aria-label={t('theme')} />
                    {user ? (
                        <DropdownMenu>
                            <DropdownMenuTrigger
                                className='flex cursor-pointer items-center gap-2.5 rounded-[var(--r-md)] px-1.5 py-1 hover:bg-[var(--surface-3)]'
                                aria-label={t('userMenu')}
                            >
                                <span className='hidden text-right sm:flex sm:flex-col'>
                                    <span className='text-sm leading-tight font-semibold'>{user.name}</span>
                                    <span className='text-xs leading-tight text-[var(--text-3)]'>
                                        {user.organisation}
                                    </span>
                                </span>
                                <Avatar name={user.name} size={34} />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align='end' minWidth={220}>
                                <DropdownMenuLabel>{user.email}</DropdownMenuLabel>
                                <DropdownMenuItem icon={<Icon name='user' />} onClick={() => router.push(user.profile)}>
                                    {t('profile')}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    icon={<Icon name='lock' />}
                                    onClick={() =>
                                        user.external
                                            ? window.location.assign(user.security)
                                            : router.push(user.security)
                                    }
                                >
                                    {t('security')}
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                    destructive
                                    icon={<Icon name='logout' />}
                                    onClick={() => logout.current?.requestSubmit()}
                                >
                                    {t('logout')}
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    ) : (
                        <form action='/api/auth/login' method='get'>
                            <button type='submit' className='lui-btn lui-btn-primary lui-btn-sm'>
                                {t('signIn')}
                            </button>
                        </form>
                    )}
                    {/* Logging out is a POST (only from a page of this app): the menu submits this form */}
                    <form ref={logout} method='post' action='/api/auth/logout' hidden />
                </Topbar>
                {children}
            </AppMain>
        </AppShell>
    )
}
