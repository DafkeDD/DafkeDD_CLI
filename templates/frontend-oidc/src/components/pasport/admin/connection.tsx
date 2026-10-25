'use client'

import { useEffect, useState } from 'react'
import { useLocale } from 'next-intl'
import { ApiFailure, useApi } from '@/lib/portal'
import { useT } from '../i18n'
import { useToast } from '../toast'
import { Btn, Field, Icon, Input, Select, Toggle } from '../ui'

/** An OIDC app (client) as /admin/clients returns it. */
export type Client = {
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
    /** The product (licence) the app sells: its tokens carry the licence of the user. Null: a free (internal) app. */
    product?: string | null
    /** The roles of the app, defined by its developer (npm run roles:push in its backend); its tokens carry them. */
    roles?: { key: string; names: Record<'en' | 'nl' | 'fr' | 'de', string>; default: boolean }[]
}

const SCOPES = ['profile', 'email', 'tenant'] as const
const lines = (value: string) =>
    value
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)

type LinkInfo = { code: string; expiresAt: string; issuer: string }

/** Copies to the clipboard; the value stays visible, so a failure is harmless. */
async function copyText(value: string, done: () => void) {
    try {
        await navigator.clipboard.writeText(value)
        done()
    } catch {
        /* copy by hand */
    }
}

/**
 * A one-time link code for the CLI. The OIDC app of a catalogue app (client id = app code) is made on first use.
 * The code is shown here once: it is not stored anywhere readable and goes when this section closes.
 */
export function ConnectSection({
    code,
    name,
    launchUrl,
    autoStart
}: {
    code: string
    name: string
    launchUrl: string
    autoStart?: boolean
}) {
    const t = useT('Catalog')
    const api = useApi()
    const push = useToast()
    const [busy, setBusy] = useState(false)
    const [link, setLink] = useState<LinkInfo | null>(null)

    const redirectFor = () => {
        try {
            return new URL(launchUrl.replace('{slug}', 'app')).origin + '/'
        } catch {
            return 'http://localhost/'
        }
    }
    const make = async () => {
        setBusy(true)
        try {
            const clients = await api<{ clientId: string }[]>('admin/clients')
            if (!clients.some(c => c.clientId === code))
                await api('admin/clients', 'POST', {
                    clientId: code,
                    name,
                    type: 'confidential',
                    redirectUris: [redirectFor()],
                    scopes: ['openid', 'profile', 'email', 'tenant'],
                    refreshTokens: true,
                    firstParty: true
                })
            setLink(await api<LinkInfo>(`admin/clients/${encodeURIComponent(code)}/link-code`, 'POST'))
        } catch (e) {
            push(e instanceof ApiFailure ? e.message : t('failed'), 'alert', 'red')
        } finally {
            setBusy(false)
        }
    }
    useEffect(() => {
        // Once, when the section opens right after the app was made
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (autoStart) void make()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    return (
        <div
            style={{
                padding: '12px 14px',
                border: '1px solid var(--border)',
                borderRadius: 'var(--r-md)',
                background: 'var(--surface-2)'
            }}
        >
            <div style={{ fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', gap: 7 }}>
                <Icon name='key' size={15} style={{ color: 'var(--accent)' }} />
                {t('connectTitle')}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--text-3)', margin: '3px 0 10px' }}>{t('connectHint')}</div>
            {link && (
                <div style={{ marginBottom: 10 }}>
                    <div className='t-mono strong' style={{ fontSize: 17, letterSpacing: 0.5, wordBreak: 'break-all' }}>
                        {link.code}
                    </div>
                    <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 4 }}>
                        {t('connectIssuer')}: <span className='t-mono'>{link.issuer}</span> ·{' '}
                        {t('connectExpires', { time: new Date(link.expiresAt).toLocaleTimeString() })}
                    </div>
                    <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 4 }}>{t('connectOnce')}</div>
                </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
                <Btn icon='key' disabled={busy} onClick={() => void make()}>
                    {link ? t('connectAgain') : t('connectMake')}
                </Btn>
                {link && (
                    <Btn
                        variant='ghost'
                        icon='copy'
                        onClick={() => void copyText(link.code, () => push(t('connectCopied'), 'check', 'green'))}
                    >
                        {t('connectCopy')}
                    </Btn>
                )}
            </div>
        </div>
    )
}

/**
 * The "connection" of an app: its OIDC settings (redirect addresses, scopes, secret) and the link code. For a
 * catalogue app the client id is the app code; an internal app (no product) picks its own id.
 */
export function ConnectionPanel({
    clientId,
    name,
    client,
    launchUrl = '',
    internal = false,
    onChanged
}: {
    /** Fixed for a catalogue app; for a new internal app the admin may type one (or leave it empty). */
    clientId: string
    name: string
    client: Client | null
    launchUrl?: string
    /** An app that is not in the catalogue: it asks for its own id and type. */
    internal?: boolean
    /** The app made by this panel is passed along, so a new internal app can switch to editing. */
    onChanged: (created?: Client) => void
}) {
    const t = useT('Catalog')
    const locale = useLocale() as 'en' | 'nl' | 'fr' | 'de'
    const api = useApi()
    const push = useToast()
    const [busy, setBusy] = useState(false)
    const [secret, setSecret] = useState<string | null>(null)
    const [idInput, setIdInput] = useState(clientId)
    const [type, setType] = useState<'public' | 'confidential'>(client?.type ?? 'confidential')
    const [redirects, setRedirects] = useState((client?.redirectUris ?? []).join('\n'))
    const [logouts, setLogouts] = useState((client?.postLogoutRedirectUris ?? []).join('\n'))
    const [backchannel, setBackchannel] = useState(client?.backchannelLogoutUri ?? '')
    const [scopes, setScopes] = useState<string[]>(client?.scopes ?? ['openid', 'profile', 'email', 'tenant'])
    const [refresh, setRefresh] = useState(client ? client.grantTypes.includes('refresh_token') : true)
    const [firstParty, setFirstParty] = useState(client?.firstParty ?? true)
    const fail = (e: unknown) => push(e instanceof ApiFailure ? e.message : t('failed'), 'alert', 'red')

    const fromFile = client?.source === 'file'
    const toggleScope = (scope: string) =>
        setScopes(list => (list.includes(scope) ? list.filter(s => s !== scope) : [...list, scope]))
    const fields = () => ({
        name: name.trim(),
        redirectUris: lines(redirects),
        postLogoutRedirectUris: lines(logouts),
        backchannelLogoutUri: backchannel.trim(),
        scopes: ['openid', ...scopes.filter(s => s !== 'openid')],
        refreshTokens: refresh,
        firstParty,
        // A catalogue app sells its product (the code of the app): its tokens carry the licence of the user
        ...(internal ? {} : { product: clientId })
    })

    const save = async () => {
        setBusy(true)
        try {
            if (client) {
                await api(`admin/clients/${encodeURIComponent(client.clientId)}`, 'PUT', fields())
                push(t('connSaved'), 'check', 'green')
            } else {
                const id = idInput.trim()
                const made = await api<{ client: Client; secret: string | null }>('admin/clients', 'POST', {
                    ...fields(),
                    type,
                    // A catalogue app: the client id is the app code
                    ...(id || clientId ? { clientId: id || clientId } : {})
                })
                setSecret(made.secret)
                push(t('connCreated'), 'plus', 'green')
                onChanged(made.client)
                return
            }
            onChanged()
        } catch (e) {
            fail(e)
        } finally {
            setBusy(false)
        }
    }
    const rotate = async () => {
        if (!client) return
        setBusy(true)
        try {
            const done = await api<{ secret: string }>(
                `admin/clients/${encodeURIComponent(client.clientId)}/secret`,
                'POST'
            )
            setSecret(done.secret)
            onChanged()
        } catch (e) {
            fail(e)
        } finally {
            setBusy(false)
        }
    }

    const secretBox = secret && (
        <div
            style={{
                padding: '12px 14px',
                border: '1px solid var(--amber, #d97706)',
                borderRadius: 'var(--r-md)',
                background: 'color-mix(in srgb, var(--amber, #d97706) 10%, transparent)'
            }}
        >
            <div style={{ fontWeight: 600, fontSize: 14 }}>{t('connSecretTitle')}</div>
            <div style={{ fontSize: 12.5, color: 'var(--text-3)', margin: '3px 0 8px' }}>{t('connSecretText')}</div>
            <div className='t-mono' style={{ fontSize: 13, wordBreak: 'break-all' }}>
                {secret}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <Btn
                    variant='ghost'
                    size='sm'
                    icon='copy'
                    onClick={() => void copyText(secret, () => push(t('connectCopied'), 'check', 'green'))}
                >
                    {t('connectCopy')}
                </Btn>
                <Btn variant='ghost' size='sm' onClick={() => setSecret(null)}>
                    {t('done')}
                </Btn>
            </div>
        </div>
    )

    if (fromFile && client)
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13.5 }}>
                <div style={{ color: 'var(--text-3)' }}>{t('connFile')}</div>
                <div className='t-mono' style={{ fontSize: 12.5, wordBreak: 'break-all' }}>
                    {client.redirectUris.join(' · ')}
                </div>
                <div className='t-mono' style={{ fontSize: 12.5 }}>
                    {client.scopes.join(' ')}
                </div>
            </div>
        )

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingBottom: 6 }}>
            {!client && !internal && <div style={{ fontSize: 13.5, color: 'var(--text-3)' }}>{t('connNone')}</div>}
            {secretBox}
            {internal && !client && (
                <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 14 }}>
                    <Field label={t('connClientId')} hint={t('connClientIdHint')}>
                        <Input
                            className='t-mono'
                            value={idInput}
                            onChange={e => setIdInput(e.target.value)}
                            placeholder='partner-planner'
                        />
                    </Field>
                    <Field label={t('connType')}>
                        <Select value={type} onChange={e => setType(e.target.value as 'public' | 'confidential')}>
                            <option value='confidential'>{t('connConfidential')}</option>
                            <option value='public'>{t('connPublic')}</option>
                        </Select>
                    </Field>
                </div>
            )}
            <Field label={t('connRedirect')} hint={t('connRedirectHint')}>
                <textarea
                    className='textarea t-mono'
                    rows={3}
                    value={redirects}
                    onChange={e => setRedirects(e.target.value)}
                    placeholder={launchUrl ? launchUrl.replace('{slug}', 'app') : 'https://app.example.com/callback'}
                />
            </Field>
            <Field label={t('connLogout')}>
                <textarea
                    className='textarea t-mono'
                    rows={2}
                    value={logouts}
                    onChange={e => setLogouts(e.target.value)}
                />
            </Field>
            <Field label={t('connBackchannel')}>
                <Input
                    className='t-mono'
                    value={backchannel}
                    onChange={e => setBackchannel(e.target.value)}
                    placeholder='https://app.example.com/backchannel-logout'
                />
            </Field>
            <Field label={t('connScopes')}>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                    <label style={{ display: 'flex', gap: 6, alignItems: 'center', opacity: 0.6 }}>
                        <input type='checkbox' checked disabled /> <code>openid</code>
                    </label>
                    {SCOPES.map(scope => (
                        <label key={scope} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            <input
                                type='checkbox'
                                checked={scopes.includes(scope)}
                                onChange={() => toggleScope(scope)}
                            />
                            <code>{scope}</code>
                        </label>
                    ))}
                </div>
            </Field>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Toggle on={refresh} onClick={() => setRefresh(v => !v)} />
                <span style={{ fontSize: 13.5 }}>{t('connRefresh')}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Toggle on={firstParty} onClick={() => setFirstParty(v => !v)} />
                <span style={{ fontSize: 13.5 }}>{t('connFirstParty')}</span>
            </div>
            {client && (client.roles?.length ?? 0) > 0 && (
                <Field label={t('connRoles')} hint={t('connRolesHint')}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {client.roles!.map(role => (
                            <span className='badge badge-neutral' key={role.key}>
                                {role.names[locale] ?? role.names.en}
                                {role.default && ` · ${t('connRoleDefault')}`}
                            </span>
                        ))}
                    </div>
                </Field>
            )}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Btn icon='check' disabled={busy || lines(redirects).length === 0} onClick={() => void save()}>
                    {client ? t('connSave') : t('connCreate')}
                </Btn>
                {client?.type === 'confidential' && (
                    <Btn variant='ghost' icon='key' disabled={busy} onClick={() => void rotate()}>
                        {t('connRotate')}
                    </Btn>
                )}
            </div>
            {client && !client.disabled && <ConnectSection code={client.clientId} name={name} launchUrl={launchUrl} />}
        </div>
    )
}
