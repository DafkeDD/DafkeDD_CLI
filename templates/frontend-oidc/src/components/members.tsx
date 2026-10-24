'use client'

import { type FormEvent, useEffect, useState } from 'react'
import { useFormatter, useNow, useTranslations } from 'next-intl'
import {
    BUTTON,
    DANGER,
    Heading,
    INPUT,
    LoginButton,
    Notice,
    roleLabel,
    SECONDARY,
    SMALL_SELECT,
    WIDE_CARD
} from '@/components/account-ui'
import { type AppChoice, type InvitableApp, invitationApps, InviteApps } from '@/components/invite-apps'
import { type Answer, useBackend } from '@/lib/account'

type Role = 'user' | 'admin'
type Member = {
    userId: string
    name: string
    email: string
    emailVerified: boolean
    role: Role
    status: 'active' | 'disabled'
    online: boolean
    lastSeenAt: string | null
}
type Invitation = {
    id: string
    email: string
    role: Role
    invitedByName: string | null
    expiresAt: string
    apps?: { clientId: string }[]
}

const ROLES: Role[] = ['user', 'admin']
const SELECT = SMALL_SELECT
/** The list is refreshed every 30 seconds, so "online" stays up to date. */
const REFRESH_MS = 30_000

/**
 * /members: the members of the current organisation, for its admins. Invite by email (with apps: their roles and a
 * licence), see open invitations (send again, withdraw), change roles, disable or enable, remove, and see who is online. Every call goes through
 * /api/backend (the access token stays on the server); the API checks the role again each time.
 */
export function Members({
    tenantName,
    me,
    superadmin = false
}: {
    tenantName: string
    me: string
    superadmin?: boolean
}) {
    const t = useTranslations('Oidc')
    const format = useFormatter()
    const now = useNow({ updateInterval: REFRESH_MS })
    const backend = useBackend()
    const [members, setMembers] = useState<Member[] | null>(null)
    const [invitations, setInvitations] = useState<Invitation[]>([])
    const [problem, setProblem] = useState<'session' | 'access' | null>(null)
    const [error, setError] = useState('')
    const [notice, setNotice] = useState('')
    const [busy, setBusy] = useState(false)
    const [confirm, setConfirm] = useState('')
    const [apps, setApps] = useState<InvitableApp[]>([])
    const [choice, setChoice] = useState<AppChoice>({})

    const fetchAll = () => Promise.all([backend('tenants/current/members'), backend('tenants/current/invitations')])

    /** Shows the members and the open invitations (or why they cannot be shown). */
    function show([list, open]: Answer[]) {
        if (list?.status === 401) return setProblem('session')
        if (list?.status === 403) return setProblem('access')
        if (list?.status !== 200) return setError(list?.message || t('offline'))
        setMembers(list.body as unknown as Member[])
        if (open?.status === 200) setInvitations(open.body as unknown as Invitation[])
    }
    const load = async () => show(await fetchAll())

    useEffect(() => {
        const refresh = () =>
            fetchAll()
                .then(show)
                .catch(() => setError(t('offline')))
        refresh()
        // The apps an invitation can give (once: they rarely change)
        backend('tenants/current/apps')
            .then(result => {
                if (result.status === 200) setApps(result.body as unknown as InvitableApp[])
            })
            .catch(() => undefined)
        const timer = setInterval(refresh, REFRESH_MS)
        return () => clearInterval(timer)
        // once when the page opens, then every 30 seconds
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    /** Runs a change, shows its error (for example "the last admin"), then reloads the lists. */
    async function change(path: string, method: string, body?: object, success = t('saved')) {
        setBusy(true)
        setError('')
        setNotice('')
        try {
            const result = await backend(path, method, body)
            if (result.status === 401) setProblem('session')
            else if (result.status >= 400) setError(result.message || t('offline'))
            else setNotice(success)
            await load()
        } catch {
            setError(t('offline'))
        }
        setConfirm('')
        setBusy(false)
    }

    function invite(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const form = event.currentTarget
        const values = Object.fromEntries(new FormData(form))
        const email = String(values.email)
        const body = { email, role: values.role, apps: invitationApps(apps, choice) }
        void change('tenants/current/invitations', 'POST', body, t('invited', { email })).then(() => {
            form.reset()
            setChoice({})
        })
    }

    /** The names of the apps of an open invitation ("Planner, Agenda"). */
    const appNames = (invitation: Invitation) =>
        (invitation.apps ?? [])
            .map(item => apps.find(app => app.clientId === item.clientId)?.name ?? item.clientId)
            .join(', ')

    /** "Online", "Last seen 5 minutes ago" or "Never logged in". */
    function presence(member: Member) {
        if (member.online) return t('online')
        if (!member.lastSeenAt) return t('neverSeen')
        return t('lastSeen', { time: format.relativeTime(new Date(member.lastSeenAt), now) })
    }

    if (problem === 'session')
        return (
            <section className={WIDE_CARD}>
                <Notice tone='error'>{t('sessionExpired')}</Notice>
                <LoginButton label={t('signIn')} returnTo='/members' />
            </section>
        )
    if (problem === 'access')
        return (
            <section className={WIDE_CARD}>
                <Notice tone='error'>{t('noAccess')}</Notice>
            </section>
        )

    const onlineCount = members?.filter(member => member.online).length ?? 0

    return (
        <section className={WIDE_CARD}>
            <Heading
                title={t('membersTitle', { tenant: tenantName })}
                text={members ? t('membersSummary', { count: members.length, online: onlineCount }) : undefined}
            />
            {error && <Notice tone='error'>{error}</Notice>}
            {notice && <Notice tone='success'>{notice}</Notice>}
            {!members ? (
                <p className='text-sm text-[var(--text-3)]'>{t('busy')}</p>
            ) : (
                <ul className='flex flex-col divide-y divide-[var(--border)]'>
                    {members.map(member => {
                        const disabled = member.status === 'disabled'
                        return (
                            <li
                                key={member.userId}
                                className={
                                    'flex flex-wrap items-center gap-3 py-3' + (disabled ? ' text-[var(--text-3)]' : '')
                                }
                            >
                                <span
                                    aria-hidden
                                    className={
                                        'size-2.5 shrink-0 rounded-full ' +
                                        (member.online ? 'bg-[var(--green)]' : 'bg-[var(--surface-3)]')
                                    }
                                />
                                <div className='flex min-w-0 flex-1 basis-48 flex-col'>
                                    <span className='truncate text-sm font-semibold'>
                                        {member.name}
                                        {member.userId === me && (
                                            <span className='font-normal text-[var(--text-3)]'> ({t('you')})</span>
                                        )}
                                        {disabled && (
                                            <span className='ml-2 rounded-full bg-[var(--red)]/10 px-2 py-0.5 text-xs font-semibold text-[var(--red)]'>
                                                {t('disabled')}
                                            </span>
                                        )}
                                    </span>
                                    <span className='truncate text-xs text-[var(--text-3)]'>
                                        {member.email}
                                        {!member.emailVerified && ` · ${t('notVerified')}`}
                                        {' · '}
                                        <span className={member.online ? 'font-semibold text-[var(--green)]' : ''}>
                                            {presence(member)}
                                        </span>
                                    </span>
                                </div>
                                <select
                                    aria-label={t('role')}
                                    className={SELECT}
                                    value={member.role}
                                    disabled={busy}
                                    onChange={event =>
                                        void change('tenants/current/members/' + member.userId, 'PATCH', {
                                            role: event.target.value
                                        })
                                    }
                                >
                                    {ROLES.map(role => (
                                        <option key={role} value={role}>
                                            {roleLabel(t, role)}
                                        </option>
                                    ))}
                                </select>
                                <button
                                    type='button'
                                    disabled={busy}
                                    className={SECONDARY}
                                    onClick={() =>
                                        void change(
                                            'tenants/current/members/' + member.userId + '/status',
                                            'PATCH',
                                            { status: disabled ? 'active' : 'disabled' },
                                            disabled ? t('enabledDone') : t('disabledDone')
                                        )
                                    }
                                >
                                    {disabled ? t('enable') : t('disable')}
                                </button>
                                {superadmin && (
                                    <button
                                        type='button'
                                        disabled={busy}
                                        className={SECONDARY}
                                        title={t('resetMfaText')}
                                        onClick={() =>
                                            void change(
                                                'admin/users/' + member.userId + '/mfa',
                                                'DELETE',
                                                undefined,
                                                t('resetMfaDone')
                                            )
                                        }
                                    >
                                        {t('resetMfa')}
                                    </button>
                                )}
                                {confirm === member.userId ? (
                                    <button
                                        type='button'
                                        disabled={busy}
                                        className={DANGER}
                                        onClick={() =>
                                            void change(
                                                'tenants/current/members/' + member.userId,
                                                'DELETE',
                                                undefined,
                                                t('removed')
                                            )
                                        }
                                    >
                                        {t('removeConfirm')}
                                    </button>
                                ) : (
                                    <button
                                        type='button'
                                        disabled={busy}
                                        className={SECONDARY}
                                        onClick={() => setConfirm(member.userId)}
                                    >
                                        {t('remove')}
                                    </button>
                                )}
                            </li>
                        )
                    })}
                </ul>
            )}

            <form onSubmit={invite} className='flex flex-col gap-3 border-t border-[var(--border)] pt-5'>
                <h2 className='text-base font-semibold'>{t('inviteSomeone')}</h2>
                <div className='flex flex-wrap gap-2.5'>
                    <input
                        name='email'
                        type='email'
                        required
                        maxLength={254}
                        placeholder={t('email')}
                        aria-label={t('email')}
                        className={INPUT + ' min-w-56 flex-1'}
                    />
                    <select name='role' aria-label={t('role')} defaultValue='user' className={SELECT + ' h-11'}>
                        {ROLES.map(role => (
                            <option key={role} value={role}>
                                {roleLabel(t, role)}
                            </option>
                        ))}
                    </select>
                    <button type='submit' disabled={busy} className={BUTTON}>
                        {t('inviteSend')}
                    </button>
                </div>
                <InviteApps apps={apps} value={choice} onChange={setChoice} disabled={busy} />
            </form>

            {invitations.length > 0 && (
                <div className='flex flex-col gap-2 border-t border-[var(--border)] pt-5'>
                    <h2 className='text-base font-semibold'>{t('openInvitations')}</h2>
                    <ul className='flex flex-col divide-y divide-[var(--border)]'>
                        {invitations.map(invitation => (
                            <li key={invitation.id} className='flex flex-wrap items-center gap-3 py-3'>
                                <div className='flex min-w-0 flex-1 basis-48 flex-col'>
                                    <span className='truncate text-sm font-semibold'>
                                        {invitation.email}{' '}
                                        <span className='font-normal text-[var(--text-3)]'>
                                            · {roleLabel(t, invitation.role)}
                                        </span>
                                    </span>
                                    <span className='truncate text-xs text-[var(--text-3)]'>
                                        {t('invitedBy', {
                                            name: invitation.invitedByName ?? '?',
                                            until: format.dateTime(new Date(invitation.expiresAt), {
                                                dateStyle: 'medium'
                                            })
                                        })}
                                        {appNames(invitation) &&
                                            ` · ${t('invitationApps', { apps: appNames(invitation) })}`}
                                    </span>
                                </div>
                                <button
                                    type='button'
                                    disabled={busy}
                                    className={SECONDARY}
                                    onClick={() =>
                                        void change(
                                            'tenants/current/invitations/' + invitation.id + '/resend',
                                            'POST',
                                            undefined,
                                            t('invited', { email: invitation.email })
                                        )
                                    }
                                >
                                    {t('resend')}
                                </button>
                                {confirm === invitation.id ? (
                                    <button
                                        type='button'
                                        disabled={busy}
                                        className={DANGER}
                                        onClick={() =>
                                            void change(
                                                'tenants/current/invitations/' + invitation.id,
                                                'DELETE',
                                                undefined,
                                                t('withdrawn')
                                            )
                                        }
                                    >
                                        {t('removeConfirm')}
                                    </button>
                                ) : (
                                    <button
                                        type='button'
                                        disabled={busy}
                                        className={SECONDARY}
                                        onClick={() => setConfirm(invitation.id)}
                                    >
                                        {t('withdraw')}
                                    </button>
                                )}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </section>
    )
}
