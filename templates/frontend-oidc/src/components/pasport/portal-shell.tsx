'use client'

import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from '@/i18n/navigation'
import { usePresence } from '@/components/presence'
import {
    type Notification,
    PRESENCES,
    type Ticket,
    onTicketsChanged,
    ticketsChanged,
    useApi,
    useFormat
} from '@/lib/portal'
import { EidReminder, EidRequired, useEidRequired } from './eid-required'
import { Btn, Icon } from './ui'
import { useToast } from './toast'
import { useT } from './i18n'
import { openTour, Tour } from './tour'
import { OutOfOfficeDialog } from './out-of-office'
import { type NavItem, Shell, useOpen } from './shell'

/*
 * The shell of the login server and of the apps linked to it: Shell (shell.tsx) with the notifications of the login
 * server, the own status and out-of-office reply (like Microsoft Teams), and the customer portal and superadmin panel.
 */

/** Logs out: a POST form (the route checks the Origin), then the login server ends its session too. */
export function logout() {
    const form = document.createElement('form')
    form.method = 'post'
    form.action = '/api/auth/logout'
    document.body.appendChild(form)
    form.submit()
}

/* ============================ NOTIFICATION BELL ============================ */
function NotificationBell({
    notifs,
    onOpen,
    onClear
}: {
    notifs: Notification[]
    onOpen: (n: Notification) => void
    onClear: () => void
}) {
    const t = useT('Shell')
    const text = useNotificationText()
    const [open, setOpen] = useState(false)
    const ref = useRef<HTMLDivElement>(null)
    useEffect(() => {
        if (!open) return
        const close = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
        }
        const escape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false)
        }
        document.addEventListener('mousedown', close)
        document.addEventListener('keydown', escape)
        return () => {
            document.removeEventListener('mousedown', close)
            document.removeEventListener('keydown', escape)
        }
    }, [open])
    const unread = notifs.filter(n => !n.read).length
    return (
        <div className='notif-wrap' ref={ref}>
            <button
                type='button'
                className='btn btn-ghost btn-icon btn-sm'
                style={{ position: 'relative' }}
                onClick={() => setOpen(o => !o)}
                aria-label={unread ? t('notificationsUnread', { count: unread }) : t('notifications')}
                title={t('notifications')}
                aria-expanded={open}
                aria-haspopup='true'
            >
                <Icon name='bell' size={17} />
                {unread > 0 && <span className='notif-dot'>{unread > 9 ? '9+' : unread}</span>}
            </button>
            {open && (
                <div className='notif-pop pop-anim'>
                    <div className='notif-head'>
                        <span style={{ whiteSpace: 'nowrap' }}>{t('notifications')}</span>
                        {unread > 0 && (
                            <button type='button' className='notif-clear' onClick={onClear}>
                                {t('markAllRead')}
                            </button>
                        )}
                    </div>
                    <div className='notif-list'>
                        {notifs.length === 0 ? (
                            <div className='notif-empty'>
                                <Icon name='bell' size={22} />
                                <span>{t('noNotifications')}</span>
                            </div>
                        ) : (
                            notifs.map(n => {
                                const view = text(n)
                                return (
                                    <button
                                        type='button'
                                        key={n.id}
                                        className={'notif-item' + (n.read ? '' : ' unread')}
                                        onClick={() => {
                                            setOpen(false)
                                            onOpen(n)
                                        }}
                                    >
                                        <span className={'notif-ic notif-ic-' + view.tone}>
                                            <Icon name={view.icon} size={15} />
                                        </span>
                                        <span className='notif-body'>
                                            <span className='notif-title'>{view.title}</span>
                                            <span className='notif-sub'>{view.sub}</span>
                                            <span className='notif-time'>{view.time}</span>
                                        </span>
                                        {!n.read && <span className='notif-unread-dot' />}
                                    </button>
                                )
                            })
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}

/** The text, icon and colour of a notification: the API sends a kind with parameters, the words are translated here. */
function useNotificationText() {
    const t = useT('Notifications')
    const f = useFormat()
    const time = (iso: string) => {
        const d = new Date(iso)
        const today = new Date()
        const yesterday = new Date(Date.now() - 86_400_000)
        const hm = d.toLocaleTimeString(f.locale, { hour: '2-digit', minute: '2-digit' })
        if (d.toDateString() === today.toDateString()) return t('today', { time: hm })
        if (d.toDateString() === yesterday.toDateString()) return t('yesterday', { time: hm })
        return d.toLocaleDateString(f.locale, { day: 'numeric', month: 'short' }) + ', ' + hm
    }
    return (n: Notification) => {
        const p = n.params ?? {}
        const s = (k: string) => String(p[k] ?? '')
        const num = (k: string) => Number(p[k] ?? 0)
        const base = { time: time(n.createdAt) }
        switch (n.kind) {
            case 'invoice.created': {
                const status = s('status')
                return {
                    ...base,
                    icon: 'invoice',
                    tone: status === 'free' ? 'violet' : status === 'paid' ? 'green' : 'accent',
                    title: t('invoiceTitle', { number: s('number') }),
                    sub:
                        status === 'free'
                            ? t('invoiceSubFree', { app: s('app') })
                            : status === 'paid'
                              ? t('invoiceSubPaid', { app: s('app'), amount: f.eur(num('totalCents')) })
                              : t('invoiceSubOpen', { app: s('app'), amount: f.eur(num('totalCents')) })
                }
            }
            case 'contract.expiring':
                return {
                    ...base,
                    icon: 'alert',
                    tone: 'amber',
                    title: t('contractTitle'),
                    sub: t('contractSub', { app: s('app'), date: f.date(s('renewsAt')), days: num('daysLeft') })
                }
            case 'ticket.reply':
                return {
                    ...base,
                    icon: 'ticket',
                    tone: 'accent',
                    title: t('ticketReplyTitle', { number: s('number') }),
                    sub: `${s('from')}: ${s('text')}`
                }
            case 'ticket.closed':
                return {
                    ...base,
                    icon: 'checkCircle',
                    tone: 'green',
                    title: t('ticketClosedTitle', { number: s('number') }),
                    sub: s('from') ? t('ticketClosedBy', { from: s('from'), subject: s('subject') }) : s('subject')
                }
            case 'ticket.customer_reply':
                return {
                    ...base,
                    icon: 'message',
                    tone: 'accent',
                    title: t('customerReplyTitle', { number: s('number') }),
                    sub: `${s('from')}: ${s('text')}`
                }
            case 'ticket.created':
                return {
                    ...base,
                    icon: 'ticket',
                    tone: 'amber',
                    title: t('ticketCreatedTitle'),
                    sub: t('ticketCreatedSub', { tenant: s('tenant'), subject: s('subject') })
                }
            case 'tenant.created':
                return {
                    ...base,
                    icon: 'building',
                    tone: 'accent',
                    title: t('tenantCreatedTitle'),
                    sub: t('tenantCreatedSub', { name: s('name') })
                }
            case 'payment.received':
                return {
                    ...base,
                    icon: 'creditcard',
                    tone: 'green',
                    title: t('paymentTitle'),
                    sub: t('paymentSub', { tenant: s('tenant'), amount: f.eur(num('totalCents')), app: s('app') })
                }
            case 'discount.expiring':
                return {
                    ...base,
                    icon: 'ticket',
                    tone: 'violet',
                    title: t('discountTitle'),
                    sub: t('discountSub', { code: s('code'), days: num('daysLeft'), count: num('redemptions') })
                }
            case 'member.invited':
                return {
                    ...base,
                    icon: 'users',
                    tone: 'neutral',
                    title: t('memberInvitedTitle'),
                    sub: t('memberInvitedSub', { tenant: s('tenant'), email: s('email') })
                }
            // Someone accepted an invitation (or was added to the organisation): for its admins
            case 'member.joined':
                return {
                    ...base,
                    icon: 'users',
                    tone: 'green',
                    title: t('memberJoinedTitle'),
                    sub: t('memberJoinedSub', { name: s('name') || s('email') })
                }
            default:
                return { ...base, icon: 'bell', tone: 'accent', title: n.kind, sub: '' }
        }
    }
}

/**
 * A soft two-tone chime (Web Audio, no sound file). Browsers only play sound after the user interacted with the page;
 * before that it stays silent, without an error.
 */
function chime() {
    try {
        const Context =
            window.AudioContext ??
            (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (!Context) return
        const audio = new Context()
        const play = (frequency: number, start: number) => {
            const osc = audio.createOscillator()
            const gain = audio.createGain()
            osc.type = 'sine'
            osc.frequency.value = frequency
            gain.gain.setValueAtTime(0.0001, audio.currentTime + start)
            gain.gain.exponentialRampToValueAtTime(0.18, audio.currentTime + start + 0.02)
            gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + start + 0.45)
            osc.connect(gain).connect(audio.destination)
            osc.start(audio.currentTime + start)
            osc.stop(audio.currentTime + start + 0.5)
        }
        play(880, 0)
        play(1320, 0.14)
        setTimeout(() => void audio.close(), 1000)
    } catch {
        /* no sound: not important */
    }
}

/**
 * The notifications of the user: loaded at start and every 20 seconds; new ticket messages show a toast and chime.
 * `accountUrl`: the frontend of the login server in a linked app, where the pages of the notifications are.
 */
function useNotifications(target: (n: Notification) => string, accountUrl = '') {
    const api = useApi()
    const push = useToast()
    const openPage = useOpen()
    const t = useT('Notifications')
    const [notifs, setNotifs] = useState<Notification[]>([])
    const seen = useRef<Set<string> | null>(null)
    const markRead = (id: string) => {
        setNotifs(list => list.map(x => (x.id === id ? { ...x, read: true } : x)))
        void api(`me/notifications/${encodeURIComponent(id)}/read`, 'POST').catch(() => undefined)
    }
    /** A click in the bell or on a toast: read, and straight to the page (e.g. the ticket). */
    const open = (n: Notification) => {
        markRead(n.id)
        openPage(accountUrl + target(n), Boolean(accountUrl))
    }
    // The toasts are made in the poll below; they call the latest open
    const openRef = useRef(open)
    useEffect(() => {
        openRef.current = open
    })
    useEffect(() => {
        let active = true
        const load = () =>
            api<Notification[]>('me/notifications')
                .then(list => {
                    if (!active || !Array.isArray(list)) return
                    if (seen.current) {
                        for (const n of list) {
                            if (seen.current.has(n.id) || n.read) continue
                            const go = () => openRef.current(n)
                            if (n.kind === 'ticket.reply')
                                push(
                                    t('ticketReplyToast', {
                                        number: String(n.params.number ?? ''),
                                        from: String(n.params.from ?? '')
                                    }),
                                    'ticket',
                                    'accent',
                                    go
                                )
                            // A new ticket for the support team (only superadmins that are online get it)
                            else if (n.kind === 'ticket.customer_reply')
                                push(
                                    t('customerReplyToast', {
                                        number: String(n.params.number ?? ''),
                                        from: String(n.params.from ?? '')
                                    }),
                                    'message',
                                    'accent',
                                    go
                                )
                            else if (n.kind === 'ticket.closed')
                                push(
                                    t('ticketClosedToast', {
                                        number: String(n.params.number ?? ''),
                                        from: String(n.params.from ?? '—')
                                    }),
                                    'checkCircle',
                                    'green',
                                    go
                                )
                            else if (n.kind === 'ticket.created')
                                push(
                                    t('ticketCreatedToast', {
                                        number: String(n.params.number ?? ''),
                                        tenant: String(n.params.tenant ?? '')
                                    }),
                                    'ticket',
                                    'amber',
                                    go
                                )
                        }
                    }
                    // A short chime when a new ticket message came in since the last look
                    if (
                        seen.current &&
                        list.some(n => !seen.current?.has(n.id) && !n.read && n.kind.startsWith('ticket.'))
                    ) {
                        chime()
                        // The ticket lists and the counter in the menu load again
                        ticketsChanged()
                    }
                    seen.current = new Set(list.map(n => n.id))
                    setNotifs(list)
                })
                .catch(() => undefined)
        void load()
        // Often enough that a new ticket shows up quickly while the support team is online
        const timer = setInterval(() => document.visibilityState === 'visible' && void load(), 20_000)
        return () => {
            active = false
            clearInterval(timer)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
    const markAll = () => {
        setNotifs(list => list.map(x => ({ ...x, read: true })))
        void api('me/notifications/read-all', 'POST').catch(() => undefined)
    }
    return { notifs, open, markAll }
}

/** Where a notification of the customer portal leads. */
function customerTarget(n: Notification) {
    const screen = n.nav?.screen
    if (screen === 'ticket' && n.nav?.id) return `/support?ticket=${encodeURIComponent(n.nav.id)}`
    if (screen === 'invoices' || n.kind === 'contract.expiring' || n.kind === 'invoice.created') return '/invoices'
    if (screen === 'users' || n.kind === 'member.joined' || n.kind === 'member.invited') return '/users'
    return '/dashboard'
}

/** Where a notification of the superadmin panel leads. */
const ADMIN_ROUTES: Record<string, (id?: string) => string> = {
    'admin-tenants': () => '/admin/tenants',
    'admin-tenant': id => (id ? `/admin/tenants/${id}` : '/admin/tenants'),
    'admin-ticket': id => (id ? `/admin/tickets?ticket=${encodeURIComponent(id)}` : '/admin/tickets'),
    'admin-codes': () => '/admin/codes',
    'admin-users': () => '/admin/users'
}
function adminTarget(n: Notification) {
    const route = n.nav ? ADMIN_ROUTES[n.nav.screen] : undefined
    return route ? route(n.nav?.id) : '/admin/stats'
}

/**
 * The bell of the topbar on its own: the notifications of the account on the login server. In a linked app
 * `accountUrl` is the frontend of the login server, where its pages open; `admin`: the routes of the superadmin panel.
 */
export function PortalBell({ accountUrl = '', admin = false }: { accountUrl?: string; admin?: boolean }) {
    const { notifs, open, markAll } = useNotifications(admin ? adminTarget : customerTarget, accountUrl)
    return <NotificationBell notifs={notifs} onOpen={open} onClear={markAll} />
}

/* ============================ THE SHELL WITH THE ACCOUNT OF THE LOGIN SERVER ============================ */
/**
 * Shell with the account of the login server: the status dot on the avatar and the status menu with the out-of-office
 * reply (and the heartbeat: online, and away after 5 minutes without mouse or keyboard), log out at the login server.
 */
export function PortalShell({
    user,
    userSub,
    email,
    children,
    ...props
}: Omit<Parameters<typeof Shell>[0], 'account' | 'after'> & { user: string; userSub: string; email?: string }) {
    const tp = useT('Presence')
    const own = usePresence()
    const [statusMenu, setStatusMenu] = useState(false)
    const [oooOpen, setOooOpen] = useState(false)
    const presenceLabel = own.shown ? tp(own.shown === 'offline' ? 'offlineShown' : own.shown) : undefined
    return (
        <Shell
            {...props}
            account={{
                name: user,
                sub: userSub,
                email,
                status: own.shown,
                statusLabel: presenceLabel && tp('statusOf', { status: presenceLabel }),
                onLogout: logout,
                // The status: a menu that opens on the left (hover or click), like Microsoft Teams
                menuExtra: close => (
                    <div
                        className='user-pop-flyout-wrap'
                        onMouseEnter={() => setStatusMenu(true)}
                        onMouseLeave={() => setStatusMenu(false)}
                    >
                        <button
                            type='button'
                            className={'user-pop-item' + (statusMenu ? ' open' : '')}
                            onClick={() => setStatusMenu(o => !o)}
                            aria-expanded={statusMenu}
                            aria-haspopup='menu'
                        >
                            <Icon name='chevronRight' size={14} className='user-pop-flyout-caret' />
                            <span className={'presence-dot-inline presence-' + (own.shown ?? 'available')} />
                            <span style={{ flex: 1 }}>{presenceLabel ?? tp('title')}</span>
                        </button>
                        {statusMenu && (
                            <div className='tb-user-pop user-pop-flyout pop-anim' role='menu'>
                                {PRESENCES.map(p => (
                                    <button
                                        type='button'
                                        key={p}
                                        role='menuitemradio'
                                        aria-checked={p === own.status}
                                        className={'user-pop-item' + (p === own.status ? ' active' : '')}
                                        onClick={() => {
                                            setStatusMenu(false)
                                            void own.setStatus(p)
                                        }}
                                    >
                                        <span className={'presence-dot-inline presence-' + p} />
                                        {tp(p)}
                                    </button>
                                ))}
                                <div className='user-pop-sep' />
                                <button
                                    type='button'
                                    role='menuitem'
                                    className='user-pop-item'
                                    onClick={() => {
                                        close()
                                        setStatusMenu(false)
                                        setOooOpen(true)
                                    }}
                                >
                                    <Icon name='calendar' size={16} />
                                    <span style={{ flex: 1 }}>{tp('oooMenu')}</span>
                                    {own.outOfOffice?.enabled && (
                                        <span className='badge badge-violet' style={{ fontSize: 11 }}>
                                            {tp('oooOn')}
                                        </span>
                                    )}
                                </button>
                            </div>
                        )}
                    </div>
                )
            }}
            after={
                <OutOfOfficeDialog
                    open={oooOpen}
                    value={own.outOfOffice}
                    onClose={() => setOooOpen(false)}
                    onSaved={own.apply}
                />
            }
        >
            {children}
        </Shell>
    )
}

export type ShellUser = {
    name: string
    email: string
    tenant: { id: string; name: string; role: 'user' | 'admin' } | null
    superadmin: boolean
    /** The eHealth Vault is for doctors (profession of the membership). */
    doctor: boolean
    firstName?: string | null
    /** The slug of the organisation (environment host names). */
    slug?: string | null
}

const MeContext = createContext<ShellUser | null>(null)

/** The logged in user as the shell knows it (role, organisation, doctor). */
export function useMe(): ShellUser {
    const me = useContext(MeContext)
    if (!me) throw new Error('useMe must be used inside the shell')
    return me
}

/* ============================ CUSTOMER SHELL ============================ */
function customerActive(path: string): string {
    if (path.startsWith('/apps')) return 'apps'
    if (path.startsWith('/marketplace')) return 'marketplace'
    if (path.startsWith('/wizard')) return 'marketplace'
    if (path.startsWith('/invoices')) return 'invoices'
    if (path.startsWith('/support')) return 'tickets'
    if (path.startsWith('/users')) return 'users'
    if (path.startsWith('/vault')) return 'vault'
    if (path.startsWith('/profile')) return 'profile'
    if (path.startsWith('/security')) return 'security'
    if (path.startsWith('/audit')) return 'audit'
    return 'dashboard'
}

/** The customer portal of the login server: the pages of the organisation, for its members. */
export function CustomerShell({ user, children }: { user: ShellUser; children: ReactNode }) {
    const t = useT('Shell')
    const router = useRouter()
    const pathname = usePathname()
    // An API call answered 403 oidc.EID_REQUIRED (the eID must be linked first): the eID screen instead of the page
    const eidRequired = useEidRequired()
    const admin = user.tenant?.role === 'admin'
    const nav: NavItem[] = [
        { key: 'apps', name: t('myApps'), icon: 'layers', href: '/apps' },
        { key: 'dashboard', name: t('dashboard'), icon: 'dashboard', href: '/dashboard' },
        { key: 'marketplace', name: t('marketplace'), icon: 'compass', href: '/marketplace' },
        ...(user.doctor ? [{ key: 'vault', name: t('vault'), icon: 'vault', href: '/vault' }] : []),
        ...(admin
            ? [
                  { key: 'users', name: t('users'), icon: 'users', href: '/users' },
                  { key: 'invoices', name: t('invoices'), icon: 'invoice', href: '/invoices' }
              ]
            : []),
        { key: 'tickets', name: t('support'), icon: 'ticket', href: '/support' }
    ]
    const menu: NavItem[] = [
        { key: 'profile', name: t('myProfile'), icon: 'user', href: '/profile' },
        { key: 'security', name: t('security'), icon: 'lock', href: '/security' },
        ...(admin ? [{ key: 'audit', name: t('activity'), icon: 'activity', href: '/audit' }] : []),
        // The tour is for customers, not for the support team
        ...(user.superadmin ? [] : [{ key: 'tour', name: t('tour'), icon: 'compass', onClick: openTour }]),
        ...(user.superadmin ? [{ key: 'platform', name: t('platform'), icon: 'shield', href: '/admin' }] : [])
    ]
    if (eidRequired) return <EidRequired email={user.email} />
    return (
        <PortalShell
            brandSub={t('customerPortal')}
            nav={nav}
            menuItems={menu}
            activeKey={customerActive(pathname)}
            user={user.name}
            userSub={user.tenant?.name ?? ''}
            email={user.email}
            onSearch={q => router.push(`/marketplace?q=${encodeURIComponent(q)}`)}
            bell={<PortalBell />}
        >
            <MeContext.Provider value={user}>
                {!pathname.startsWith('/security') && <EidReminder href='/security' />}
                {children}
            </MeContext.Provider>
            {!user.superadmin && <Tour email={user.email} name={user.firstName || user.name} admin={admin} />}
        </PortalShell>
    )
}

/* ============================ ADMIN SHELL ============================ */
function adminActive(path: string): string {
    for (const key of ['tenants', 'users', 'tickets', 'catalog', 'codes', 'audit', 'ratings', 'profile', 'security'])
        if (path.startsWith('/admin/' + key)) return key
    return 'stats'
}

/** The superadmin panel of the login server (/admin): the platform, for the support team. */
export function AdminShell({
    user,
    counts,
    children
}: {
    user: ShellUser
    counts: { tenants: number | null; openTickets: number | null }
    children: ReactNode
}) {
    const t = useT('Shell')
    const router = useRouter()
    const pathname = usePathname()
    const api = useApi()
    // The open tickets in the menu: counted on the server at the start, then again whenever tickets change
    const [openTickets, setOpenTickets] = useState(counts.openTickets)
    useEffect(() => {
        let active = true
        const count = () =>
            api<Ticket[]>('admin/tickets')
                .then(list => {
                    if (active && Array.isArray(list)) setOpenTickets(list.filter(tk => tk.status !== 'closed').length)
                })
                .catch(() => undefined)
        void count()
        const stop = onTicketsChanged(() => void count())
        const onFocus = () => void count()
        window.addEventListener('focus', onFocus)
        const timer = setInterval(() => document.visibilityState === 'visible' && void count(), 20_000)
        return () => {
            active = false
            stop()
            window.removeEventListener('focus', onFocus)
            clearInterval(timer)
        }
    }, [api, pathname])
    const nav: NavItem[] = [
        {
            key: 'tenants',
            name: t('tenants'),
            icon: 'building',
            href: '/admin/tenants',
            badge: counts.tenants != null ? String(counts.tenants) : undefined
        },
        { key: 'users', name: t('users'), icon: 'users', href: '/admin/users' },
        {
            key: 'tickets',
            name: t('tickets'),
            icon: 'ticket',
            href: '/admin/tickets',
            badge: openTickets != null ? String(openTickets) : undefined
        },
        { key: 'catalog', name: t('catalog'), icon: 'grid', href: '/admin/catalog' },
        { key: 'codes', name: t('codes'), icon: 'ticket', href: '/admin/codes' },
        { key: 'audit', name: t('activity'), icon: 'activity', href: '/admin/audit' },
        { key: 'ratings', name: t('ratings'), icon: 'star', href: '/admin/ratings' }
    ]
    const menu: NavItem[] = [
        { key: 'stats', name: t('stats'), icon: 'chartbar', href: '/admin/stats' },
        { key: 'profile', name: t('myProfile'), icon: 'user', href: '/admin/profile' },
        { key: 'security', name: t('security'), icon: 'lock', href: '/admin/security' },
        // Back to the customer portal of the own organisation (when the superadmin is a member of one)
        ...(user.tenant ? [{ key: 'portal', name: t('portal'), icon: 'home', href: '/dashboard' }] : [])
    ]
    return (
        <PortalShell
            adminMark
            brandSub={t('superadmin')}
            nav={nav}
            menuItems={menu}
            activeKey={adminActive(pathname)}
            user={user.name}
            userSub={t('superadmin')}
            email={user.email}
            onSearch={q => router.push(`/admin/tenants?q=${encodeURIComponent(q)}`)}
            bell={<PortalBell admin />}
        >
            {needsName(user) && !pathname.startsWith('/admin/profile') && (
                <div
                    className='card card-pad'
                    role='status'
                    style={{
                        marginBottom: 20,
                        display: 'flex',
                        flexWrap: 'wrap',
                        alignItems: 'center',
                        gap: 14,
                        background: 'var(--amber-tint)',
                        border: '1px solid var(--amber-border)'
                    }}
                >
                    <Icon name='user' size={18} style={{ color: 'var(--amber)', flex: 'none' }} />
                    <div style={{ flex: '1 1 240px', fontSize: 13.5, color: 'var(--text-2)' }}>
                        <strong style={{ color: 'var(--text)' }}>{t('nameMissingTitle')}</strong> {t('nameMissingText')}
                    </div>
                    <Btn size='sm' variant='secondary' icon='edit' onClick={() => router.push('/admin/profile')}>
                        {t('nameMissingAction')}
                    </Btn>
                </div>
            )}
            <MeContext.Provider value={user}>{children}</MeContext.Provider>
        </PortalShell>
    )
}

/** A superadmin without a real name (the default of the bootstrap account, or only the email address). */
function needsName(user: ShellUser) {
    const name = user.name.trim()
    return !name || name.toLowerCase() === 'superadmin' || name === user.email
}
