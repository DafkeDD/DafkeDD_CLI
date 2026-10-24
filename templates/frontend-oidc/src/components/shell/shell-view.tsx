'use client'

import { type FormEvent, type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Presence } from '@/components/presence'
import { NotificationBell } from '@/components/pasport/notifications'
import { ThemeToggle, useSwitchLocale } from '@/components/pasport/toast'
import { Avatar, Icon } from '@/components/pasport/ui'
import { usePathname, useRouter } from '@/i18n/navigation'
import { routing } from '@/i18n/routing'
import { APP_NAME, BRAND } from '@/lib/brand'

export type ShellItem = { href: string; label: string; icon: string; external: boolean }
export type ShellSection = { title?: string; items: ShellItem[] }
export type ShellUser = {
    name: string
    email: string
    organisation: string
    profile: string
    security: string
    external: boolean
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

/* The rail is collapsed (icons only) unless the user expanded it; remembered in localStorage (pp-rail). */
const RAIL_EVENT = 'pp-rail'
function subscribeRail(onChange: () => void) {
    window.addEventListener(RAIL_EVENT, onChange)
    window.addEventListener('storage', onChange)
    return () => {
        window.removeEventListener(RAIL_EVENT, onChange)
        window.removeEventListener('storage', onChange)
    }
}
function railCollapsed() {
    try {
        return localStorage.getItem('pp-rail') !== 'expanded'
    } catch {
        return true
    }
}

/**
 * The shell of the Pasport design: the icon rail on the left (collapsible; a drawer behind the menu button on a phone),
 * the topbar with the search for a page, the notifications, the theme and the user's menu (profile, security, language, log out), and the
 * content. AppPage (app-shell.tsx) gathers the items; `admin` is the superadmin panel (/admin): the dark brand mark.
 */
export function ShellView({
    sections,
    user,
    admin = false,
    wide = false,
    accountUrl = '',
    children
}: {
    sections: ShellSection[]
    user: ShellUser
    admin?: boolean
    wide?: boolean
    /** The frontend of the login server in a linked app ('' on the login server): where notifications open. */
    accountUrl?: string
    children: ReactNode
}) {
    const t = useTranslations('Shell')
    const pathname = usePathname()
    const router = useRouter()
    const locale = useLocale()
    const switchLocale = useSwitchLocale()
    const [drawer, setDrawer] = useState(false)
    const collapsed = useSyncExternalStore(subscribeRail, railCollapsed, () => true)
    const [userMenu, setUserMenu] = useState(false)
    const userRef = useRef<HTMLDivElement>(null)
    const searchRef = useRef<HTMLInputElement>(null)
    const logout = useRef<HTMLFormElement>(null)
    const items = sections.flatMap(section => section.items)
    const isActive = (item: ShellItem) =>
        !item.external && (item.href === '/' ? pathname === '/' : pathname.startsWith(item.href))
    // The most specific item is active (/admin and /admin/apps: only the second)
    const active = items.filter(isActive).sort((a, b) => b.href.length - a.href.length)[0]

    const toggleRail = () => {
        try {
            localStorage.setItem('pp-rail', collapsed ? 'expanded' : 'collapsed')
        } catch {
            /* storage blocked: the rail stays as it is */
        }
        window.dispatchEvent(new Event(RAIL_EVENT))
    }
    useEffect(() => {
        document.body.style.overflow = drawer ? 'hidden' : ''
        return () => {
            document.body.style.overflow = ''
        }
    }, [drawer])
    useEffect(() => {
        if (!userMenu && !drawer) return
        const close = (event: MouseEvent) => {
            if (userRef.current && !userRef.current.contains(event.target as Node)) setUserMenu(false)
        }
        const escape = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return
            setUserMenu(false)
            setDrawer(false)
        }
        document.addEventListener('mousedown', close)
        document.addEventListener('keydown', escape)
        return () => {
            document.removeEventListener('mousedown', close)
            document.removeEventListener('keydown', escape)
        }
    }, [userMenu, drawer])
    // ⌘K / Ctrl+K: the search field
    useEffect(() => {
        const focus = (event: KeyboardEvent) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
                event.preventDefault()
                searchRef.current?.focus()
            }
        }
        window.addEventListener('keydown', focus)
        return () => window.removeEventListener('keydown', focus)
    }, [])

    const go = (item: { href: string; external: boolean }) => {
        setDrawer(false)
        setUserMenu(false)
        if (item.external) window.location.assign(item.href)
        else router.push(item.href)
    }
    /** The search of the topbar: the first page whose name contains what was typed. */
    const search = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        const query = searchRef.current?.value.trim().toLowerCase() ?? ''
        const found = query ? items.find(item => item.label.toLowerCase().includes(query)) : undefined
        if (!found) return
        if (searchRef.current) searchRef.current.value = ''
        go(found)
    }

    return (
        <div className={'app-shell' + (collapsed ? ' rail-collapsed' : '')}>
            <Presence />
            <div className={'sidebar-backdrop' + (drawer ? ' show' : '')} onClick={() => setDrawer(false)} />
            <aside className={'sidebar' + (drawer ? ' open' : '')}>
                <div className='rail-head'>
                    <BrandMark admin={admin} />
                    <div className='rail-brand-text'>
                        <div className='rail-brand-name'>{APP_NAME ?? BRAND}</div>
                        <div className='rail-brand-sub'>
                            {admin ? t('superadmin') : APP_NAME ? BRAND : t('customerPortal')}
                        </div>
                    </div>
                    <button
                        type='button'
                        className='drawer-close'
                        onClick={() => setDrawer(false)}
                        aria-label={t('close')}
                    >
                        <Icon name='x' size={19} />
                    </button>
                </div>
                <nav className='rail-nav' aria-label={t('navigation')}>
                    {sections.map((section, index) => (
                        <div key={section.title ?? index} style={{ display: 'contents' }}>
                            {section.title && <div className='rail-section-label'>{section.title}</div>}
                            {section.items.map(item => (
                                <a
                                    key={item.href + item.label}
                                    href={item.href}
                                    className={'rail-item' + (item === active ? ' active' : '')}
                                    title={item.label}
                                    aria-current={item === active ? 'page' : undefined}
                                    onClick={event => {
                                        // A click opens the page in the app; ctrl/cmd-click still opens a new tab
                                        if (event.metaKey || event.ctrlKey || event.shiftKey) return
                                        event.preventDefault()
                                        go(item)
                                    }}
                                >
                                    <Icon name={item.icon} size={20} />
                                    <span className='rail-label'>{item.label}</span>
                                </a>
                            ))}
                        </div>
                    ))}
                </nav>
            </aside>
            <div className='main'>
                <header className='topbar'>
                    <button
                        type='button'
                        className='nav-toggle'
                        onClick={() => setDrawer(true)}
                        aria-label={t('menu')}
                        aria-expanded={drawer}
                    >
                        <Icon name='menu' size={20} />
                    </button>
                    <button
                        type='button'
                        className='rail-toggle'
                        onClick={toggleRail}
                        aria-label={collapsed ? t('expandSidebar') : t('collapseSidebar')}
                        title={collapsed ? t('expand') : t('collapse')}
                    >
                        <Icon name='menu' size={20} />
                    </button>
                    <form className='tb-search' role='search' onSubmit={search}>
                        <Icon name='search' size={18} />
                        <input
                            ref={searchRef}
                            placeholder={t('search')}
                            aria-label={t('search')}
                            list='pp-pages'
                            autoComplete='off'
                        />
                        <datalist id='pp-pages'>
                            {items.map(item => (
                                <option key={item.href + item.label} value={item.label} />
                            ))}
                        </datalist>
                        <span className='tb-kbd'>⌘K</span>
                    </form>
                    <div className='tb-right'>
                        <NotificationBell accountUrl={accountUrl} />
                        <ThemeToggle label={t('theme')} />
                        <span className='tb-divider' />
                        <div className='tb-user-wrap' ref={userRef}>
                            <button
                                type='button'
                                className={'tb-user' + (userMenu ? ' open' : '')}
                                onClick={() => setUserMenu(open => !open)}
                                aria-expanded={userMenu}
                                aria-haspopup='menu'
                                aria-label={t('userMenu')}
                            >
                                <div className='tb-user-text'>
                                    <div className='tb-user-name'>{user.name}</div>
                                    <div className='tb-user-sub'>{user.organisation}</div>
                                </div>
                                <Avatar
                                    name={user.name}
                                    size={36}
                                    color={admin ? 'var(--text)' : null}
                                    status='available'
                                    statusLabel={t('online')}
                                />
                                <Icon name='chevronDown' size={15} className={'uc-caret' + (userMenu ? ' up' : '')} />
                            </button>
                            {userMenu && (
                                <div className='tb-user-pop pop-anim' role='menu'>
                                    <div className='user-pop-head'>{user.email}</div>
                                    <button
                                        type='button'
                                        role='menuitem'
                                        className={
                                            'user-pop-item' + (pathname.startsWith(user.profile) ? ' active' : '')
                                        }
                                        onClick={() => go({ href: user.profile, external: false })}
                                    >
                                        <Icon name='user' size={16} />
                                        {t('profile')}
                                    </button>
                                    <button
                                        type='button'
                                        role='menuitem'
                                        className={
                                            'user-pop-item' +
                                            (!user.external && pathname.startsWith(user.security) ? ' active' : '')
                                        }
                                        onClick={() => go({ href: user.security, external: user.external })}
                                    >
                                        <Icon name='lock' size={16} />
                                        {t('security')}
                                    </button>
                                    <div className='user-pop-sep' />
                                    <div className='user-pop-locales' role='group' aria-label={t('language')}>
                                        <Icon name='globe' size={16} />
                                        {routing.locales.map(value => (
                                            <button
                                                key={value}
                                                type='button'
                                                className={value === locale ? 'active' : ''}
                                                aria-pressed={value === locale}
                                                onClick={() => {
                                                    setUserMenu(false)
                                                    switchLocale(value)
                                                }}
                                            >
                                                {value}
                                            </button>
                                        ))}
                                    </div>
                                    <div className='user-pop-sep' />
                                    <button
                                        type='button'
                                        role='menuitem'
                                        className='user-pop-item danger'
                                        onClick={() => {
                                            setUserMenu(false)
                                            logout.current?.requestSubmit()
                                        }}
                                    >
                                        <Icon name='logout' size={16} />
                                        {t('logout')}
                                    </button>
                                </div>
                            )}
                        </div>
                        {/* Logging out is a POST (only from a page of this app): the menu submits this form */}
                        <form ref={logout} method='post' action='/api/auth/logout' hidden />
                    </div>
                </header>
                <div className={'content' + (wide ? ' content-wide' : '')}>{children}</div>
            </div>
        </div>
    )
}
