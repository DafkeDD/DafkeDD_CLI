'use client'

import { useCallback, useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Heading, Notice, SECONDARY, SMALL_SELECT, WIDE_CARD } from '@/components/account-ui'
import { useBackend } from '@/lib/account'

type Language = 'en' | 'nl' | 'fr' | 'de'
type AppRole = { key: string; names: Record<Language, string>; default: boolean }
type App = { clientId: string; name: string; roles: AppRole[] }
type Member = {
    userId: string
    name: string
    email: string
    status: 'active' | 'disabled'
    roles: string[]
    assigned: boolean
}

const BADGE = 'rounded-full bg-[var(--surface-3)] px-2 py-0.5 text-[11px] font-semibold text-[var(--text-2)]'

/**
 * On /members, for the admins (beheerders) of the organisation: the roles per app. The developer of an app defines
 * which roles it has; here they are given to the members. A member without roles given here has the default roles of
 * the app. The app gets them in its tokens (`roles`) at the next login or refresh (at most 10 minutes).
 */
export function AppRoles() {
    const t = useTranslations('AppRoles')
    const locale = useLocale() as Language
    const backend = useBackend()
    const [apps, setApps] = useState<App[] | null>(null)
    const [clientId, setClientId] = useState('')
    const [members, setMembers] = useState<Member[] | null>(null)
    const [error, setError] = useState('')
    const [busy, setBusy] = useState<string | null>(null)

    useEffect(() => {
        backend('tenants/current/apps')
            .then(result => {
                if (result.status !== 200) return setError(result.message || t('offline'))
                const list = result.body as unknown as App[]
                setApps(list)
                if (list[0]) setClientId(list[0].clientId)
            })
            .catch(() => setError(t('offline')))
        // once when the page opens
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const load = useCallback(
        async (id: string) => {
            const result = await backend(`tenants/current/apps/${id}/members`).catch(() => null)
            if (!result) return setError(t('offline'))
            if (result.status !== 200) return setError(result.message || t('offline'))
            setMembers(result.body as unknown as Member[])
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        []
    )

    useEffect(() => {
        if (!clientId) return
        // The members of the chosen app; the state is set when the answer arrives
        const timer = setTimeout(() => void load(clientId), 0)
        return () => clearTimeout(timer)
    }, [clientId, load])

    async function save(member: Member, roles: string[] | null) {
        setBusy(member.userId)
        setError('')
        const result = await backend(`tenants/current/apps/${clientId}/members/${member.userId}`, 'PUT', {
            roles
        }).catch(() => null)
        setBusy(null)
        if (!result) return setError(t('offline'))
        if (result.status !== 200) return setError(result.message || t('offline'))
        await load(clientId)
    }

    const app = apps?.find(item => item.clientId === clientId)
    // Nothing to show when no app of this server has roles
    if (apps && apps.length === 0) return null
    return (
        <section className={WIDE_CARD}>
            <Heading title={t('title')} text={t('text')} />
            {apps && apps.length > 1 && (
                <label className='flex items-center gap-2 text-sm font-medium'>
                    {t('app')}
                    <select
                        value={clientId}
                        onChange={event => setClientId(event.target.value)}
                        className={SMALL_SELECT}
                    >
                        {apps.map(item => (
                            <option key={item.clientId} value={item.clientId}>
                                {item.name}
                            </option>
                        ))}
                    </select>
                </label>
            )}
            {apps && apps.length === 1 && (
                <div className='text-sm font-medium'>
                    {t('app')}: {apps[0]!.name}
                </div>
            )}
            {error && <Notice tone='error'>{error}</Notice>}
            {app && members && (
                <ul className='flex flex-col divide-y divide-[var(--border)]'>
                    {members.map(member => (
                        <li key={member.userId} className='flex flex-wrap items-center justify-between gap-3 py-3'>
                            <div className='flex min-w-0 flex-col'>
                                <span className='text-sm font-semibold'>
                                    {member.name || member.email}
                                    {member.status === 'disabled' && (
                                        <span className={BADGE + ' ml-2'}>{t('disabled')}</span>
                                    )}
                                </span>
                                <span className='text-xs text-[var(--text-3)]'>{member.email}</span>
                            </div>
                            <div className='flex flex-wrap items-center gap-x-4 gap-y-2'>
                                {app.roles.map(role => (
                                    <label key={role.key} className='flex items-center gap-1.5 text-sm'>
                                        <input
                                            type='checkbox'
                                            disabled={busy !== null}
                                            checked={member.roles.includes(role.key)}
                                            onChange={event =>
                                                void save(
                                                    member,
                                                    event.target.checked
                                                        ? [...member.roles, role.key]
                                                        : member.roles.filter(key => key !== role.key)
                                                )
                                            }
                                        />
                                        {role.names[locale] ?? role.names.en}
                                    </label>
                                ))}
                                {member.assigned ? (
                                    <button
                                        type='button'
                                        disabled={busy !== null}
                                        className={SECONDARY}
                                        onClick={() => void save(member, null)}
                                    >
                                        {t('reset')}
                                    </button>
                                ) : (
                                    <span className={BADGE}>{t('default')}</span>
                                )}
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    )
}
