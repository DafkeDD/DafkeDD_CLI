'use client'

import { useLocale, useTranslations } from 'next-intl'

type Language = 'en' | 'nl' | 'fr' | 'de'
export type AppRole = { key: string; names: Record<Language, string>; default: boolean }
/** An app of GET /tenants/current/apps: what an admin can give in an invitation. */
export type InvitableApp = {
    clientId: string
    name: string
    url: string | null
    product: string | null
    roles: AppRole[]
}
/** The choice per app: the ticked roles and whether a seat comes with it. */
export type AppChoice = Record<string, { roles: string[]; seat: boolean }>

const defaults = (app: InvitableApp) => app.roles.filter(role => role.default).map(role => role.key)

/**
 * The apps of an invitation as the API wants them: roles equal to the default roles are sent as null, so the member
 * keeps following the default roles of the app when its developer changes them.
 */
export function invitationApps(apps: InvitableApp[], choice: AppChoice) {
    return apps.flatMap(app => {
        const chosen = choice[app.clientId]
        if (!chosen) return []
        const standard = defaults(app)
        const same = chosen.roles.length === standard.length && standard.every(key => chosen.roles.includes(key))
        return [{ clientId: app.clientId, roles: same ? null : chosen.roles, seat: chosen.seat }]
    })
}

/**
 * In the invitation form on /members: a checkbox per app; a ticked app shows its roles (the default roles ticked) and,
 * when the app sells a product, "Give a licence" (one of the free seats of the organisation).
 */
export function InviteApps({
    apps,
    value,
    onChange,
    disabled
}: {
    apps: InvitableApp[]
    value: AppChoice
    onChange: (value: AppChoice) => void
    disabled: boolean
}) {
    const t = useTranslations('Oidc')
    const locale = useLocale() as Language
    if (apps.length === 0) return null

    const toggle = (app: InvitableApp, on: boolean) => {
        const next = { ...value }
        if (on) next[app.clientId] = { roles: defaults(app), seat: false }
        else delete next[app.clientId]
        onChange(next)
    }
    const update = (clientId: string, change: Partial<AppChoice[string]>) =>
        onChange({ ...value, [clientId]: { ...value[clientId]!, ...change } })

    return (
        <fieldset className='flex flex-col gap-2'>
            <legend className='text-sm font-medium'>{t('inviteAppsTitle')}</legend>
            <p className='text-xs text-[var(--text-3)]'>{t('inviteAppsHint')}</p>
            <ul className='flex flex-col gap-2'>
                {apps.map(app => {
                    const chosen = value[app.clientId]
                    return (
                        <li key={app.clientId} className='flex flex-wrap items-center gap-x-4 gap-y-2 text-sm'>
                            <label className='flex items-center gap-1.5 font-semibold'>
                                <input
                                    type='checkbox'
                                    disabled={disabled}
                                    checked={Boolean(chosen)}
                                    onChange={event => toggle(app, event.target.checked)}
                                />
                                {app.name}
                            </label>
                            {chosen &&
                                app.roles.map(role => (
                                    <label key={role.key} className='flex items-center gap-1.5'>
                                        <input
                                            type='checkbox'
                                            disabled={disabled}
                                            checked={chosen.roles.includes(role.key)}
                                            onChange={event =>
                                                update(app.clientId, {
                                                    roles: event.target.checked
                                                        ? [...chosen.roles, role.key]
                                                        : chosen.roles.filter(key => key !== role.key)
                                                })
                                            }
                                        />
                                        {role.names[locale] ?? role.names.en}
                                    </label>
                                ))}
                            {chosen && app.product && (
                                <label className='flex items-center gap-1.5'>
                                    <input
                                        type='checkbox'
                                        disabled={disabled}
                                        checked={chosen.seat}
                                        onChange={event => update(app.clientId, { seat: event.target.checked })}
                                    />
                                    {t('inviteSeat')}
                                </label>
                            )}
                        </li>
                    )
                })}
            </ul>
        </fieldset>
    )
}
