'use client'

import { useEffect, useRef, useState } from 'react'
import { useFormatter, useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { Icon } from './ui'

/** A notification as GET /me/notifications of the login server returns it. */
export type Notification = {
    id: string
    kind: string
    params: Record<string, string | number | boolean | null>
    link: string | null
    createdAt: string
    read: boolean
}

/** Every 30 seconds while the page is visible. */
const POLL_MS = 30_000

/** The text, icon and colour of a notification: the API sends a kind with params, the words are translated here. */
function useNotificationText() {
    const n = useTranslations('Notifications')
    const format = useFormatter()
    const time = (iso: string) => {
        const date = new Date(iso)
        const clock = format.dateTime(date, { hour: '2-digit', minute: '2-digit' })
        if (date.toDateString() === new Date().toDateString()) return n('today', { time: clock })
        if (date.toDateString() === new Date(Date.now() - 86_400_000).toDateString())
            return n('yesterday', { time: clock })
        return format.dateTime(date, { day: 'numeric', month: 'short' }) + ', ' + clock
    }
    return (item: Notification) => {
        const text = (key: string) => String(item.params?.[key] ?? '')
        const base = { time: time(item.createdAt) }
        switch (item.kind) {
            case 'tenant.created':
                return {
                    ...base,
                    icon: 'building',
                    tone: 'accent',
                    title: n('tenantCreatedTitle'),
                    sub: n('tenantCreatedSub', { name: text('name') })
                }
            case 'member.invited':
                return {
                    ...base,
                    icon: 'mail',
                    tone: 'violet',
                    title: n('memberInvitedTitle'),
                    sub: n('memberInvitedSub', { email: text('email') })
                }
            case 'member.joined':
                return {
                    ...base,
                    icon: 'users',
                    tone: 'green',
                    title: n('memberJoinedTitle'),
                    sub: n('memberJoinedSub', { name: text('name') || text('email') })
                }
            default:
                return { ...base, icon: 'bell', tone: 'accent', title: item.kind, sub: '' }
        }
    }
}

/**
 * The bell in the topbar of the Pasport design: the notifications of the account on the login server (through
 * /api/backend), the number of unread ones, "mark all as read" and a click that opens the page of the notification.
 * In a linked app `accountUrl` is the frontend of the login server: its pages open there.
 */
export function NotificationBell({ accountUrl = '' }: { accountUrl?: string }) {
    const t = useTranslations('Shell')
    const describe = useNotificationText()
    const router = useRouter()
    const [items, setItems] = useState<Notification[]>([])
    const [open, setOpen] = useState(false)
    const ref = useRef<HTMLDivElement>(null)

    useEffect(() => {
        let active = true
        const load = () => {
            if (document.visibilityState !== 'visible') return
            fetch('/api/backend/me/notifications', { cache: 'no-store' })
                .then(response => (response.ok ? response.json() : null))
                .then((list: unknown) => {
                    if (active && Array.isArray(list)) setItems(list as Notification[])
                })
                .catch(() => undefined)
        }
        load()
        const timer = setInterval(load, POLL_MS)
        document.addEventListener('visibilitychange', load)
        return () => {
            active = false
            clearInterval(timer)
            document.removeEventListener('visibilitychange', load)
        }
    }, [])
    useEffect(() => {
        if (!open) return
        const close = (event: MouseEvent) => {
            if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
        }
        const escape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setOpen(false)
        }
        document.addEventListener('mousedown', close)
        document.addEventListener('keydown', escape)
        return () => {
            document.removeEventListener('mousedown', close)
            document.removeEventListener('keydown', escape)
        }
    }, [open])

    const post = (path: string) =>
        void fetch('/api/backend/me/notifications/' + path, { method: 'POST' }).catch(() => undefined)
    const openItem = (item: Notification) => {
        setOpen(false)
        if (!item.read) {
            setItems(list => list.map(other => (other.id === item.id ? { ...other, read: true } : other)))
            post(encodeURIComponent(item.id) + '/read')
        }
        if (!item.link) return
        if (accountUrl) window.location.assign(accountUrl + item.link)
        else router.push(item.link)
    }
    const markAll = () => {
        setItems(list => list.map(item => ({ ...item, read: true })))
        post('read-all')
    }
    const unread = items.filter(item => !item.read).length

    return (
        <div className='notif-wrap' ref={ref}>
            <button
                type='button'
                className='btn btn-ghost btn-icon btn-sm'
                style={{ position: 'relative' }}
                onClick={() => setOpen(value => !value)}
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
                            <button type='button' className='notif-clear' onClick={markAll}>
                                {t('markAllRead')}
                            </button>
                        )}
                    </div>
                    <div className='notif-list'>
                        {items.length === 0 ? (
                            <div className='notif-empty'>
                                <Icon name='bell' size={22} />
                                <span>{t('noNotifications')}</span>
                            </div>
                        ) : (
                            items.map(item => {
                                const view = describe(item)
                                return (
                                    <button
                                        type='button'
                                        key={item.id}
                                        className={'notif-item' + (item.read ? '' : ' unread')}
                                        onClick={() => openItem(item)}
                                    >
                                        <span className={'notif-ic notif-ic-' + view.tone}>
                                            <Icon name={view.icon} size={15} />
                                        </span>
                                        <span className='notif-body'>
                                            <span className='notif-title'>{view.title}</span>
                                            <span className='notif-sub'>{view.sub}</span>
                                            <span className='notif-time'>{view.time}</span>
                                        </span>
                                        {!item.read && <span className='notif-unread-dot' />}
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
