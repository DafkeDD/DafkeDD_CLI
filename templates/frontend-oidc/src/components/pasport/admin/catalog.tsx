'use client'

import { useState } from 'react'
import { ApiFailure, type Discount, type Product, useApi, useData, useFormat } from '@/lib/portal'
import { useT } from '../i18n'
import { LoadError, Loading } from '../page-state'
import { useToast } from '../toast'
import { AppIcon, Badge, Btn, Field, Icon, Input, Select, Toggle, type Tone } from '../ui'
import { Modal } from '../widgets'
import { type Client, ConnectSection, ConnectionPanel } from './connection'

const CATEGORIES = ['Productiviteit', 'Planning', 'HR & Planning', 'Financieel', 'Relaties', 'Zorg']
const ICON_CHOICES = [
    'box',
    'checklist',
    'calendar',
    'roster',
    'invoice',
    'users',
    'idcard',
    'euro',
    'chart',
    'database',
    'message',
    'shieldCheck'
]

type Draft = {
    code: string
    name: string
    category: string
    price: string
    priceYear: string
    short: string
    description: string
    features: string
    icon: string
    color: string
    launchUrl: string
    requiresVault: boolean
    demoEnabled: boolean
}
const EMPTY: Draft = {
    code: '',
    name: '',
    category: CATEGORIES[0],
    price: '',
    priceYear: '',
    short: '',
    description: '',
    features: '',
    icon: 'box',
    color: '#0d9488',
    launchUrl: '',
    requiresVault: false,
    demoEnabled: true
}
const cents = (v: string) => Math.round((Number(v.replace(',', '.')) || 0) * 100)

/* ============================ APP CATALOGUE ============================ */
export function AppCatalog() {
    const t = useT('Catalog')
    const f = useFormat()
    const push = useToast()
    const api = useApi()
    const { data, setData, error, loading, reload } = useData<Product[]>('admin/products')
    // The OIDC apps: one per catalogue app (same code) plus the internal ones that are not sold
    const clients = useData<Client[]>('admin/clients')
    const [tab, setTab] = useState<'general' | 'conn'>('general')
    const [ext, setExt] = useState<{ clientId: string | null } | null>(null)
    const [extName, setExtName] = useState('')
    const [delClient, setDelClient] = useState<Client | null>(null)
    const [modal, setModal] = useState<{ mode: 'add' | 'edit'; code?: string } | null>(null)
    const [linked, setLinked] = useState<{ code: string; name: string; launchUrl: string } | null>(null)
    const [draft, setDraft] = useState<Draft>(EMPTY)
    const [busy, setBusy] = useState(false)
    const [del, setDel] = useState<Product | null>(null)

    if (loading && !data) return <Loading />
    if (error && !data) return <LoadError message={error.message} onRetry={() => void reload()} />
    const apps = data ?? []
    const clientList = clients.data ?? []
    const clientOf = (code: string) => clientList.find(c => c.clientId === code) ?? null
    const internal = clientList.filter(c => !apps.some(a => a.code === c.clientId))
    const extClient = ext?.clientId ? clientOf(ext.clientId) : null
    const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft(d => ({ ...d, [k]: v }))
    const fail = (e: unknown) => push(e instanceof ApiFailure ? e.message : t('failed'), 'alert', 'red')

    const patch = async (code: string, body: object) => {
        try {
            const next = await api<Product>(`admin/products/${encodeURIComponent(code)}`, 'PATCH', body)
            setData(list => (list ?? []).map(p => (p.code === code ? next : p)))
            // The OIDC app follows: off with the app, and its link codes stop
            void clients.reload()
            return next
        } catch (e) {
            fail(e)
        }
    }
    const patchClient = async (c: Client, enabled: boolean) => {
        try {
            await api(`admin/clients/${encodeURIComponent(c.clientId)}`, 'PATCH', { enabled })
            void clients.reload()
        } catch (e) {
            fail(e)
        }
    }
    const openAddExt = () => {
        setExt({ clientId: null })
        setExtName('')
    }
    const openEditExt = (c: Client) => {
        setExt({ clientId: c.clientId })
        setExtName(c.name)
    }
    const confirmDeleteClient = async () => {
        if (!delClient) return
        setBusy(true)
        try {
            // An app must be off before it can go (two steps on purpose, in the API): both here
            if (!delClient.disabled)
                await api(`admin/clients/${encodeURIComponent(delClient.clientId)}`, 'PATCH', { enabled: false })
            await api(`admin/clients/${encodeURIComponent(delClient.clientId)}`, 'DELETE')
            await clients.reload()
            push(t('deleted'), 'trash', 'green')
            setDelClient(null)
        } catch (e) {
            fail(e)
        } finally {
            setBusy(false)
        }
    }
    const toggleVault = async (p: Product) => {
        const next = await patch(p.code, { requiresVault: !p.requiresVault })
        if (next)
            push(next.requiresVault ? t('vaultOn', { app: p.name }) : t('vaultOff', { app: p.name }), 'vault', 'accent')
    }
    const openAdd = () => {
        setDraft(EMPTY)
        setTab('general')
        setModal({ mode: 'add' })
    }
    const openEdit = (p: Product) => {
        setDraft({
            code: p.code,
            name: p.name,
            category: p.category || CATEGORIES[0],
            price: String(p.priceMonthCents / 100),
            priceYear: String(p.priceYearCents / 100),
            short: p.short ?? '',
            description: p.description ?? '',
            features: (p.features ?? []).join('\n'),
            icon: p.icon || 'box',
            color: p.color || '#0d9488',
            launchUrl: p.launchUrl ?? '',
            requiresVault: !!p.requiresVault,
            demoEnabled: p.demoEnabled !== false
        })
        setTab('general')
        setModal({ mode: 'edit', code: p.code })
    }
    const save = async () => {
        if (!modal) return
        setBusy(true)
        const month = cents(draft.price)
        const body = {
            name: draft.name.trim(),
            category: draft.category,
            priceMonthCents: month,
            priceYearCents: draft.priceYear.trim() ? cents(draft.priceYear) : month * 10,
            short: draft.short.trim(),
            description: draft.description.trim() || draft.short.trim(),
            features: draft.features
                .split('\n')
                .map(s => s.trim())
                .filter(Boolean),
            icon: draft.icon,
            color: draft.color,
            launchUrl: draft.launchUrl.trim() || null,
            requiresVault: draft.requiresVault,
            demoEnabled: draft.demoEnabled
        }
        try {
            if (modal.mode === 'add') {
                const created = await api<Product>('admin/products', 'POST', { code: draft.code.trim(), ...body })
                setData(list => [...(list ?? []), created])
                push(t('added'), 'plus', 'green')
                // A second popup follows with the link code of the new app
                setLinked({ code: created.code, name: created.name, launchUrl: draft.launchUrl })
            } else {
                // Not via patch(): that swallows errors, which would close the modal with a success toast.
                const code = modal.code!
                const next = await api<Product>(`admin/products/${encodeURIComponent(code)}`, 'PATCH', body)
                setData(list => (list ?? []).map(p => (p.code === code ? next : p)))
                push(t('updated'), 'check', 'green')
            }
            setModal(null)
        } catch (e) {
            fail(e)
        } finally {
            setBusy(false)
        }
    }
    const confirmDelete = async () => {
        if (!del) return
        setBusy(true)
        try {
            await api<unknown>(`admin/products/${encodeURIComponent(del.code)}`, 'DELETE')
            setData(list => (list ?? []).filter(p => p.code !== del.code))
            // Its OIDC app went along on the server
            void clients.reload()
            push(t('deleted'), 'trash', 'green')
            setDel(null)
        } catch (e) {
            fail(e)
        } finally {
            setBusy(false)
        }
    }
    const vaultCount = apps.filter(a => a.requiresVault && a.active).length

    return (
        <div className='fade-in content-wide'>
            <div className='page-head'>
                <div className='ph-text'>
                    <h1>{t('title')}</h1>
                    <p>{t('subtitle')}</p>
                </div>
                <div className='page-actions'>
                    <Btn variant='ghost' icon='key' onClick={openAddExt}>
                        {t('addInternal')}
                    </Btn>
                    <Btn icon='plus' onClick={openAdd}>
                        {t('add')}
                    </Btn>
                </div>
            </div>

            {vaultCount > 0 && (
                <div
                    className='card card-pad'
                    style={{
                        marginBottom: 18,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 14,
                        background: 'var(--accent-tint)',
                        border: '1px solid color-mix(in srgb, var(--accent) 25%, transparent)'
                    }}
                >
                    <div
                        style={{
                            width: 38,
                            height: 38,
                            borderRadius: 10,
                            background: 'color-mix(in srgb, var(--accent) 18%, transparent)',
                            color: 'var(--accent)',
                            display: 'grid',
                            placeItems: 'center',
                            flex: 'none'
                        }}
                    >
                        <Icon name='vault' size={18} />
                    </div>
                    <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 650, fontSize: 14 }}>{t('vaultBanner', { count: vaultCount })}</div>
                        <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 2 }}>{t('vaultBannerText')}</div>
                    </div>
                </div>
            )}

            <div className='table-wrap'>
                <table className='tbl'>
                    <thead>
                        <tr>
                            <th>{t('colApp')}</th>
                            <th>{t('colCategory')}</th>
                            <th>{t('colPrice')}</th>
                            <th>{t('colDescription')}</th>
                            <th>{t('colVault')}</th>
                            <th>{t('colVisible')}</th>
                            <th />
                        </tr>
                    </thead>
                    <tbody>
                        {apps.length === 0 && internal.length === 0 && (
                            <tr>
                                <td colSpan={7} className='empty-row'>
                                    {t('none')}
                                </td>
                            </tr>
                        )}
                        {apps.map(a => (
                            <tr key={a.code}>
                                <td>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                                        <AppIcon app={a} size={34} />
                                        <div>
                                            <div className='strong'>{a.name}</div>
                                            <div
                                                className='t-mono'
                                                style={{
                                                    fontSize: 11.5,
                                                    color: 'var(--text-3)',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: 6
                                                }}
                                            >
                                                {a.code}
                                                {a.demoEnabled === false && (
                                                    <Badge tone='neutral' icon='clock' title={t('demoOffHint')}>
                                                        {t('demoOff')}
                                                    </Badge>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </td>
                                <td>{a.category ? <Badge tone='neutral'>{a.category}</Badge> : '—'}</td>
                                <td>
                                    <span className='strong t-mono'>{f.eur(a.priceMonthCents)}</span>
                                </td>
                                <td style={{ maxWidth: 240, fontSize: 13, color: 'var(--text-3)' }}>
                                    <span
                                        style={{
                                            display: 'block',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap'
                                        }}
                                    >
                                        {a.short || a.description}
                                    </span>
                                </td>
                                <td>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                                        <Toggle on={!!a.requiresVault} onClick={() => void toggleVault(a)} />
                                        {a.requiresVault ? (
                                            <Badge tone='accent' icon='vault'>
                                                {t('required')}
                                            </Badge>
                                        ) : (
                                            <span style={{ fontSize: 13, color: 'var(--text-3)' }}>
                                                {t('notRequired')}
                                            </span>
                                        )}
                                    </div>
                                </td>
                                <td>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                                        <Toggle
                                            on={a.active}
                                            onClick={() => void patch(a.code, { active: !a.active })}
                                        />
                                        <span
                                            style={{
                                                fontSize: 13,
                                                fontWeight: 600,
                                                color: a.active ? 'var(--green)' : 'var(--text-3)'
                                            }}
                                        >
                                            {a.active ? t('active') : t('inactive')}
                                        </span>
                                    </div>
                                </td>
                                <td>
                                    <Btn
                                        variant='ghost'
                                        size='sm'
                                        icon='edit'
                                        title={t('edit')}
                                        aria-label={t('edit')}
                                        onClick={() => openEdit(a)}
                                    />
                                    <Btn
                                        variant='ghost'
                                        size='sm'
                                        icon='trash'
                                        title={t('delete')}
                                        aria-label={t('delete')}
                                        onClick={() => setDel(a)}
                                    />
                                </td>
                            </tr>
                        ))}
                        {internal.map(c => (
                            <tr key={'client-' + c.clientId}>
                                <td>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                                        <AppIcon app={{ icon: 'key', color: '#64748b' }} size={34} />
                                        <div>
                                            <div className='strong'>{c.name}</div>
                                            <div
                                                className='t-mono'
                                                style={{
                                                    fontSize: 11.5,
                                                    color: 'var(--text-3)',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: 6
                                                }}
                                            >
                                                {c.clientId}
                                                <Badge tone='neutral' icon='key' title={t('internalHint')}>
                                                    {t('internal')}
                                                </Badge>
                                            </div>
                                        </div>
                                    </div>
                                </td>
                                <td>—</td>
                                <td>—</td>
                                <td style={{ maxWidth: 240, fontSize: 13, color: 'var(--text-3)' }}>
                                    <span
                                        className='t-mono'
                                        style={{
                                            display: 'block',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap'
                                        }}
                                    >
                                        {c.redirectUris.join(' · ')}
                                    </span>
                                </td>
                                <td>—</td>
                                <td>
                                    {c.source === 'file' ? (
                                        <Badge tone='neutral'>{t('fromFile')}</Badge>
                                    ) : (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                                            <Toggle on={!c.disabled} onClick={() => void patchClient(c, c.disabled)} />
                                            <span
                                                style={{
                                                    fontSize: 13,
                                                    fontWeight: 600,
                                                    color: c.disabled ? 'var(--text-3)' : 'var(--green)'
                                                }}
                                            >
                                                {c.disabled ? t('inactive') : t('active')}
                                            </span>
                                        </div>
                                    )}
                                </td>
                                <td>
                                    <Btn
                                        variant='ghost'
                                        size='sm'
                                        icon='edit'
                                        title={t('edit')}
                                        aria-label={t('edit')}
                                        onClick={() => openEditExt(c)}
                                    />
                                    {c.source === 'admin' && (
                                        <Btn
                                            variant='ghost'
                                            size='sm'
                                            icon='trash'
                                            title={t('delete')}
                                            aria-label={t('delete')}
                                            onClick={() => setDelClient(c)}
                                        />
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <Modal
                open={!!ext}
                onClose={() => setExt(null)}
                title={extClient ? t('internalEditTitle') : t('internalAddTitle')}
                width={560}
                footer={
                    <Btn variant='ghost' onClick={() => setExt(null)}>
                        {t('close')}
                    </Btn>
                }
            >
                {ext && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                        <Field label={t('name')}>
                            <Input
                                value={extName}
                                onChange={e => setExtName(e.target.value)}
                                disabled={extClient?.source === 'file'}
                                autoFocus
                            />
                        </Field>
                        <ConnectionPanel
                            key={ext.clientId ?? 'new'}
                            clientId=''
                            name={extName}
                            client={extClient}
                            internal
                            onChanged={created => {
                                if (created) setExt({ clientId: created.clientId })
                                void clients.reload()
                            }}
                        />
                    </div>
                )}
            </Modal>

            <Modal
                open={!!delClient}
                onClose={() => setDelClient(null)}
                title={t('deleteTitle')}
                width={440}
                footer={
                    <>
                        <Btn variant='ghost' onClick={() => setDelClient(null)}>
                            {t('cancel')}
                        </Btn>
                        <Btn variant='danger' icon='trash' disabled={busy} onClick={() => void confirmDeleteClient()}>
                            {t('delete')}
                        </Btn>
                    </>
                }
            >
                <p>{t('deleteInternalText', { app: delClient?.name ?? '' })}</p>
            </Modal>

            <Modal
                open={!!linked}
                onClose={() => setLinked(null)}
                title={t('linkedTitle', { app: linked?.name ?? '' })}
                width={480}
                footer={
                    <Btn variant='primary' icon='check' onClick={() => setLinked(null)}>
                        {t('done')}
                    </Btn>
                }
            >
                {linked && (
                    <ConnectSection
                        key={linked.code}
                        code={linked.code}
                        name={linked.name}
                        launchUrl={linked.launchUrl}
                        autoStart
                    />
                )}
            </Modal>

            <Modal
                open={!!del}
                onClose={() => setDel(null)}
                title={t('deleteTitle')}
                width={440}
                footer={
                    <>
                        <Btn variant='ghost' onClick={() => setDel(null)}>
                            {t('cancel')}
                        </Btn>
                        <Btn variant='danger' icon='trash' disabled={busy} onClick={() => void confirmDelete()}>
                            {t('delete')}
                        </Btn>
                    </>
                }
            >
                <p>{t('deleteText', { app: del?.name ?? '' })}</p>
            </Modal>

            <Modal
                open={!!modal}
                onClose={() => setModal(null)}
                title={modal?.mode === 'add' ? t('addTitle') : t('editTitle')}
                width={560}
                footer={
                    <>
                        <Btn variant='ghost' onClick={() => setModal(null)}>
                            {t('cancel')}
                        </Btn>
                        <Btn
                            variant='primary'
                            icon='check'
                            style={modal?.mode === 'edit' && tab === 'conn' ? { display: 'none' } : undefined}
                            disabled={
                                busy ||
                                !draft.name.trim() ||
                                (modal?.mode === 'add' && !/^[a-z0-9][a-z0-9-]{1,40}$/.test(draft.code.trim()))
                            }
                            onClick={() => void save()}
                        >
                            {t('save')}
                        </Btn>
                    </>
                }
            >
                {modal?.mode === 'edit' && (
                    <div style={{ display: 'flex', gap: 6, marginBottom: 14 }} role='tablist'>
                        {(['general', 'conn'] as const).map(k => (
                            <Btn
                                key={k}
                                variant={tab === k ? 'primary' : 'ghost'}
                                size='sm'
                                role='tab'
                                aria-selected={tab === k}
                                icon={k === 'conn' ? 'key' : undefined}
                                onClick={() => setTab(k)}
                            >
                                {k === 'conn' ? t('tabConnection') : t('tabGeneral')}
                            </Btn>
                        ))}
                    </div>
                )}
                {modal?.mode === 'edit' && modal.code && tab === 'conn' && (
                    <ConnectionPanel
                        key={modal.code}
                        clientId={modal.code}
                        name={draft.name}
                        client={clientOf(modal.code)}
                        launchUrl={draft.launchUrl}
                        onChanged={() => void clients.reload()}
                    />
                )}
                <div
                    style={{
                        display: modal?.mode === 'edit' && tab === 'conn' ? 'none' : 'flex',
                        flexDirection: 'column',
                        gap: 16,
                        paddingBottom: 6
                    }}
                >
                    <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 14 }}>
                        <Field label={t('name')}>
                            <Input
                                value={draft.name}
                                onChange={e => set('name', e.target.value)}
                                placeholder={t('namePlaceholder')}
                                autoFocus
                            />
                        </Field>
                        <Field label={t('code')} hint={modal?.mode === 'add' ? t('codeHint') : undefined}>
                            <Input
                                className='t-mono'
                                value={draft.code}
                                disabled={modal?.mode === 'edit'}
                                onChange={e => set('code', e.target.value.toLowerCase())}
                                placeholder='takenlijst'
                            />
                        </Field>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
                        <Field label={t('category')}>
                            <Select
                                className='select'
                                value={draft.category}
                                onChange={e => set('category', e.target.value)}
                            >
                                {[...new Set([...CATEGORIES, draft.category])].map(c => (
                                    <option key={c}>{c}</option>
                                ))}
                            </Select>
                        </Field>
                        <Field label={t('priceMonth')}>
                            <Input
                                type='number'
                                min={0}
                                step='0.01'
                                value={draft.price}
                                onChange={e => set('price', e.target.value)}
                                placeholder='0'
                            />
                        </Field>
                        <Field label={t('priceYear')} hint={t('priceYearHint')}>
                            <Input
                                type='number'
                                min={0}
                                step='0.01'
                                value={draft.priceYear}
                                onChange={e => set('priceYear', e.target.value)}
                                placeholder={draft.price ? String(Number(draft.price) * 10) : '0'}
                            />
                        </Field>
                    </div>
                    <Field label={t('short')}>
                        <textarea
                            className='textarea'
                            rows={2}
                            value={draft.short}
                            onChange={e => set('short', e.target.value)}
                            placeholder={t('shortPlaceholder')}
                        />
                    </Field>
                    <Field label={t('description')}>
                        <textarea
                            className='textarea'
                            rows={3}
                            value={draft.description}
                            onChange={e => set('description', e.target.value)}
                        />
                    </Field>
                    <Field label={t('features')} hint={t('featuresHint')}>
                        <textarea
                            className='textarea'
                            rows={3}
                            value={draft.features}
                            onChange={e => set('features', e.target.value)}
                        />
                    </Field>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: 14, alignItems: 'end' }}>
                        <Field label={t('icon')}>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                {ICON_CHOICES.map(ic => (
                                    <button
                                        type='button'
                                        key={ic}
                                        aria-pressed={draft.icon === ic}
                                        aria-label={ic}
                                        onClick={() => set('icon', ic)}
                                        style={{
                                            width: 34,
                                            height: 34,
                                            borderRadius: 9,
                                            display: 'grid',
                                            placeItems: 'center',
                                            cursor: 'pointer',
                                            border:
                                                '1px solid ' + (draft.icon === ic ? 'var(--accent)' : 'var(--border)'),
                                            background: draft.icon === ic ? 'var(--accent-tint)' : 'var(--surface)',
                                            color: draft.icon === ic ? 'var(--accent)' : 'var(--text-2)'
                                        }}
                                    >
                                        <Icon name={ic} size={16} />
                                    </button>
                                ))}
                            </div>
                        </Field>
                        <Field label={t('color')}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <input
                                    type='color'
                                    value={draft.color}
                                    onChange={e => set('color', e.target.value)}
                                    aria-label={t('color')}
                                    style={{
                                        width: 42,
                                        height: 34,
                                        border: '1px solid var(--border)',
                                        borderRadius: 8,
                                        background: 'none',
                                        padding: 2
                                    }}
                                />
                                <AppIcon app={{ icon: draft.icon, color: draft.color }} size={34} />
                            </div>
                        </Field>
                    </div>
                    <Field label={t('launchUrl')} hint={t('launchUrlHint')}>
                        <Input
                            icon='globe'
                            className='t-mono'
                            value={draft.launchUrl}
                            onChange={e => set('launchUrl', e.target.value)}
                            placeholder='https://{slug}.takenlijst.pasport.be'
                        />
                    </Field>
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 12,
                            padding: '12px 14px',
                            border: '1px solid var(--border)',
                            borderRadius: 'var(--r-md)',
                            background: draft.requiresVault ? 'var(--accent-tint)' : 'var(--surface-2)'
                        }}
                    >
                        <div>
                            <div
                                style={{ fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', gap: 7 }}
                            >
                                <Icon name='vault' size={15} style={{ color: 'var(--accent)' }} />
                                {t('vaultRequired')}
                            </div>
                            <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 3 }}>
                                {t('vaultRequiredHint')}
                            </div>
                        </div>
                        <Toggle on={draft.requiresVault} onClick={() => set('requiresVault', !draft.requiresVault)} />
                    </div>
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 12,
                            padding: '12px 14px',
                            border: '1px solid var(--border)',
                            borderRadius: 'var(--r-md)',
                            background: draft.demoEnabled ? 'var(--accent-tint)' : 'var(--surface-2)'
                        }}
                    >
                        <div>
                            <div
                                style={{ fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', gap: 7 }}
                            >
                                <Icon name='clock' size={15} style={{ color: 'var(--accent)' }} />
                                {t('demoEnabled')}
                            </div>
                            <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 3 }}>
                                {t('demoEnabledHint')}
                            </div>
                        </div>
                        <Toggle on={draft.demoEnabled} onClick={() => set('demoEnabled', !draft.demoEnabled)} />
                    </div>
                </div>
            </Modal>
        </div>
    )
}

/* ============================ DISCOUNT CODES ============================ */
function genCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    const random = crypto.getRandomValues(new Uint8Array(8))
    return Array.from(random, b => chars[b % chars.length]).join('')
}

type CodeState = 'active' | 'used' | 'expired' | 'inactive'
function codeState(c: Discount): CodeState {
    if (!c.active) return 'inactive'
    if (c.expiresAt && new Date(c.expiresAt).getTime() < Date.now()) return 'expired'
    if (c.maxRedemptions != null && c.redemptions >= c.maxRedemptions) return 'used'
    return 'active'
}
const CODE_STATUS: Record<CodeState, [Tone, string]> = {
    active: ['green', 'statusActive'],
    used: ['neutral', 'statusUsed'],
    expired: ['red', 'statusExpired'],
    inactive: ['neutral', 'statusInactive']
}

export function DiscountCodes() {
    const t = useT('Codes')
    const f = useFormat()
    const push = useToast()
    const api = useApi()
    const { data, setData, error, loading, reload } = useData<Discount[]>('admin/discounts')
    const products = useData<Product[]>('admin/products')
    const [modal, setModal] = useState(false)
    const [draft, setDraft] = useState({
        code: '',
        type: 100,
        productCode: '',
        max: '50',
        expires: '',
        duration: 'forever'
    })
    const [busy, setBusy] = useState(false)

    if (loading && !data) return <Loading />
    if (error && !data) return <LoadError message={error.message} onRetry={() => void reload()} />
    const codes = data ?? []
    const productName = (code: string | null) =>
        code ? (products.data?.find(p => p.code === code)?.name ?? code) : t('allApps')
    const fail = (e: unknown) => push(e instanceof ApiFailure ? e.message : t('failed'), 'alert', 'red')

    const open = () => {
        setDraft({ code: genCode(), type: 100, productCode: '', max: '50', expires: '', duration: 'forever' })
        setModal(true)
    }
    const create = async () => {
        setBusy(true)
        try {
            const created = await api<Discount>('admin/discounts', 'POST', {
                code: draft.code.trim().toUpperCase(),
                percentOff: Number(draft.type),
                ...(draft.productCode ? { productCode: draft.productCode } : {}),
                duration: draft.duration,
                ...(draft.max.trim() ? { maxRedemptions: Number(draft.max) } : {}),
                ...(draft.expires ? { expiresAt: new Date(draft.expires + 'T23:59:59').toISOString() } : {})
            })
            setData(list => [created, ...(list ?? [])])
            push(t('created', { code: created.code }), 'ticket', 'green')
            setModal(false)
        } catch (e) {
            fail(e)
        } finally {
            setBusy(false)
        }
    }
    const toggleActive = async (c: Discount) => {
        try {
            const next = await api<Discount>(`admin/discounts/${encodeURIComponent(c.code)}`, 'PATCH', {
                active: !c.active
            })
            setData(list => (list ?? []).map(x => (x.code === c.code ? next : x)))
            push(
                next.active ? t('activated', { code: c.code }) : t('deactivated', { code: c.code }),
                next.active ? 'play' : 'pause',
                next.active ? 'green' : 'neutral'
            )
        } catch (e) {
            fail(e)
        }
    }
    const copyCode = (c: string) => {
        void navigator.clipboard?.writeText(c)
        push(t('copied', { code: c }), 'copy', 'accent')
    }

    const kpis = [
        ['kpiActive', codes.filter(c => codeState(c) === 'active').length, 'ticket', 'var(--green)'],
        ['kpiRedeemed', codes.reduce((a, c) => a + c.redemptions, 0), 'check', 'var(--accent)'],
        ['kpiFree', codes.filter(c => c.percentOff === 100).length, 'sparkles', 'var(--violet)'],
        ['kpiExpired', codes.filter(c => codeState(c) === 'expired').length, 'clock', 'var(--text-3)']
    ] as const

    return (
        <div className='fade-in content-wide'>
            <div className='page-head'>
                <div className='ph-text'>
                    <h1>{t('title')}</h1>
                    <p>{t('subtitle')}</p>
                </div>
                <div className='page-actions'>
                    <Btn icon='sparkles' onClick={open}>
                        {t('generate')}
                    </Btn>
                </div>
            </div>

            <div className='kpi-grid kpi-grid-4' style={{ marginBottom: 20 }}>
                {kpis.map(([l, v, ic, col]) => (
                    <div className='card kpi' key={l} style={{ padding: '16px 18px' }}>
                        <div className='kpi-top'>
                            <div
                                className='kpi-icon'
                                style={{ background: `color-mix(in srgb, ${col} 14%, transparent)`, color: col }}
                            >
                                <Icon name={ic} size={17} />
                            </div>
                        </div>
                        <div className='kpi-value' style={{ fontSize: 26 }}>
                            {v}
                        </div>
                        <div className='kpi-label' style={{ marginTop: 5 }}>
                            {t(l)}
                        </div>
                    </div>
                ))}
            </div>

            <div className='table-wrap'>
                <table className='tbl'>
                    <thead>
                        <tr>
                            <th>{t('colCode')}</th>
                            <th>{t('colDiscount')}</th>
                            <th>{t('colValidFor')}</th>
                            <th>{t('colUsage')}</th>
                            <th>{t('colExpires')}</th>
                            <th>{t('colStatus')}</th>
                            <th />
                        </tr>
                    </thead>
                    <tbody>
                        {codes.length === 0 && (
                            <tr>
                                <td colSpan={7} className='empty-row'>
                                    {t('none')}
                                </td>
                            </tr>
                        )}
                        {codes.map(c => {
                            const [tone, lbl] = CODE_STATUS[codeState(c)]
                            const pctFull = c.maxRedemptions
                                ? Math.min(100, Math.round((c.redemptions / c.maxRedemptions) * 100))
                                : 0
                            return (
                                <tr key={c.code}>
                                    <td>
                                        <span
                                            className='t-mono strong'
                                            style={{ fontSize: 13.5, letterSpacing: '.02em' }}
                                        >
                                            {c.code}
                                        </span>
                                    </td>
                                    <td>
                                        {c.percentOff != null ? (
                                            <Badge tone={c.percentOff === 100 ? 'violet' : 'accent'}>
                                                {c.percentOff === 100 ? t('free100') : c.percentOff + '%'}
                                            </Badge>
                                        ) : (
                                            <Badge tone='accent'>{f.eur(c.amountOffCents ?? 0)}</Badge>
                                        )}
                                    </td>
                                    <td style={{ fontSize: 13 }}>{productName(c.productCode)}</td>
                                    <td>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                                            <span className='strong' style={{ fontWeight: 500, minWidth: 44 }}>
                                                {c.redemptions} / {c.maxRedemptions ?? '∞'}
                                            </span>
                                            {c.maxRedemptions != null && (
                                                <div
                                                    style={{
                                                        width: 60,
                                                        height: 5,
                                                        borderRadius: 999,
                                                        background: 'var(--surface-3)',
                                                        overflow: 'hidden'
                                                    }}
                                                >
                                                    <div
                                                        style={{
                                                            width: pctFull + '%',
                                                            height: '100%',
                                                            background:
                                                                pctFull >= 100 ? 'var(--text-3)' : 'var(--accent)'
                                                        }}
                                                    />
                                                </div>
                                            )}
                                        </div>
                                    </td>
                                    <td style={{ color: 'var(--text-3)', fontSize: 13 }}>
                                        {c.expiresAt ? f.date(c.expiresAt) : '—'}
                                    </td>
                                    <td>
                                        <Badge tone={tone} dot>
                                            {t(lbl)}
                                        </Badge>
                                    </td>
                                    <td>
                                        <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                                            <Btn
                                                variant='ghost'
                                                size='sm'
                                                icon='copy'
                                                title={t('copy')}
                                                aria-label={t('copy')}
                                                onClick={() => copyCode(c.code)}
                                            />
                                            <Btn
                                                variant='ghost'
                                                size='sm'
                                                icon={c.active ? 'pause' : 'play'}
                                                title={c.active ? t('deactivate') : t('activate')}
                                                aria-label={c.active ? t('deactivate') : t('activate')}
                                                onClick={() => void toggleActive(c)}
                                            />
                                        </div>
                                    </td>
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            </div>

            <Modal
                open={modal}
                onClose={() => setModal(false)}
                title={t('generateTitle')}
                width={500}
                footer={
                    <>
                        <Btn variant='ghost' onClick={() => setModal(false)}>
                            {t('cancel')}
                        </Btn>
                        <Btn
                            variant='primary'
                            icon='ticket'
                            disabled={busy || !/^[A-Z0-9-]{3,40}$/.test(draft.code.trim().toUpperCase())}
                            onClick={() => void create()}
                        >
                            {t('create')}
                        </Btn>
                    </>
                }
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 6 }}>
                    <Field label={t('code')} hint={t('codeHint')}>
                        <div className='input-group'>
                            <input
                                className='input t-mono'
                                aria-label={t('code')}
                                style={{ fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase' }}
                                value={draft.code}
                                onChange={e => setDraft(d => ({ ...d, code: e.target.value.toUpperCase() }))}
                            />
                            <button
                                type='button'
                                className='btn btn-secondary'
                                aria-label={t('regenerate')}
                                style={{ borderRadius: '0 var(--r-sm) var(--r-sm) 0', borderLeft: 'none' }}
                                onClick={() => setDraft(d => ({ ...d, code: genCode() }))}
                            >
                                <Icon name='refresh' size={15} />
                            </button>
                        </div>
                    </Field>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                        <Field label={t('type')}>
                            <Select
                                className='select'
                                value={draft.type}
                                onChange={e => setDraft(d => ({ ...d, type: Number(e.target.value) }))}
                            >
                                <option value='100'>{t('type100')}</option>
                                <option value='50'>50%</option>
                                <option value='25'>25%</option>
                                <option value='10'>10%</option>
                            </Select>
                        </Field>
                        <Field label={t('max')}>
                            <Input
                                type='number'
                                min={1}
                                value={draft.max}
                                onChange={e => setDraft(d => ({ ...d, max: e.target.value }))}
                                placeholder='∞'
                            />
                        </Field>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                        <Field label={t('validFor')}>
                            <Select
                                className='select'
                                value={draft.productCode}
                                onChange={e => setDraft(d => ({ ...d, productCode: e.target.value }))}
                            >
                                <option value=''>{t('allApps')}</option>
                                {(products.data ?? []).map(p => (
                                    <option key={p.code} value={p.code}>
                                        {p.name}
                                    </option>
                                ))}
                            </Select>
                        </Field>
                        <Field label={t('expires')}>
                            <Input
                                type='date'
                                value={draft.expires}
                                onChange={e => setDraft(d => ({ ...d, expires: e.target.value }))}
                            />
                        </Field>
                    </div>
                    <Field label={t('duration')} hint={t('durationHint')}>
                        <Select
                            className='select'
                            value={draft.duration}
                            onChange={e => setDraft(d => ({ ...d, duration: e.target.value }))}
                        >
                            <option value='forever'>{t('durationForever')}</option>
                            <option value='once'>{t('durationOnce')}</option>
                        </Select>
                    </Field>
                    {Number(draft.type) === 100 && (
                        <div
                            className='badge badge-violet'
                            style={{
                                alignSelf: 'flex-start',
                                height: 'auto',
                                padding: '4px 9px',
                                whiteSpace: 'normal'
                            }}
                        >
                            <Icon name='sparkles' size={12} /> {t('freeNote')}
                        </div>
                    )}
                </div>
            </Modal>
        </div>
    )
}
