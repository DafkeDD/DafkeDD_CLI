'use client'

import { type FormEvent, useEffect, useState } from 'react'
import { useFormatter, useTranslations } from 'next-intl'
import { BUTTON, Field, Heading, Notice, OUTLINE, SECONDARY, WIDE_CARD } from '@/components/account-ui'
import { type Answer, useBackend } from '@/lib/account'

export type App = {
    clientId: string
    name: string
    type: 'public' | 'confidential'
    source: 'file' | 'admin'
    disabled: boolean
    redirectUris: string[]
    postLogoutRedirectUris: string[]
    backchannelLogoutUri: string | null
    scopes: string[]
    grantTypes: string[]
    firstParty: boolean
    hasSecret: boolean
    consents: number
    createdAt: string
}

/** The scopes an app can ask for; openid always. */
const SCOPES = ['openid', 'profile', 'email', 'tenant'] as const
const SELECT =
    'h-11 rounded-xl border border-black/15 bg-transparent px-3 text-sm outline-none focus:border-[var(--accent,#6366f1)] dark:border-white/20 dark:[color-scheme:dark]'
const TEXTAREA =
    'min-h-20 w-full rounded-xl border border-black/15 bg-transparent px-3.5 py-2.5 font-mono text-xs outline-none focus:border-[var(--accent,#6366f1)] dark:border-white/20'
const BADGE = 'rounded-full border border-black/15 px-2 py-0.5 text-[11px] font-semibold dark:border-white/20'

/** One address per line, empty lines left out. */
const lines = (value: FormDataEntryValue | null) =>
    String(value ?? '')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)

/** The fields of the form as the API wants them (create and change). */
function fields(form: HTMLFormElement) {
    const values = new FormData(form)
    return {
        name: String(values.get('name') ?? '').trim(),
        redirectUris: lines(values.get('redirectUris')),
        postLogoutRedirectUris: lines(values.get('postLogoutRedirectUris')),
        backchannelLogoutUri: String(values.get('backchannelLogoutUri') ?? '').trim(),
        scopes: ['openid', ...SCOPES.filter(scope => scope !== 'openid' && values.get('scope_' + scope) === 'on')],
        refreshTokens: values.get('refreshTokens') === 'on',
        firstParty: values.get('firstParty') === 'on'
    }
}

/**
 * On /admin, for superadmins: the apps that may log in with this server (OpenID Connect clients). Apps of
 * config/oidc-clients.json are shown read-only; apps made here can be changed, get a new secret (shown once),
 * be disabled and removed.
 */
export function Apps() {
    const t = useTranslations('Apps')
    const format = useFormatter()
    const backend = useBackend()
    const [apps, setApps] = useState<App[] | null>(null)
    const [error, setError] = useState('')
    const [notice, setNotice] = useState('')
    const [busy, setBusy] = useState(false)
    const [secret, setSecret] = useState<{ clientId: string; secret: string } | null>(null)
    const [copied, setCopied] = useState(false)
    const [editing, setEditing] = useState<string | null>(null)
    const [creating, setCreating] = useState(false)
    const [removing, setRemoving] = useState<string | null>(null)

    function show(result: Answer | null) {
        if (result?.status === 200) setApps(result.body as unknown as App[])
        else setError(result?.message || t('offline'))
    }

    useEffect(() => {
        backend('admin/clients')
            .then(show)
            .catch(() => show(null))
        // once when the page opens
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    /** Calls the API; on success shows `success`, a secret when there is one, and the list again. */
    async function act(path: string, method: string, body: object | undefined, success: string) {
        setBusy(true)
        setError('')
        setNotice('')
        setCopied(false)
        try {
            const result = await backend(path, method, body)
            if (result.status >= 400) {
                setError(result.message || t('offline'))
                return false
            }
            const answer = result.body as { secret?: string | null; client?: App }
            setSecret(
                answer.secret && answer.client ? { clientId: answer.client.clientId, secret: answer.secret } : null
            )
            setNotice(success)
            show(await backend('admin/clients').catch(() => null))
            return true
        } catch {
            setError(t('offline'))
            return false
        } finally {
            setBusy(false)
        }
    }

    function create(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const form = event.currentTarget
        const values = new FormData(form)
        const clientId = String(values.get('clientId') ?? '').trim()
        void act(
            'admin/clients',
            'POST',
            { ...fields(form), type: String(values.get('type')), ...(clientId ? { clientId } : {}) },
            t('created')
        ).then(ok => {
            if (ok) {
                form.reset()
                setCreating(false)
            }
        })
    }

    function update(event: FormEvent<HTMLFormElement>, app: App) {
        event.preventDefault()
        void act('admin/clients/' + app.clientId, 'PUT', fields(event.currentTarget), t('saved')).then(
            ok => ok && setEditing(null)
        )
    }

    async function copy(value: string) {
        try {
            await navigator.clipboard.writeText(value)
            setCopied(true)
        } catch {
            setCopied(false)
        }
    }

    const scopeText: Record<(typeof SCOPES)[number], string> = {
        openid: t('scope_openid'),
        profile: t('scope_profile'),
        email: t('scope_email'),
        tenant: t('scope_tenant')
    }

    function form(app: App | null, onSubmit: (event: FormEvent<HTMLFormElement>) => void) {
        return (
            <form
                className='flex flex-col gap-3 rounded-xl border border-black/10 p-4 dark:border-white/15'
                onSubmit={onSubmit}
            >
                <Field label={t('name')} name='name' required minLength={2} maxLength={100} defaultValue={app?.name} />
                {!app && (
                    <div className='grid gap-3 sm:grid-cols-2'>
                        <Field
                            label={t('clientId')}
                            hint={t('clientIdHint')}
                            name='clientId'
                            pattern='[A-Za-z0-9._\-]{3,100}'
                            maxLength={100}
                        />
                        <label className='flex flex-col gap-1.5 text-sm font-medium'>
                            {t('type')}
                            <select name='type' defaultValue='confidential' className={SELECT}>
                                <option value='confidential'>{t('typeConfidential')}</option>
                                <option value='public'>{t('typePublic')}</option>
                            </select>
                        </label>
                    </div>
                )}
                <label className='flex flex-col gap-1.5 text-sm font-medium'>
                    {t('redirectUris')}
                    <textarea
                        name='redirectUris'
                        required
                        defaultValue={app?.redirectUris.join('\n')}
                        placeholder='https://app.example.com/callback'
                        className={TEXTAREA}
                    />
                    <span className='text-xs font-normal opacity-70'>{t('urisHint')}</span>
                </label>
                <label className='flex flex-col gap-1.5 text-sm font-medium'>
                    {t('postLogoutRedirectUris')}
                    <textarea
                        name='postLogoutRedirectUris'
                        defaultValue={app?.postLogoutRedirectUris.join('\n')}
                        placeholder='https://app.example.com'
                        className={TEXTAREA}
                    />
                </label>
                <Field
                    label={t('backchannelLogoutUri')}
                    hint={t('backchannelHint')}
                    name='backchannelLogoutUri'
                    type='url'
                    maxLength={500}
                    defaultValue={app?.backchannelLogoutUri ?? ''}
                    placeholder='https://app.example.com/backchannel-logout'
                />
                <fieldset className='flex flex-col gap-1.5 text-sm'>
                    <legend className='mb-1.5 font-medium'>{t('scopes')}</legend>
                    <div className='flex flex-wrap gap-x-5 gap-y-2'>
                        {SCOPES.map(scope => (
                            <label key={scope} className='flex items-center gap-2'>
                                <input
                                    type='checkbox'
                                    name={'scope_' + scope}
                                    disabled={scope === 'openid'}
                                    defaultChecked={
                                        scope === 'openid' || (app ? app.scopes.includes(scope) : scope !== 'tenant')
                                    }
                                />
                                <span>
                                    <code className='text-xs'>{scope}</code> · {scopeText[scope]}
                                </span>
                            </label>
                        ))}
                    </div>
                </fieldset>
                <label className='flex items-start gap-2 text-sm'>
                    <input
                        type='checkbox'
                        name='refreshTokens'
                        className='mt-1'
                        defaultChecked={app ? app.grantTypes.includes('refresh_token') : true}
                    />
                    <span>
                        {t('refreshTokens')}
                        <span className='block text-xs opacity-70'>{t('refreshTokensHint')}</span>
                    </span>
                </label>
                <label className='flex items-start gap-2 text-sm'>
                    <input
                        type='checkbox'
                        name='firstParty'
                        className='mt-1'
                        defaultChecked={app?.firstParty ?? false}
                    />
                    <span>
                        {t('firstParty')}
                        <span className='block text-xs opacity-70'>{t('firstPartyHint')}</span>
                    </span>
                </label>
                <div className='flex flex-wrap gap-2'>
                    <button type='submit' disabled={busy} className={BUTTON}>
                        {busy ? t('busy') : app ? t('save') : t('create')}
                    </button>
                    <button
                        type='button'
                        className={OUTLINE}
                        onClick={() => (app ? setEditing(null) : setCreating(false))}
                    >
                        {t('cancel')}
                    </button>
                </div>
            </form>
        )
    }

    return (
        <section className={WIDE_CARD}>
            <Heading title={t('title')} text={t('text')} />
            {error && <Notice tone='error'>{error}</Notice>}
            {notice && <Notice tone='success'>{notice}</Notice>}
            {secret && (
                <div className='flex flex-col gap-2 rounded-xl border border-amber-500/50 bg-amber-500/10 p-4 text-sm'>
                    <span className='font-semibold'>{t('secretTitle', { client: secret.clientId })}</span>
                    <span className='opacity-80'>{t('secretText')}</span>
                    <code className='rounded-lg bg-black/5 px-3 py-2 font-mono text-xs break-all dark:bg-white/10'>
                        {secret.secret}
                    </code>
                    <div className='flex gap-2'>
                        <button type='button' className={SECONDARY} onClick={() => void copy(secret.secret)}>
                            {copied ? t('copied') : t('copy')}
                        </button>
                        <button type='button' className={SECONDARY} onClick={() => setSecret(null)}>
                            {t('secretStored')}
                        </button>
                    </div>
                </div>
            )}
            {!apps ? (
                <p className='text-sm opacity-70'>{t('loading')}</p>
            ) : (
                <ul className='flex flex-col gap-3'>
                    {apps.map(app => (
                        <li
                            key={app.clientId}
                            className={
                                'flex flex-col gap-2 rounded-xl border border-black/10 p-4 text-sm dark:border-white/15' +
                                (app.disabled ? ' opacity-60' : '')
                            }
                        >
                            <div className='flex flex-wrap items-center gap-2'>
                                <span className='font-semibold'>{app.name}</span>
                                <code className='text-xs opacity-70'>{app.clientId}</code>
                                <span className={BADGE}>
                                    {app.type === 'public' ? t('typePublicShort') : t('typeConfidentialShort')}
                                </span>
                                <span className={BADGE}>{app.firstParty ? t('own') : t('others')}</span>
                                {app.source === 'file' && <span className={BADGE}>{t('fromFile')}</span>}
                                {app.disabled && <span className={BADGE}>{t('disabled')}</span>}
                            </div>
                            <span className='text-xs opacity-70'>
                                {app.redirectUris.join(' · ')}
                                {app.backchannelLogoutUri && <> · {t('backchannelShort')}</>}
                            </span>
                            <span className='text-xs opacity-70'>
                                {app.scopes.join(' ')} ·{' '}
                                {app.firstParty ? t('noConsent') : t('consents', { count: app.consents })}
                                {app.source === 'admin' &&
                                    ' · ' +
                                        t('createdOn', {
                                            date: format.dateTime(new Date(app.createdAt), { dateStyle: 'medium' })
                                        })}
                            </span>
                            {app.source === 'file' ? (
                                <span className='text-xs opacity-70'>{t('fileHint')}</span>
                            ) : editing === app.clientId ? (
                                form(app, event => update(event, app))
                            ) : (
                                <div className='flex flex-wrap gap-2'>
                                    <button
                                        type='button'
                                        disabled={busy}
                                        className={SECONDARY}
                                        onClick={() => {
                                            setEditing(app.clientId)
                                            setRemoving(null)
                                        }}
                                    >
                                        {t('edit')}
                                    </button>
                                    {app.type === 'confidential' && (
                                        <button
                                            type='button'
                                            disabled={busy}
                                            className={SECONDARY}
                                            onClick={() =>
                                                void act(
                                                    `admin/clients/${app.clientId}/secret`,
                                                    'POST',
                                                    undefined,
                                                    t('rotated')
                                                )
                                            }
                                        >
                                            {t('rotate')}
                                        </button>
                                    )}
                                    <button
                                        type='button'
                                        disabled={busy}
                                        className={SECONDARY}
                                        onClick={() =>
                                            void act(
                                                'admin/clients/' + app.clientId,
                                                'PATCH',
                                                { enabled: app.disabled },
                                                app.disabled ? t('enabledNotice') : t('disabledNotice')
                                            )
                                        }
                                    >
                                        {app.disabled ? t('enable') : t('disable')}
                                    </button>
                                    {app.disabled && (
                                        <button
                                            type='button'
                                            disabled={busy}
                                            className={SECONDARY + ' text-red-600 dark:text-red-400'}
                                            onClick={() =>
                                                removing === app.clientId
                                                    ? void act(
                                                          'admin/clients/' + app.clientId,
                                                          'DELETE',
                                                          undefined,
                                                          t('removed')
                                                      ).then(() => setRemoving(null))
                                                    : setRemoving(app.clientId)
                                            }
                                        >
                                            {removing === app.clientId ? t('removeConfirm') : t('remove')}
                                        </button>
                                    )}
                                </div>
                            )}
                        </li>
                    ))}
                </ul>
            )}
            {creating ? (
                form(null, create)
            ) : (
                <button type='button' className={BUTTON + ' self-start'} onClick={() => setCreating(true)}>
                    {t('new')}
                </button>
            )}
        </section>
    )
}
