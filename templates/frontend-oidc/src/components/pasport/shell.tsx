'use client'

import { type FormEvent, type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useLocale } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { routing } from '@/i18n/routing'
import { APP_NAME, BRAND } from '@/lib/brand'
import { Avatar, Icon, type ShownPresence } from './ui'
import { ThemeToggle, useSwitchLocale } from './toast'
import { useT } from './i18n'

export { BRAND }

/**
 * An item of the rail or the user's menu. `label` alone: the title of a section in the rail. `external`: a page of
 * another frontend (the login server in a linked app), opened with a full navigation.
 */
export type NavItem = {
    key?: string
    name?: string
    icon?: string
    href?: string
    badge?: string
    label?: string
    external?: boolean
    /** Instead of a page: an action (the tour). */
    onClick?: () => void
}

/** The logged in user in the topbar: the name, a line under it, the menu and how to log out. */
export type ShellAccount = {
    name: string
    sub: string
    /** Shown at the top of the user's menu. */
    email?: string
    /** The status dot on the avatar (the presence of the login server); none without it. */
    status?: ShownPresence | null
    statusLabel?: string
    /** More of the menu between its pages and the language (the status of the login server). */
    menuExtra?: (close: () => void) => ReactNode
    onLogout: () => void
}

/** Opens a page: in this app (router), or with a full navigation for a page of another frontend. */
export function useOpen() {
    const router = useRouter()
    return (href: string, external = false) => {
        if (external) window.location.assign(href)
        else router.push(href)
    }
}

/** The collapsed/expanded rail, remembered in localStorage (pp-rail) and shared by every shell on the page. */
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
 * The shell of the Pasport design, the same in every project: the icon rail on the left (collapsible; a drawer behind
 * the menu button on a phone), the topbar with the search, the notifications, the theme and the user's menu (its pages,
 * the language, log out) and the content. Without an account: the language next to the theme. CustomerShell and
 * AdminShell (portal-shell.tsx, the login server) and AppPage (src/components/shell) fill it.
 */
export function Shell({
    brandName = APP_NAME ?? BRAND,
    brandSub,
    adminMark,
    nav,
    menuItems = [],
    activeKey,
    account,
    bell,
    onSearch,
    wide = false,
    after,
    children
}: {
    brandName?: string
    brandSub: string
    adminMark?: boolean
    nav: NavItem[]
    menuItems?: NavItem[]
    activeKey: string
    account?: ShellAccount | null
    bell?: ReactNode
    /** What the search does when no page has that name (the marketplace, the tenants). */
    onSearch?: (q: string) => void
    /** The content without the maximum width (a wide table or board). */
    wide?: boolean
    /** After the content: dialogs of the shell (the out-of-office reply). */
    after?: ReactNode
    children: ReactNode
}) {
    const t = useT('Shell')
    const openPage = useOpen()
    const locale = useLocale()
    const switchLocale = useSwitchLocale()
    const [drawer, setDrawer] = useState(false)
    // The rail starts collapsed unless the user expanded it before
    const collapsed = useSyncExternalStore(subscribeRail, railCollapsed, () => true)
    const [userMenu, setUserMenu] = useState(false)
    const userRef = useRef<HTMLDivElement>(null)
    const searchRef = useRef<HTMLInputElement>(null)
    /** The pages the search knows: the rail and the user's menu. */
    const pages = [...nav, ...menuItems].filter(item => item.href && item.name)

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
        const close = (e: MouseEvent) => {
            if (userRef.current && !userRef.current.contains(e.target as Node)) setUserMenu(false)
        }
        const escape = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return
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
    // ⌘K / Ctrl+K focuses the search field
    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault()
                searchRef.current?.focus()
            }
        }
        window.addEventListener('keydown', h)
        return () => window.removeEventListener('keydown', h)
    }, [])

    const go = (item: NavItem) => {
        setDrawer(false)
        setUserMenu(false)
        if (item.href) openPage(item.href, item.external)
    }
    /** The search of the topbar: a page whose name contains what was typed, else onSearch (apps, tenants). */
    const search = (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        const q = searchRef.current?.value.trim() ?? ''
        if (!q) return
        const page = pages.find(item => item.name!.toLowerCase().includes(q.toLowerCase()))
        if (page) {
            if (searchRef.current) searchRef.current.value = ''
            go(page)
        } else onSearch?.(q)
    }
    const markStyle = adminMark ? { background: 'var(--text)', color: 'var(--surface)' } : undefined
    const locales = (
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
    )

    return (
        <div className={'app-shell' + (collapsed ? ' rail-collapsed' : '')}>
            <div className={'sidebar-backdrop' + (drawer ? ' show' : '')} onClick={() => setDrawer(false)} />
            <aside className={'sidebar' + (drawer ? ' open' : '')}>
                <div className='rail-head'>
                    <div className='brand-mark' style={markStyle}>
                        <Icon name='shield' />
                    </div>
                    <div className='rail-brand-text'>
                        <div className='rail-brand-name'>{brandName}</div>
                        <div className='rail-brand-sub'>{brandSub}</div>
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
                    {nav.map(item =>
                        item.label ? (
                            <div className='rail-section-label' key={'label-' + item.label}>
                                {item.label}
                            </div>
                        ) : (
                            <a
                                key={item.key}
                                href={item.href}
                                className={'rail-item' + (activeKey === item.key ? ' active' : '')}
                                title={item.name}
                                aria-current={activeKey === item.key ? 'page' : undefined}
                                onClick={e => {
                                    // A click opens the page in the app; ctrl/cmd-click still opens a new tab
                                    if (e.metaKey || e.ctrlKey || e.shiftKey) return
                                    e.preventDefault()
                                    go(item)
                                }}
                            >
                                <Icon name={item.icon!} size={20} />
                                <span className='rail-label'>{item.name}</span>
                                {item.badge && <span className='rail-badge'>{item.badge}</span>}
                            </a>
                        )
                    )}
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
                            {pages.map(item => (
                                <option key={item.key ?? item.href} value={item.name} />
                            ))}
                        </datalist>
                        <span className='tb-kbd'>⌘K</span>
                    </form>
                    <div className='tb-right'>
                        {bell}
                        <ThemeToggle label={t('theme')} />
                        {account ? (
                            <>
                                <span className='tb-divider' />
                                <div className='tb-user-wrap' ref={userRef}>
                                    <button
                                        type='button'
                                        className={'tb-user' + (userMenu ? ' open' : '')}
                                        onClick={() => setUserMenu(o => !o)}
                                        aria-expanded={userMenu}
                                        aria-haspopup='menu'
                                        aria-label={t('userMenu')}
                                    >
                                        <div className='tb-user-text'>
                                            <div className='tb-user-name'>{account.name}</div>
                                            <div className='tb-user-sub'>{account.sub}</div>
                                        </div>
                                        <Avatar
                                            name={account.name}
                                            size={36}
                                            color={adminMark ? 'var(--text)' : null}
                                            status={account.status}
                                            statusLabel={account.statusLabel}
                                        />
                                        <Icon
                                            name='chevronDown'
                                            size={15}
                                            className={'uc-caret' + (userMenu ? ' up' : '')}
                                        />
                                    </button>
                                    {userMenu && (
                                        <div className='tb-user-pop pop-anim' role='menu'>
                                            {account.email && <div className='user-pop-head'>{account.email}</div>}
                                            {menuItems.map(mi => (
                                                <button
                                                    type='button'
                                                    role='menuitem'
                                                    key={mi.key}
                                                    className={
                                                        'user-pop-item' + (activeKey === mi.key ? ' active' : '')
                                                    }
                                                    onClick={() => {
                                                        go(mi)
                                                        mi.onClick?.()
                                                    }}
                                                >
                                                    <Icon name={mi.icon!} size={16} />
                                                    {mi.name}
                                                </button>
                                            ))}
                                            {menuItems.length > 0 && <div className='user-pop-sep' />}
                                            {account.menuExtra && (
                                                <>
                                                    {account.menuExtra(() => setUserMenu(false))}
                                                    <div className='user-pop-sep' />
                                                </>
                                            )}
                                            {locales}
                                            <div className='user-pop-sep' />
                                            <button
                                                type='button'
                                                role='menuitem'
                                                className='user-pop-item danger'
                                                onClick={() => {
                                                    setUserMenu(false)
                                                    account.onLogout()
                                                }}
                                            >
                                                <Icon name='logout' size={16} />
                                                {t('logout')}
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </>
                        ) : (
                            // No login: the language next to the theme
                            <div className='tb-locales'>{locales}</div>
                        )}
                    </div>
                </header>
                <div className={'content' + (wide ? ' content-wide' : '')}>{children}</div>
                {after}
            </div>
        </div>
    )
}
