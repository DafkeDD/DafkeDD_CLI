'use client'

import { type FormEvent, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { BUTTON, Heading, INPUT, LoginButton, Notice, roleLabel, SECONDARY, WIDE_CARD } from '@/components/account-ui'
import { type Answer, useBackend } from '@/lib/account'

type Role = 'user' | 'admin'
type Member = { userId: string; name: string; email: string; emailVerified: boolean; role: Role }

const ROLES: Role[] = ['user', 'admin']
const SELECT =
    'h-9 rounded-lg border border-black/15 bg-transparent px-2 text-sm outline-none focus:border-[var(--accent,#6366f1)] dark:border-white/20 dark:[color-scheme:dark]'

/**
 * /members: the members of the current organisation, for its admins: invite by email, change roles, remove. Every
 * call goes through /api/backend (the access token stays on the server); the API checks the role again each time.
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
    const backend = useBackend()
    const [members, setMembers] = useState<Member[] | null>(null)
    const [problem, setProblem] = useState<'session' | 'access' | null>(null)
    const [error, setError] = useState('')
    const [notice, setNotice] = useState('')
    const [busy, setBusy] = useState(false)
    const [confirm, setConfirm] = useState('')

    /** Shows the list of members (or why it cannot be shown). */
    function show(result: Answer) {
        if (result.status === 401) setProblem('session')
        else if (result.status === 403) setProblem('access')
        else if (result.status !== 200) setError(result.message || t('offline'))
        else setMembers(result.body as unknown as Member[])
    }
    const load = async () => show(await backend('tenants/current/members'))

    useEffect(() => {
        backend('tenants/current/members')
            .then(show)
            .catch(() => setError(t('offline')))
        // once when the page opens
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    /** Runs a change, shows its error (for example "the last admin"), then reloads the list. */
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
        void change('tenants/current/invitations', 'POST', { email, role: values.role }, t('invited', { email })).then(
            () => form.reset()
        )
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

    return (
        <section className={WIDE_CARD}>
            <Heading title={t('membersTitle', { tenant: tenantName })} />
            {error && <Notice tone='error'>{error}</Notice>}
            {notice && <Notice tone='success'>{notice}</Notice>}
            {!members ? (
                <p className='text-sm opacity-70'>{t('busy')}</p>
            ) : (
                <ul className='flex flex-col divide-y divide-black/10 dark:divide-white/10'>
                    {members.map(member => (
                        <li key={member.userId} className='flex flex-wrap items-center gap-3 py-3'>
                            <div className='flex min-w-0 flex-1 flex-col'>
                                <span className='truncate text-sm font-semibold'>
                                    {member.name}
                                    {member.userId === me && (
                                        <span className='font-normal opacity-60'> ({t('you')})</span>
                                    )}
                                </span>
                                <span className='truncate text-xs opacity-70'>
                                    {member.email}
                                    {!member.emailVerified && ` · ${t('notVerified')}`}
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
                                    className={SECONDARY + ' border-red-500 text-red-600 dark:text-red-400'}
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
                    ))}
                </ul>
            )}
            <form onSubmit={invite} className='flex flex-col gap-3 border-t border-black/10 pt-5 dark:border-white/10'>
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
            </form>
        </section>
    )
}
