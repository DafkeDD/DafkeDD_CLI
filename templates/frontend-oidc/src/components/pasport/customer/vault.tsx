'use client'

import { useRef, useState, type DragEvent } from 'react'
import { useRouter } from '@/i18n/navigation'
import { ApiFailure, useApi, useData, useFormat, type VaultState } from '@/lib/portal'
import { useT } from '../i18n'
import { LoadError, Loading, Notice } from '../page-state'
import { useToast } from '../toast'
import { AppIcon, Badge, Btn, Field, Icon, Input } from '../ui'

const MAX_BYTES = 64 * 1024

/** Reads a file as base64 (without the data: prefix). */
function toBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(file)
    })
}

export function Vault() {
    const t = useT('Vault')
    const f = useFormat()
    const router = useRouter()
    const push = useToast()
    const api = useApi()
    const { data, setData, error, loading, reload } = useData<VaultState>('me/vault')
    const [dragging, setDragging] = useState(false)
    const [pw, setPw] = useState('')
    const [pwVisible, setPwVisible] = useState(false)
    const [confirmDelete, setConfirmDelete] = useState(false)
    const [busy, setBusy] = useState(false)
    const fileRef = useRef<HTMLInputElement>(null)
    const replaceRef = useRef<HTMLInputElement>(null)

    if (loading && !data) return <Loading />
    if (error && !data) {
        if (error.status === 403) return <NoAccess />
        return <LoadError message={error.message} onRetry={() => void reload()} />
    }
    if (!data?.allowed) return <NoAccess />

    const cert = data.cert
    const fail = (e: unknown) => push(e instanceof ApiFailure ? e.message : t('failed'), 'alert', 'red')

    const handleFile = async (file: File | null) => {
        if (!file) return
        const name = file.name.toLowerCase()
        if (!name.endsWith('.p12') && !name.endsWith('.pfx')) return push(t('onlyP12'), 'alert', 'red')
        if (file.size > MAX_BYTES) return push(t('tooLarge'), 'alert', 'red')
        setBusy(true)
        try {
            setData(await api<VaultState>('me/vault', 'PUT', { filename: file.name, dataBase64: await toBase64(file) }))
            setPw('')
            push(t('saved'), 'shieldCheck', 'green')
        } catch (e) {
            fail(e)
        } finally {
            setBusy(false)
        }
    }
    const onDrop = (e: DragEvent) => {
        e.preventDefault()
        setDragging(false)
        void handleFile(e.dataTransfer.files[0] ?? null)
    }
    const savePassword = async () => {
        if (!pw) return
        setBusy(true)
        try {
            setData(await api<VaultState>('me/vault/password', 'PUT', { password: pw }))
            setPw('')
            push(t('passwordSaved'), 'lock', 'accent')
        } catch (e) {
            fail(e)
        } finally {
            setBusy(false)
        }
    }
    const removeCert = async () => {
        setBusy(true)
        try {
            await api('me/vault', 'DELETE')
            setConfirmDelete(false)
            setPw('')
            push(t('removed'), 'trash', 'neutral')
            void reload()
        } catch (e) {
            fail(e)
        } finally {
            setBusy(false)
        }
    }

    const connectedApps = data.apps.filter(a => a.owned)
    const availableApps = data.apps.filter(a => !a.owned)
    const size = (bytes: number) => (bytes / 1024).toFixed(1) + ' KB'

    return (
        <div className='fade-in' style={{ maxWidth: 780, margin: '0 auto' }}>
            <div className='page-head'>
                <div className='ph-text'>
                    <h1>{t('title')}</h1>
                    <p>{t('subtitle')}</p>
                </div>
                {cert && (
                    <div className='page-actions'>
                        <Badge tone='green' icon='shieldCheck'>
                            {t('certActive')}
                        </Badge>
                    </div>
                )}
            </div>

            {!cert ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div
                        className={`vault-dropzone${dragging ? 'dragging' : ''}`}
                        role='button'
                        tabIndex={0}
                        aria-busy={busy}
                        onDragOver={e => {
                            e.preventDefault()
                            setDragging(true)
                        }}
                        onDragLeave={() => setDragging(false)}
                        onDrop={onDrop}
                        onClick={() => fileRef.current?.click()}
                        onKeyDown={e => e.key === 'Enter' && fileRef.current?.click()}
                    >
                        <input
                            ref={fileRef}
                            type='file'
                            accept='.p12,.pfx'
                            style={{ display: 'none' }}
                            onChange={e => void handleFile(e.target.files?.[0] ?? null)}
                        />
                        <div className='vault-dropzone-ic'>
                            <Icon name={busy ? 'loader' : 'upload'} size={26} className={busy ? 'spin' : ''} />
                        </div>
                        <div style={{ fontWeight: 650, fontSize: 16 }}>{t('drop')}</div>
                        <div style={{ color: 'var(--text-3)', fontSize: 13.5 }}>{t('orClick')}</div>
                        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                            <Badge tone='neutral' icon='lock'>
                                {t('encrypted')}
                            </Badge>
                            <Badge tone='neutral'>.p12 · .pfx</Badge>
                        </div>
                    </div>
                    <div
                        className='card card-pad'
                        style={{ background: 'var(--surface-2)', display: 'flex', gap: 14, alignItems: 'flex-start' }}
                    >
                        <div style={{ color: 'var(--accent)', marginTop: 2, flex: 'none' }}>
                            <Icon name='info' size={16} />
                        </div>
                        <p style={{ fontSize: 13.5, color: 'var(--text-2)', lineHeight: 1.6 }}>
                            {t('info')} <strong>ehealth.fgov.be</strong>.
                        </p>
                    </div>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div className='card card-pad'>
                        <div className='vault-cert-row'>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                <div
                                    style={{
                                        width: 46,
                                        height: 46,
                                        borderRadius: 12,
                                        background: 'var(--accent-tint)',
                                        color: 'var(--accent)',
                                        display: 'grid',
                                        placeItems: 'center',
                                        flex: 'none'
                                    }}
                                >
                                    <Icon name='fileKey' size={22} />
                                </div>
                                <div>
                                    <div style={{ fontWeight: 650, fontSize: 15 }}>{cert.filename}</div>
                                    <div className='t-muted' style={{ fontSize: 12.5 }}>
                                        {size(cert.sizeBytes)} · {t('uploaded', { date: f.date(cert.uploadedAt) })}
                                    </div>
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                <Badge tone='green' icon='shieldCheck'>
                                    {t('active')}
                                </Badge>
                                {cert.validUntil && (
                                    <Badge tone='neutral' icon='clock'>
                                        {t('validUntil', { date: f.date(cert.validUntil) })}
                                    </Badge>
                                )}
                            </div>
                        </div>
                        <div className='vault-meta-grid'>
                            {(
                                [
                                    ['thumbprint', cert.thumbprint, true],
                                    ['serial', cert.serial, true],
                                    ['subject', cert.subject, false],
                                    ['issuer', cert.issuer, false]
                                ] as const
                            ).map(([k, v, mono]) => (
                                <div className='vault-meta-cell' key={k}>
                                    <div className='vault-meta-label'>{t('meta_' + k)}</div>
                                    <div className={`vault-meta-value${mono && v ? 'mono' : ''}`}>
                                        {v ?? <span style={{ color: 'var(--text-3)' }}>{t('afterPassword')}</span>}
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div style={{ marginTop: 14 }}>
                            <input
                                ref={replaceRef}
                                type='file'
                                accept='.p12,.pfx'
                                style={{ display: 'none' }}
                                onChange={e => void handleFile(e.target.files?.[0] ?? null)}
                            />
                            <Btn
                                variant='ghost'
                                size='sm'
                                icon='upload'
                                disabled={busy}
                                onClick={() => replaceRef.current?.click()}
                            >
                                {t('replace')}
                            </Btn>
                        </div>
                    </div>

                    <div className='card card-pad'>
                        <div
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                marginBottom: 12
                            }}
                        >
                            <div className='t-eyebrow'>{t('passwordTitle')}</div>
                            {cert.passwordSaved && (
                                <Badge tone='green' icon='check'>
                                    {t('stored')}
                                </Badge>
                            )}
                        </div>
                        <p style={{ fontSize: 13.5, color: 'var(--text-2)', marginBottom: 16, lineHeight: 1.55 }}>
                            {t('passwordText')}
                        </p>
                        <form
                            style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}
                            onSubmit={e => {
                                e.preventDefault()
                                void savePassword()
                            }}
                        >
                            <div style={{ flex: 1 }}>
                                <Field label={t('passwordLabel')}>
                                    <div style={{ position: 'relative' }}>
                                        <Input
                                            icon='lock'
                                            type={pwVisible ? 'text' : 'password'}
                                            autoComplete='off'
                                            placeholder={cert.passwordSaved ? '••••••••' : t('passwordPlaceholder')}
                                            value={pw}
                                            onChange={e => setPw(e.target.value)}
                                        />
                                        <button
                                            type='button'
                                            onClick={() => setPwVisible(v => !v)}
                                            aria-label={pwVisible ? t('hide') : t('show')}
                                            style={{
                                                position: 'absolute',
                                                right: 10,
                                                top: '50%',
                                                transform: 'translateY(-50%)',
                                                background: 'none',
                                                border: 'none',
                                                color: 'var(--text-3)',
                                                cursor: 'pointer',
                                                padding: 4,
                                                display: 'flex',
                                                alignItems: 'center'
                                            }}
                                        >
                                            <Icon name={pwVisible ? 'eyeOff' : 'eye'} size={15} />
                                        </button>
                                    </div>
                                </Field>
                            </div>
                            <Btn
                                type='submit'
                                variant={cert.passwordSaved && !pw ? 'ghost' : 'primary'}
                                icon={cert.passwordSaved && !pw ? 'check' : 'shieldCheck'}
                                disabled={!pw || busy}
                            >
                                {cert.passwordSaved && !pw ? t('stored') : t('save')}
                            </Btn>
                        </form>
                    </div>

                    <div className='card card-pad'>
                        <div
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                marginBottom: 14
                            }}
                        >
                            <div className='t-eyebrow'>{t('connectedApps')}</div>
                            {connectedApps.length > 0 && (
                                <Badge tone='green' dot>
                                    {t('connectedCount', { count: connectedApps.length })}
                                </Badge>
                            )}
                        </div>
                        <div style={{ display: 'grid', gap: 10 }}>
                            {data.apps.length === 0 && <p className='hint'>{t('noVaultApps')}</p>}
                            {connectedApps.map(a => (
                                <div
                                    key={a.code}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 12,
                                        padding: '12px 14px',
                                        border: '1px solid var(--border)',
                                        borderRadius: 'var(--r-md)',
                                        background: 'var(--surface-2)'
                                    }}
                                >
                                    <AppIcon app={a} size={36} />
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontWeight: 600, fontSize: 14 }}>{a.name}</div>
                                        <div className='t-muted' style={{ fontSize: 12.5 }}>
                                            {t('availableInApp')}
                                        </div>
                                    </div>
                                    <Badge tone='green' icon='check'>
                                        {t('connected')}
                                    </Badge>
                                </div>
                            ))}
                            {availableApps.map(a => (
                                <div
                                    key={a.code}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 12,
                                        padding: '12px 14px',
                                        border: '1px dashed var(--border)',
                                        borderRadius: 'var(--r-md)',
                                        background: 'var(--surface)'
                                    }}
                                >
                                    <AppIcon app={a} size={36} />
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-2)' }}>
                                            {a.name}
                                        </div>
                                        <div className='t-muted' style={{ fontSize: 12.5 }}>
                                            {t('activateToUse')}
                                        </div>
                                    </div>
                                    <Btn
                                        size='sm'
                                        variant='ghost'
                                        iconRight='arrowRight'
                                        onClick={() => router.push(`/wizard?app=${encodeURIComponent(a.code)}`)}
                                    >
                                        {t('activate')}
                                    </Btn>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div
                        className='card card-pad'
                        style={{ border: '1px solid color-mix(in srgb, var(--red) 30%, var(--border))' }}
                    >
                        <div className='t-eyebrow' style={{ marginBottom: 12, color: 'var(--red)' }}>
                            {t('danger')}
                        </div>
                        {!confirmDelete ? (
                            <div
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    gap: 14
                                }}
                            >
                                <div>
                                    <div style={{ fontWeight: 600, fontSize: 14 }}>{t('deleteTitle')}</div>
                                    <div className='t-muted' style={{ fontSize: 13, marginTop: 3 }}>
                                        {t('deleteText')}
                                    </div>
                                </div>
                                <Btn
                                    variant='ghost'
                                    icon='trash'
                                    style={{
                                        color: 'var(--red)',
                                        borderColor: 'color-mix(in srgb, var(--red) 40%, var(--border))'
                                    }}
                                    onClick={() => setConfirmDelete(true)}
                                >
                                    {t('delete')}
                                </Btn>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                <p style={{ fontSize: 13.5, color: 'var(--red)', fontWeight: 500 }}>{t('sure')}</p>
                                <div style={{ display: 'flex', gap: 10 }}>
                                    <Btn variant='ghost' onClick={() => setConfirmDelete(false)}>
                                        {t('cancel')}
                                    </Btn>
                                    <Btn
                                        variant='primary'
                                        icon='trash'
                                        disabled={busy}
                                        style={{ background: 'var(--red)', borderColor: 'var(--red)' }}
                                        onClick={() => void removeCert()}
                                    >
                                        {t('deleteForGood')}
                                    </Btn>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
            <Colleagues />
        </div>
    )
}

type Colleague = { userId: string; name: string | null; email: string; profession: string; allowed: boolean }

/** The doctor chooses who of the organisation (the secretariat) may use the certificate in the apps. */
function Colleagues() {
    const t = useT('Vault')
    const push = useToast()
    const api = useApi()
    const { data, setData, error, loading, reload } = useData<Colleague[]>('me/vault/colleagues')
    const [chosen, setChosen] = useState<string[] | null>(null)
    const [busy, setBusy] = useState(false)

    if (loading && !data) return null
    if (error && !data) return <LoadError message={error.message} onRetry={() => void reload()} />
    const list = data ?? []
    const current = chosen ?? list.filter(c => c.allowed).map(c => c.userId)
    const changed = chosen !== null
    const toggle = (userId: string) =>
        setChosen(current.includes(userId) ? current.filter(id => id !== userId) : [...current, userId])
    const save = async () => {
        setBusy(true)
        try {
            setData(await api<Colleague[]>('me/vault/colleagues', 'PUT', { userIds: current }))
            setChosen(null)
            push(t('colleaguesSaved'), 'users', 'accent')
        } catch (e) {
            push(e instanceof ApiFailure ? e.message : t('failed'), 'alert', 'red')
        } finally {
            setBusy(false)
        }
    }

    return (
        <div className='card card-pad' style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div className='t-eyebrow'>{t('colleaguesTitle')}</div>
                {current.length > 0 && (
                    <Badge tone='accent' icon='users'>
                        {t('colleaguesCount', { count: current.length })}
                    </Badge>
                )}
            </div>
            <p style={{ fontSize: 13.5, color: 'var(--text-2)', marginBottom: 14, lineHeight: 1.55 }}>
                {t('colleaguesText')}
            </p>
            {list.length === 0 ? (
                <p className='hint'>{t('noColleagues')}</p>
            ) : (
                <div style={{ display: 'grid', gap: 8 }}>
                    {list.map(c => (
                        <label
                            key={c.userId}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 12,
                                padding: '10px 14px',
                                border: '1px solid var(--border)',
                                borderRadius: 'var(--r-md)',
                                background: current.includes(c.userId) ? 'var(--accent-tint)' : 'var(--surface-2)',
                                cursor: 'pointer'
                            }}
                        >
                            <input
                                type='checkbox'
                                checked={current.includes(c.userId)}
                                disabled={busy}
                                onChange={() => toggle(c.userId)}
                            />
                            {/* The name; the email address only for a colleague without one */}
                            <div style={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: 14 }}>
                                {c.name || c.email}
                            </div>
                        </label>
                    ))}
                </div>
            )}
            {list.length > 0 && (
                <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
                    <Btn variant='primary' icon='check' disabled={!changed || busy} onClick={() => void save()}>
                        {t('save')}
                    </Btn>
                    {changed && (
                        <Btn variant='ghost' disabled={busy} onClick={() => setChosen(null)}>
                            {t('cancel')}
                        </Btn>
                    )}
                </div>
            )}
        </div>
    )
}

function NoAccess() {
    const t = useT('Vault')
    return (
        <div style={{ maxWidth: 560, margin: '0 auto', textAlign: 'center' }}>
            <Notice icon='vault' title={t('noAccessTitle')} text={t('noAccessText')} />
            <div style={{ marginTop: 20, display: 'flex', gap: 8, justifyContent: 'center' }}>
                <Badge tone='neutral' icon='lock'>
                    {t('requiredRole')}
                </Badge>
                <Badge tone='neutral' icon='shieldCheck'>
                    {t('gdpr')}
                </Badge>
            </div>
        </div>
    )
}
