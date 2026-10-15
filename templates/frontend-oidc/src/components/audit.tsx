'use client'

import { useEffect, useState } from 'react'
import { useFormatter, useTranslations } from 'next-intl'
import { CARD, Heading, Notice, SECONDARY, WIDE_CARD } from '@/components/account-ui'
import { describeBrowser } from '@/components/security'
import { type Answer, useBackend } from '@/lib/account'

type Value = string | number | boolean | null
export type AuditEvent = {
    id: string
    createdAt: string
    tenant: { id: string; name: string | null } | null
    actor: { id: string; name: string | null; email: string | null } | null
    action: string
    target: { type: string; id: string; label: string | null } | null
    details: Record<string, Value>
    ip: string | null
    userAgent: string | null
}
type Page = { events: AuditEvent[]; next: string | null }
type Tenant = { id: string; name: string }

/** The kinds of events (the first part of an action, as the API names them). */
export const AUDIT_CATEGORIES = ['login', 'account', 'members', 'platform', 'licences'] as const

const SELECT =
    'h-9 rounded-lg border border-black/15 bg-transparent px-2.5 text-xs font-semibold outline-none focus:border-[var(--accent,#6366f1)] dark:border-white/20 dark:[color-scheme:dark]'

/** Where each log comes from: the organisation (admins), the whole platform (superadmins) or the own account. */
const PATHS = { tenant: 'tenants/current/audit', platform: 'admin/audit', me: 'me/audit' } as const

/**
 * The audit log: who did what and when, from which IP address and browser, newest first ("Show more" pages back).
 * `tenant`: the organisation of the session (its admins); `platform`: every organisation, the platform and the
 * accounts (superadmins, with a choice of organisation); `me`: the own account (on /security).
 */
export function AuditLog({ scope }: { scope: keyof typeof PATHS }) {
    const t = useTranslations('Audit')
    const backend = useBackend()
    const [events, setEvents] = useState<AuditEvent[] | null>(null)
    const [next, setNext] = useState<string | null>(null)
    const [category, setCategory] = useState('')
    const [tenant, setTenant] = useState('')
    const [tenants, setTenants] = useState<Tenant[]>([])
    const [error, setError] = useState('')
    const [busy, setBusy] = useState(false)
    const compact = scope === 'me'

    function query(before: string | null) {
        const params = new URLSearchParams({ limit: compact ? '10' : '50' })
        if (category) params.set('category', category)
        if (tenant) params.set('tenant', tenant)
        if (before) params.set('before', before)
        return `${PATHS[scope]}?${params.toString()}`
    }

    function show(result: Answer | null, more: boolean) {
        if (result?.status !== 200) return setError(result?.message || t('offline'))
        const page = result.body as unknown as Page
        setError('')
        setEvents(current => (more ? [...(current ?? []), ...page.events] : page.events))
        setNext(page.next)
    }

    useEffect(() => {
        backend(query(null))
            .then(result => show(result, false))
            .catch(() => show(null, false))
        // again when a filter changes
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [category, tenant])

    useEffect(() => {
        if (scope !== 'platform') return
        backend('admin/tenants')
            .then(result => result.status === 200 && setTenants(result.body as unknown as Tenant[]))
            .catch(() => undefined)
        // once: the organisations to choose from
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    async function more() {
        setBusy(true)
        show(await backend(query(next)).catch(() => null), true)
        setBusy(false)
    }

    return (
        <section className={compact ? CARD : WIDE_CARD}>
            {compact ? (
                <Heading title={t('myTitle')} text={t('myText')} />
            ) : scope === 'platform' ? (
                <Heading title={t('platformTitle')} text={t('platformText')} />
            ) : (
                <Heading title={t('title')} text={t('text')} />
            )}
            {!compact && (
                <div className='flex flex-wrap gap-2'>
                    <select
                        aria-label={t('category')}
                        value={category}
                        onChange={event => setCategory(event.target.value)}
                        className={SELECT}
                    >
                        <option value=''>{t('allCategories')}</option>
                        {AUDIT_CATEGORIES.map(name => (
                            <option key={name} value={name}>
                                {t(`categories.${name}`)}
                            </option>
                        ))}
                    </select>
                    {scope === 'platform' && (
                        <select
                            aria-label={t('organisation')}
                            value={tenant}
                            onChange={event => setTenant(event.target.value)}
                            className={SELECT}
                        >
                            <option value=''>{t('allOrganisations')}</option>
                            <option value='platform'>{t('platformOnly')}</option>
                            {tenants.map(item => (
                                <option key={item.id} value={item.id}>
                                    {item.name}
                                </option>
                            ))}
                        </select>
                    )}
                </div>
            )}
            {error && <Notice tone='error'>{error}</Notice>}
            {!events ? (
                <p className='text-sm opacity-70'>{t('loading')}</p>
            ) : events.length === 0 ? (
                <p className='text-sm opacity-70'>{t('empty')}</p>
            ) : (
                <ol className='flex flex-col divide-y divide-black/10 dark:divide-white/10'>
                    {events.map(event => (
                        <AuditRow key={event.id} event={event} showTenant={scope !== 'tenant'} />
                    ))}
                </ol>
            )}
            {next && (
                <button type='button' disabled={busy} className={SECONDARY + ' self-start'} onClick={() => void more()}>
                    {t('more')}
                </button>
            )}
        </section>
    )
}

/** One event: when, what (translated), who, about whom, the details, and where from. */
function AuditRow({ event, showTenant }: { event: AuditEvent; showTenant: boolean }) {
    const t = useTranslations('Audit')
    const format = useFormatter()
    const key = event.action.replace('.', '_')
    const what = t.has(`actions.${key}`) ? t(`actions.${key}`) : event.action
    const who = event.actor
        ? (event.actor.name ?? event.actor.email ?? event.actor.id)
        : event.action.startsWith('licences.')
          ? t('system')
          : t('anonymous')

    // amr of a login ("pwd otp mfa", "sc pin mfa") or how an account was made ("password", "eid")
    const method = (raw: string) => {
        const parts = raw.split(' ')
        if (parts.includes('sc') || raw === 'eid') return t('methods.eid')
        if (parts.includes('fed') || raw === 'external') return t('methods.external')
        if (parts.includes('pop') || raw === 'passkey') return t('methods.passkey')
        if (parts.includes('mfa') || parts.includes('otp')) return t('methods.passwordCode')
        return t('methods.password')
    }

    function value(name: string, raw: Value) {
        if (raw === null) return '–'
        if (typeof raw === 'boolean') return raw ? t('yes') : t('no')
        if (typeof raw === 'number' && name.endsWith('Cents'))
            return format.number(raw / 100, { style: 'currency', currency: 'EUR' })
        if (name === 'reason' && t.has(`reasons.${raw}`)) return t(`reasons.${raw}`)
        if (name === 'method') return method(String(raw))
        if (name === 'endsAt' && typeof raw === 'string') return format.dateTime(new Date(raw), { dateStyle: 'medium' })
        return String(raw)
    }
    const details = Object.entries(event.details)
        .filter(([name]) => t.has(`details.${name}`))
        .map(([name, raw]) => `${t(`details.${name}`)}: ${value(name, raw)}`)
    const where = [event.ip, describeBrowser(event.userAgent)].filter(Boolean).join(' · ')

    return (
        <li className='flex flex-col gap-0.5 py-3 text-sm'>
            <div className='flex flex-wrap items-baseline justify-between gap-x-3'>
                <span className='font-semibold'>{what}</span>
                <time dateTime={event.createdAt} className='text-xs opacity-70'>
                    {format.dateTime(new Date(event.createdAt), { dateStyle: 'medium', timeStyle: 'short' })}
                </time>
            </div>
            <span className='text-xs opacity-80'>
                {t('by', { who })}
                {event.target?.label && event.target.id !== event.actor?.id && (
                    <> · {t('about', { whom: event.target.label })}</>
                )}
                {showTenant && <> · {event.tenant ? (event.tenant.name ?? event.tenant.id) : t('noOrganisation')}</>}
            </span>
            {details.length > 0 && <span className='text-xs opacity-70'>{details.join(' · ')}</span>}
            {where && <span className='text-xs opacity-60'>{where}</span>}
        </li>
    )
}
