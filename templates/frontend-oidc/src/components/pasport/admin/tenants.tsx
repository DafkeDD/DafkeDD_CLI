'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useRouter } from '@/i18n/navigation'
import {
    type AdminTenant,
    ApiFailure,
    environmentHost,
    type Invitation,
    type LicenseItem,
    type Member,
    type ShownPresence,
    type Product,
    type Profession,
    type Role,
    slugify,
    useApi,
    useData,
    useFormat
} from '@/lib/portal'
import { lastSeenLabel } from '../customer/users'
import { useT } from '../i18n'
import { LoadError, Loading } from '../page-state'
import { useToast } from '../toast'
import { AppIcon, Avatar, Badge, Btn, Field, Icon, Input, Select, Toggle, type Tone } from '../ui'
import { Modal } from '../widgets'

const PLANS = ['Starter', 'Pro', 'Enterprise']

export function tenantStatus(t: AdminTenant): [Tone, string] {
    if (t.status === 'suspended') return ['neutral', 'statusPaused']
    if (t.provisioning) return ['amber', 'statusProvisioning']
    return ['green', 'statusActive']
}
const planTone = (plan: string): Tone => (plan === 'Enterprise' ? 'violet' : plan === 'Pro' ? 'accent' : 'neutral')

/* ============================ TENANT OVERVIEW ============================ */
export function TenantOverview() {
    const t = useT('Tenants')
    const f = useFormat()
    const router = useRouter()
    const push = useToast()
    const api = useApi()
    const params = useSearchParams()
    const { data, error, loading, reload } = useData<AdminTenant[]>('admin/tenants')
    const [q, setQ] = useState(params.get('q') ?? '')
    const [filter, setFilter] = useState<'all' | 'active' | 'provisioning' | 'paused'>('all')
    const [modal, setModal] = useState(false)
    const [highlightId, setHighlightId] = useState<string | null>(null)
    const [draft, setDraft] = useState({ name: '', contact: '', email: '', plan: 'Starter', city: '' })
    const [busy, setBusy] = useState(false)

    if (loading && !data) return <Loading />
    if (error && !data) return <LoadError message={error.message} onRetry={() => void reload()} />
    const tenants = data ?? []
    const query = q.toLowerCase()
    const state = (tn: AdminTenant) =>
        tn.status === 'suspended' ? 'paused' : tn.provisioning ? 'provisioning' : 'active'
    const list = tenants.filter(
        tn =>
            (filter === 'all' || state(tn) === filter) &&
            (tn.name.toLowerCase().includes(query) ||
                tn.slug.includes(query) ||
                (tn.contact?.name ?? '').toLowerCase().includes(query) ||
                (tn.contact?.email ?? '').toLowerCase().includes(query))
    )

    const create = async () => {
        setBusy(true)
        try {
            const result = await api<{ tenant: AdminTenant; invited: boolean }>('admin/tenants', 'POST', {
                name: draft.name.trim(),
                ...(draft.email.trim() ? { adminEmail: draft.email.trim() } : {}),
                ...(draft.contact.trim() ? { contactName: draft.contact.trim() } : {}),
                ...(draft.city.trim() ? { city: draft.city.trim() } : {}),
                plan: draft.plan
            })
            push(t('created', { name: result.tenant.name }), 'building', 'green')
            setHighlightId(result.tenant.id)
            setModal(false)
            void reload()
        } catch (e) {
            push(e instanceof ApiFailure ? e.message : t('failed'), 'alert', 'red')
        } finally {
            setBusy(false)
        }
    }

    return (
        <div className='fade-in content-wide'>
            <div className='page-head'>
                <div className='ph-text'>
                    <h1>{t('title')}</h1>
                    <p>{t('subtitle', { count: tenants.length })}</p>
                </div>
                <div className='page-actions'>
                    <Btn
                        icon='plus'
                        onClick={() => {
                            setDraft({ name: '', contact: '', email: '', plan: 'Starter', city: '' })
                            setModal(true)
                        }}
                    >
                        {t('new')}
                    </Btn>
                </div>
            </div>
            <div className='toolbar'>
                <div className='search-input'>
                    <Input
                        icon='search'
                        placeholder={t('search')}
                        aria-label={t('search')}
                        value={q}
                        onChange={e => setQ(e.target.value)}
                    />
                </div>
                <div className='seg'>
                    {(
                        [
                            ['all', t('filterAll')],
                            ['active', t('statusActive')],
                            ['provisioning', t('statusProvisioning')],
                            ['paused', t('statusPaused')]
                        ] as const
                    ).map(([k, l]) => (
                        <button
                            type='button'
                            key={k}
                            className={filter === k ? 'active' : ''}
                            onClick={() => setFilter(k)}
                        >
                            {l}
                        </button>
                    ))}
                </div>
            </div>
            <div className='table-wrap'>
                <table className='tbl'>
                    <thead>
                        <tr>
                            <th>{t('colOrg')}</th>
                            <th>{t('colContact')}</th>
                            <th>{t('colPlan')}</th>
                            <th>{t('colApps')}</th>
                            <th>{t('colUsers')}</th>
                            <th>{t('colStatus')}</th>
                            <th>{t('colCreated')}</th>
                            <th />
                        </tr>
                    </thead>
                    <tbody>
                        {list.length === 0 && (
                            <tr>
                                <td colSpan={8} className='empty-row'>
                                    {t('none')}
                                </td>
                            </tr>
                        )}
                        {list.map(tn => {
                            const [tone, lbl] = tenantStatus(tn)
                            return (
                                <tr
                                    key={tn.id}
                                    className='clickable'
                                    onClick={() => router.push(`/admin/tenants/${tn.id}`)}
                                    style={tn.id === highlightId ? { background: 'var(--accent-tint)' } : undefined}
                                >
                                    <td>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                                            <Avatar name={tn.name} size={34} square color='var(--surface-3)' />
                                            <div>
                                                <div
                                                    className='strong'
                                                    style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                                                >
                                                    {tn.name}
                                                    {tn.id === highlightId && (
                                                        <Badge tone='green' dot>
                                                            {t('newBadge')}
                                                        </Badge>
                                                    )}
                                                </div>
                                                <div
                                                    className='t-mono'
                                                    style={{ fontSize: 12, color: 'var(--text-3)' }}
                                                >
                                                    {tn.slug}.pasport.be
                                                </div>
                                            </div>
                                        </div>
                                    </td>
                                    <td>
                                        <div className='strong' style={{ fontWeight: 500 }}>
                                            {tn.contact?.name || tn.contact?.email || '—'}
                                        </div>
                                        <div style={{ fontSize: 12.5, color: 'var(--text-3)' }}>{tn.city || '—'}</div>
                                    </td>
                                    <td>
                                        <Badge tone={planTone(tn.plan)}>{tn.plan}</Badge>
                                    </td>
                                    <td>
                                        <span className='strong'>{tn.apps}</span>
                                    </td>
                                    <td>
                                        <span className='stat-pill'>
                                            <Icon name='users' size={14} /> {tn.members}
                                        </span>
                                    </td>
                                    <td>
                                        <Badge tone={tone} dot>
                                            {t(lbl)}
                                        </Badge>
                                    </td>
                                    <td style={{ color: 'var(--text-3)', fontSize: 13 }}>{f.date(tn.createdAt)}</td>
                                    <td>
                                        <Icon name='chevronRight' size={16} style={{ color: 'var(--text-3)' }} />
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
                title={t('newTitle')}
                width={520}
                footer={
                    <>
                        <Btn variant='ghost' onClick={() => setModal(false)}>
                            {t('cancel')}
                        </Btn>
                        <Btn
                            variant='primary'
                            icon='building'
                            disabled={!draft.name.trim() || busy}
                            onClick={() => void create()}
                        >
                            {t('create')}
                        </Btn>
                    </>
                }
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 6 }}>
                    <Field label={t('orgName')} required>
                        <Input
                            value={draft.name}
                            maxLength={100}
                            onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
                            placeholder={t('orgPlaceholder')}
                            autoFocus
                        />
                    </Field>
                    <div>
                        <div className='label' style={{ marginBottom: 7 }}>
                            {t('idAndEnv')}
                        </div>
                        <div
                            className='card'
                            style={{ background: 'var(--surface-2)', padding: '12px 14px', display: 'grid', gap: 8 }}
                        >
                            <div
                                style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    gap: 10
                                }}
                            >
                                <span className='t-muted' style={{ fontSize: 12.5 }}>
                                    {t('tenantId')}
                                </span>
                                <span className='t-mono' style={{ fontSize: 12.5, color: 'var(--text-3)' }}>
                                    {t('generated')}
                                </span>
                            </div>
                            <div
                                style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    gap: 10
                                }}
                            >
                                <span className='t-muted' style={{ fontSize: 12.5 }}>
                                    {t('envUrl')}
                                </span>
                                <span className='t-mono' style={{ fontSize: 12.5, color: 'var(--accent)' }}>
                                    {slugify(draft.name) || t('slugPlaceholder')}.pasport.be
                                </span>
                            </div>
                        </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                        <Field label={t('contact')}>
                            <Input
                                value={draft.contact}
                                onChange={e => setDraft(d => ({ ...d, contact: e.target.value }))}
                                placeholder={t('contactPlaceholder')}
                            />
                        </Field>
                        <Field label={t('city')}>
                            <Input
                                value={draft.city}
                                onChange={e => setDraft(d => ({ ...d, city: e.target.value }))}
                                placeholder={t('cityPlaceholder')}
                            />
                        </Field>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 14 }}>
                        <Field label={t('adminEmail')} hint={t('adminEmailHint')}>
                            <Input
                                icon='mail'
                                type='email'
                                value={draft.email}
                                onChange={e => setDraft(d => ({ ...d, email: e.target.value }))}
                                placeholder='naam@praktijk.be'
                            />
                        </Field>
                        <Field label={t('plan')}>
                            <Select
                                className='select'
                                value={draft.plan}
                                onChange={e => setDraft(d => ({ ...d, plan: e.target.value }))}
                            >
                                {PLANS.map(p => (
                                    <option key={p}>{p}</option>
                                ))}
                            </Select>
                        </Field>
                    </div>
                    <div
                        className='badge badge-amber'
                        style={{ alignSelf: 'flex-start', height: 'auto', padding: '4px 9px', whiteSpace: 'normal' }}
                    >
                        <Icon name='loader' size={12} /> {t('provisioningNote')}
                    </div>
                </div>
            </Modal>
        </div>
    )
}

/* ============================ TENANT DETAIL ============================ */
export function TenantDetail({ tenantId }: { tenantId: string }) {
    const t = useT('Tenants')
    const f = useFormat()
    const router = useRouter()
    const push = useToast()
    const api = useApi()
    const params = useSearchParams()
    const tenant = useData<AdminTenant>(`admin/tenants/${encodeURIComponent(tenantId)}`)
    const licenses = useData<LicenseItem[]>(`admin/tenants/${encodeURIComponent(tenantId)}/licenses`)
    const [tab, setTab] = useState(params.get('tab') ?? 'apps')
    const [busy, setBusy] = useState(false)

    if (tenant.loading && !tenant.data) return <Loading />
    if (tenant.error && !tenant.data)
        return <LoadError message={tenant.error.message} onRetry={() => void tenant.reload()} />
    const tn = tenant.data
    if (!tn) return <Loading />
    const [tone, lbl] = tenantStatus(tn)
    const apps = (licenses.data ?? []).filter(i => i.subscription?.valid || i.grants.some(g => g.valid))

    const toggleStatus = async () => {
        setBusy(true)
        try {
            const next = await api<AdminTenant>(`admin/tenants/${encodeURIComponent(tn.id)}`, 'PATCH', {
                status: tn.status === 'suspended' ? 'active' : 'suspended'
            })
            tenant.setData(next)
            push(
                next.status === 'suspended' ? t('paused', { name: tn.name }) : t('activated', { name: tn.name }),
                next.status === 'suspended' ? 'pause' : 'play',
                next.status === 'suspended' ? 'neutral' : 'green'
            )
        } catch (e) {
            push(e instanceof ApiFailure ? e.message : t('failed'), 'alert', 'red')
        } finally {
            setBusy(false)
        }
    }

    const cells: [string, string, boolean?][] = [
        [t('tenantId'), tn.id, true],
        [t('plan'), tn.plan],
        [t('activeApps'), String(tn.apps)],
        [t('colUsers'), String(tn.members)],
        [t('contact'), tn.contact?.name || '—'],
        [t('email'), tn.contact?.email || '—'],
        [t('colCreated'), f.date(tn.createdAt)]
    ]

    return (
        <div className='fade-in content-wide'>
            <div className='breadcrumb' style={{ marginBottom: 16 }}>
                <a onClick={() => router.push('/admin/tenants')} role='link' tabIndex={0}>
                    {t('title')}
                </a>
                <Icon name='chevronRight' size={13} />
                <span className='crumb-current'>{tn.name}</span>
            </div>
            <div className='page-head'>
                <Avatar name={tn.name} size={52} square color='var(--surface-3)' />
                <div className='ph-text'>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <h1 style={{ fontSize: 23 }}>{tn.name}</h1>
                        <Badge tone={tone} dot>
                            {t(lbl)}
                        </Badge>
                    </div>
                    <p style={{ marginTop: 4 }} className='t-mono'>
                        {tn.slug}.pasport.be{tn.city ? ' · ' + tn.city : ''}
                    </p>
                </div>
                <div className='page-actions'>
                    <form action='/api/auth/login' method='get'>
                        <input type='hidden' name='tenant' value={tn.id} />
                        <input type='hidden' name='returnTo' value='/dashboard' />
                        <Btn type='submit' variant='secondary' icon='logout' title={t('impersonateHint')}>
                            {t('impersonate')}
                        </Btn>
                    </form>
                    <Btn
                        variant='secondary'
                        icon={tn.status === 'suspended' ? 'play' : 'pause'}
                        disabled={busy}
                        title={tn.status === 'suspended' ? t('activate') : t('pause')}
                        aria-label={tn.status === 'suspended' ? t('activate') : t('pause')}
                        onClick={() => void toggleStatus()}
                    />
                </div>
            </div>

            <div className='detail-grid' style={{ marginBottom: 24 }}>
                {cells.map(([k, v, mono]) => (
                    <div className='detail-cell' key={k}>
                        <div className='dc-label'>{k}</div>
                        <div
                            className='dc-value'
                            style={{
                                fontSize: mono ? 12.5 : k === t('email') ? 13.5 : 15,
                                fontFamily: mono ? 'var(--mono)' : 'inherit',
                                color: mono ? 'var(--text-2)' : 'var(--text)',
                                wordBreak: 'break-all'
                            }}
                        >
                            {v}
                        </div>
                    </div>
                ))}
            </div>

            <div className='tabs' role='tablist'>
                {(
                    [
                        ['apps', t('tabApps')],
                        ['users', t('tabUsers')],
                        ['access', t('tabAccess')]
                    ] as const
                ).map(([k, l]) => (
                    <div
                        key={k}
                        role='tab'
                        tabIndex={0}
                        aria-selected={tab === k}
                        className={'tab ' + (tab === k ? 'active' : '')}
                        onClick={() => setTab(k)}
                    >
                        {l}
                    </div>
                ))}
            </div>

            {tab === 'apps' && (
                <div className='table-wrap fade-in'>
                    <table className='tbl'>
                        <thead>
                            <tr>
                                <th>{t('colApp')}</th>
                                <th>{t('colEnvironment')}</th>
                                <th>{t('colDatabase')}</th>
                                <th>{t('colRegion')}</th>
                                <th>{t('colSince')}</th>
                                <th>{t('colLicenses')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {apps.length === 0 && (
                                <tr>
                                    <td colSpan={6} className='empty-row'>
                                        {t('noApps')}
                                    </td>
                                </tr>
                            )}
                            {apps.map(item => {
                                const s = item.subscription
                                const db: [Tone, string] = !s
                                    ? ['green', 'dbActive']
                                    : s.status === 'pending'
                                      ? ['amber', 'dbProvisioning']
                                      : s.status === 'canceled' || s.cancelAtPeriodEnd
                                        ? ['neutral', 'dbPaused']
                                        : ['green', 'dbActive']
                                return (
                                    <tr key={item.product.code}>
                                        <td>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                                                <AppIcon app={item.product} size={32} />
                                                <span className='strong'>{item.product.name}</span>
                                                {!s && <Badge tone='violet'>{t('free')}</Badge>}
                                            </div>
                                        </td>
                                        <td className='t-mono' style={{ fontSize: 13 }}>
                                            {s?.environmentName ? s.environmentName + ' · ' : ''}
                                            {environmentHost(
                                                item.product.launchUrl?.replace('{slug}', tn.slug) ?? null,
                                                tn.slug
                                            )}
                                        </td>
                                        <td>
                                            <Badge tone={db[0]} dot>
                                                {t(db[1])}
                                            </Badge>
                                        </td>
                                        <td style={{ fontSize: 13 }} className='t-mono'>
                                            {s?.region ?? 'eu-west-1'}
                                        </td>
                                        <td style={{ color: 'var(--text-3)', fontSize: 13 }}>
                                            {s?.currentPeriodEnd
                                                ? t('until', { date: f.date(s.currentPeriodEnd) })
                                                : '—'}
                                        </td>
                                        <td style={{ fontSize: 13 }}>
                                            {item.seats.used} / {item.seats.total}
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>
            )}
            {tab === 'users' && <UserManagement tenantId={tn.id} embedded />}
            {tab === 'access' && (
                <>
                    <AppAccess
                        tenantId={tn.id}
                        members={tn.members}
                        items={licenses.data ?? []}
                        reload={() => void licenses.reload()}
                    />
                    <MemberDemos tenantId={tn.id} items={licenses.data ?? []} reload={() => void licenses.reload()} />
                </>
            )}
        </div>
    )
}

/* ============================ USER MANAGEMENT (per tenant) ============================ */
type URow = {
    id: string
    kind: 'member' | 'invitation'
    name: string
    email: string
    role: Role
    status: 'active' | 'invited' | 'disabled'
    profession: Profession
    lastSeen: string
    /** The status of a member (a dot on its avatar); an invitation has none. */
    presence?: ShownPresence
    /** Whether the member has its eID linked (null: an invitation, or not known). */
    eid: boolean | null
}

export function UserManagement({ tenantId, embedded }: { tenantId: string; embedded?: boolean }) {
    const t = useT('Users')
    const tp = useT('Presence')
    const ta = useT('Tenants')
    const push = useToast()
    const api = useApi()
    const base = `admin/tenants/${encodeURIComponent(tenantId)}`
    const members = useData<Member[]>(`${base}/members`)
    const invitations = useData<Invitation[]>(`${base}/invitations`)
    const [modal, setModal] = useState<{ mode: 'add' | 'edit'; row?: URow } | null>(null)
    const [del, setDel] = useState<URow | null>(null)
    const [draft, setDraft] = useState({
        email: '',
        role: 'user' as Role,
        status: 'active' as URow['status'],
        profession: 'staff' as Profession
    })
    const [busy, setBusy] = useState(false)

    if (members.loading && !members.data) return <Loading rows={2} />
    if (members.error && !members.data)
        return <LoadError message={members.error.message} onRetry={() => void members.reload()} />

    const rows: URow[] = [
        ...(members.data ?? []).map(m => ({
            id: m.userId,
            kind: 'member' as const,
            name: m.name || m.email,
            email: m.email,
            role: m.role,
            status: m.status,
            profession: m.profession ?? 'staff',
            lastSeen: lastSeenLabel(t, m),
            presence: m.presence,
            eid: typeof m.eidLinked === 'boolean' ? m.eidLinked : null
        })),
        ...(invitations.data ?? []).map(i => ({
            id: i.id,
            kind: 'invitation' as const,
            name: i.email,
            email: i.email,
            role: i.role,
            status: 'invited' as const,
            profession: 'staff' as const,
            lastSeen: '—',
            eid: null
        }))
    ]
    const reloadAll = () => {
        void members.reload()
        void invitations.reload()
    }
    const run = async (
        fn: () => Promise<unknown>,
        done: string,
        icon = 'check',
        tone: 'green' | 'red' | 'accent' = 'green'
    ) => {
        setBusy(true)
        try {
            await fn()
            push(done, icon, tone)
            return true
        } catch (e) {
            push(e instanceof ApiFailure ? e.message : t('failed'), 'alert', 'red')
            return false
        } finally {
            setBusy(false)
            reloadAll()
        }
    }
    const save = async () => {
        if (!modal) return
        if (modal.mode === 'add') {
            if (
                await run(
                    () => api(`${base}/invitations`, 'POST', { email: draft.email.trim(), role: draft.role }),
                    t('invited', { email: draft.email.trim() }),
                    'mail',
                    'accent'
                )
            )
                setModal(null)
            return
        }
        const row = modal.row!
        const m = `${base}/members/${encodeURIComponent(row.id)}`
        if (
            await run(async () => {
                if (draft.role !== row.role) await api(m, 'PATCH', { role: draft.role })
                if (draft.status !== row.status && draft.status !== 'invited')
                    await api(m + '/status', 'PATCH', { status: draft.status })
                if (draft.profession !== row.profession)
                    await api(m + '/profession', 'PATCH', { profession: draft.profession })
            }, t('updated'))
        )
            setModal(null)
    }
    const editing = modal?.mode === 'edit' ? modal.row : undefined

    return (
        <div className='fade-in'>
            <div
                style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 16,
                    gap: 10
                }}
            >
                {!embedded ? (
                    <h2 className='t-h2'>{t('title')}</h2>
                ) : (
                    <span style={{ fontSize: 13.5, color: 'var(--text-3)' }}>
                        {ta('usersInTenant', { count: rows.length })}
                    </span>
                )}
                <Btn
                    icon='plus'
                    size='sm'
                    onClick={() => {
                        setDraft({ email: '', role: 'user', status: 'invited', profession: 'staff' })
                        setModal({ mode: 'add' })
                    }}
                >
                    {ta('addUser')}
                </Btn>
            </div>
            <div className='table-wrap'>
                <table className='tbl'>
                    <thead>
                        <tr>
                            <th>{t('colName')}</th>
                            <th>{t('colEmail')}</th>
                            <th>{t('colRole')}</th>
                            <th>{t('colStatus')}</th>
                            <th>{t('colLastSeen')}</th>
                            <th />
                        </tr>
                    </thead>
                    <tbody>
                        {rows.length === 0 && (
                            <tr>
                                <td colSpan={6} className='empty-row'>
                                    {ta('noUsers')}
                                </td>
                            </tr>
                        )}
                        {rows.map(u => {
                            const tone: Tone =
                                u.status === 'active' ? 'green' : u.status === 'invited' ? 'amber' : 'neutral'
                            return (
                                <tr key={u.kind + u.id}>
                                    <td>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                                            <Avatar
                                                name={u.name}
                                                size={32}
                                                status={u.presence}
                                                statusLabel={
                                                    u.presence &&
                                                    tp(u.presence === 'offline' ? 'offlineShown' : u.presence)
                                                }
                                            />
                                            <span className='strong'>{u.name}</span>
                                            {u.profession === 'doctor' && (
                                                <Badge tone='accent' icon='vault'>
                                                    {t('doctor')}
                                                </Badge>
                                            )}
                                            {u.eid !== null && (
                                                <Badge tone={u.eid ? 'green' : 'neutral'} icon='eid'>
                                                    {ta(u.eid ? 'eidLinked' : 'eidMissing')}
                                                </Badge>
                                            )}
                                        </div>
                                    </td>
                                    <td>{u.email}</td>
                                    <td>
                                        <Badge tone={u.role === 'admin' ? 'blue' : 'neutral'}>
                                            {u.role === 'admin' ? t('roleAdmin') : t('roleUser')}
                                        </Badge>
                                    </td>
                                    <td>
                                        <Badge tone={tone} dot>
                                            {t(
                                                u.status === 'active'
                                                    ? 'statusActive'
                                                    : u.status === 'invited'
                                                      ? 'statusInvited'
                                                      : 'statusDisabled'
                                            )}
                                        </Badge>
                                    </td>
                                    <td style={{ color: 'var(--text-3)', fontSize: 13 }}>{u.lastSeen}</td>
                                    <td>
                                        <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                                            {u.kind === 'invitation' ? (
                                                <Btn
                                                    variant='ghost'
                                                    size='sm'
                                                    icon='refresh'
                                                    title={t('resend')}
                                                    aria-label={t('resend')}
                                                    onClick={() =>
                                                        void run(
                                                            () =>
                                                                api(
                                                                    `${base}/invitations/${encodeURIComponent(u.id)}/resend`,
                                                                    'POST'
                                                                ),
                                                            t('resent', { email: u.email }),
                                                            'mail',
                                                            'accent'
                                                        )
                                                    }
                                                />
                                            ) : (
                                                <Btn
                                                    variant='ghost'
                                                    size='sm'
                                                    icon='edit'
                                                    title={t('edit')}
                                                    aria-label={t('edit')}
                                                    onClick={() => {
                                                        setDraft({
                                                            email: u.email,
                                                            role: u.role,
                                                            status: u.status,
                                                            profession: u.profession
                                                        })
                                                        setModal({ mode: 'edit', row: u })
                                                    }}
                                                />
                                            )}
                                            <Btn
                                                variant='ghost'
                                                size='sm'
                                                icon='trash'
                                                title={t('delete')}
                                                aria-label={t('delete')}
                                                onClick={() => setDel(u)}
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
                open={!!modal}
                onClose={() => setModal(null)}
                title={modal?.mode === 'add' ? ta('addUser') : t('editTitle')}
                footer={
                    <>
                        <Btn variant='ghost' onClick={() => setModal(null)}>
                            {t('cancel')}
                        </Btn>
                        <Btn
                            variant='primary'
                            icon='check'
                            disabled={busy || !/^\S+@\S+\.\S+$/.test(draft.email.trim())}
                            onClick={() => void save()}
                        >
                            {modal?.mode === 'add' ? t('inviteSubmit') : t('save')}
                        </Btn>
                    </>
                }
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 6 }}>
                    {editing && (
                        <Field label={t('name')}>
                            <Input value={editing.name} disabled />
                        </Field>
                    )}
                    <Field label={t('email')}>
                        <Input
                            icon='mail'
                            value={draft.email}
                            disabled={!!editing}
                            onChange={e => setDraft(d => ({ ...d, email: e.target.value }))}
                            placeholder={t('emailPlaceholder')}
                            autoFocus={!editing}
                        />
                    </Field>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                        <Field label={t('role')}>
                            <Select
                                className='select'
                                value={draft.role}
                                onChange={e => setDraft(d => ({ ...d, role: e.target.value as Role }))}
                            >
                                <option value='admin'>{t('roleAdmin')}</option>
                                <option value='user'>{t('roleUser')}</option>
                            </Select>
                        </Field>
                        <Field label={t('status')}>
                            <Select
                                className='select'
                                value={draft.status}
                                disabled={!editing}
                                onChange={e => setDraft(d => ({ ...d, status: e.target.value as URow['status'] }))}
                            >
                                <option value='active'>{t('statusActive')}</option>
                                {!editing && <option value='invited'>{t('statusInvited')}</option>}
                                <option value='disabled'>{t('statusDisabled')}</option>
                            </Select>
                        </Field>
                    </div>
                    {editing && (
                        <>
                            <Field label={t('profession')} hint={t('professionHint')}>
                                <Select
                                    className='select'
                                    value={draft.profession}
                                    onChange={e => setDraft(d => ({ ...d, profession: e.target.value as Profession }))}
                                >
                                    <option value='doctor'>{t('doctor')}</option>
                                    <option value='staff'>{t('staff')}</option>
                                </Select>
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
                                    background: 'var(--surface-2)'
                                }}
                            >
                                <div>
                                    <div style={{ fontWeight: 600, fontSize: 14 }}>{ta('resetMfa')}</div>
                                    <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 3 }}>
                                        {ta('resetMfaHint')}
                                    </div>
                                </div>
                                <Btn
                                    variant='ghost'
                                    size='sm'
                                    className='btn-danger-soft'
                                    icon='key'
                                    disabled={busy}
                                    onClick={() =>
                                        void run(
                                            () => api(`admin/users/${encodeURIComponent(editing.id)}/mfa`, 'DELETE'),
                                            ta('mfaReset')
                                        )
                                    }
                                >
                                    {ta('reset')}
                                </Btn>
                            </div>
                        </>
                    )}
                </div>
            </Modal>
            <Modal
                open={!!del}
                onClose={() => setDel(null)}
                title={del?.kind === 'invitation' ? t('deleteInvitationTitle') : t('deleteTitle')}
                width={420}
                footer={
                    <>
                        <Btn variant='ghost' onClick={() => setDel(null)}>
                            {t('cancel')}
                        </Btn>
                        <Btn
                            variant='danger'
                            icon='trash'
                            disabled={busy}
                            onClick={() =>
                                void run(
                                    () =>
                                        api(
                                            del?.kind === 'member'
                                                ? `${base}/members/${encodeURIComponent(del.id)}`
                                                : `${base}/invitations/${encodeURIComponent(del!.id)}`,
                                            'DELETE'
                                        ),
                                    del?.kind === 'member' ? t('removed') : t('invitationRemoved'),
                                    'trash',
                                    'red'
                                ).then(ok => ok && setDel(null))
                            }
                        >
                            {t('delete')}
                        </Btn>
                    </>
                }
            >
                <p>
                    {t('deleteText1')} <strong style={{ color: 'var(--text)' }}>{del?.name}</strong>{' '}
                    {del?.kind === 'invitation' ? t('deleteInvitationText') : t('deleteText2')}
                </p>
            </Modal>
        </div>
    )
}

/* ============================ APP ACCESS (manual grants) ============================ */
function AppAccess({
    tenantId,
    members,
    items,
    reload
}: {
    tenantId: string
    members: number
    items: LicenseItem[]
    reload: () => void
}) {
    const t = useT('Tenants')
    const f = useFormat()
    const push = useToast()
    const api = useApi()
    const products = useData<Product[]>('admin/products')
    const [busy, setBusy] = useState<string | null>(null)
    const list = (products.data ?? []).filter(p => p.active)

    const toggle = async (product: Product, item: LicenseItem | undefined) => {
        const grants = item?.grants.filter(g => g.valid) ?? []
        setBusy(product.code)
        try {
            if (grants.length) {
                for (const g of grants)
                    await api(
                        `admin/tenants/${encodeURIComponent(tenantId)}/grants/${encodeURIComponent(g.id)}`,
                        'DELETE'
                    )
                push(t('accessOff', { app: product.name }), 'pause', 'neutral')
            } else {
                await api(`admin/tenants/${encodeURIComponent(tenantId)}/grants`, 'POST', {
                    productCode: product.code,
                    seats: Math.max(1, members),
                    note: t('manualNote')
                })
                push(t('accessOn', { app: product.name }), 'check', 'green')
            }
            reload()
        } catch (e) {
            push(e instanceof ApiFailure ? e.message : t('failed'), 'alert', 'red')
        } finally {
            setBusy(null)
        }
    }

    return (
        <div className='fade-in card' style={{ overflow: 'hidden' }}>
            <div
                style={{
                    padding: '16px 20px',
                    borderBottom: '1px solid var(--border)',
                    background: 'var(--surface-2)'
                }}
            >
                <div className='t-h3'>{t('accessTitle')}</div>
                <div className='hint' style={{ marginTop: 3 }}>
                    {t('accessHint')}
                </div>
            </div>
            <div>
                {list.map((p, i) => {
                    const item = items.find(x => x.product.code === p.code)
                    const paid = !!item?.subscription?.valid
                    const granted = !!item?.grants.some(g => g.valid)
                    const active = paid || granted
                    return (
                        <div
                            key={p.code}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 14,
                                padding: '14px 20px',
                                borderBottom: i < list.length - 1 ? '1px solid var(--border)' : 'none',
                                flexWrap: 'wrap'
                            }}
                        >
                            <AppIcon app={p} size={36} />
                            <div style={{ flex: 1, minWidth: 160 }}>
                                <div className='strong' style={{ fontWeight: 600, color: 'var(--text)' }}>
                                    {p.name}
                                </div>
                                <div style={{ fontSize: 12.5, color: 'var(--text-3)' }}>
                                    {f.eur(p.priceMonthCents)} {t('perMonth')}
                                    {p.category ? ' · ' + p.category : ''}
                                    {paid ? ' · ' + t('paidSubscription') : ''}
                                </div>
                            </div>
                            <label
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 8,
                                    fontSize: 13,
                                    color: 'var(--text-2)',
                                    opacity: active ? 1 : 0.4
                                }}
                            >
                                <span>{t('free')}</span>
                                <Toggle on={granted} disabled />
                            </label>
                            <div style={{ width: 1, height: 24, background: 'var(--border)' }} />
                            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span
                                    style={{
                                        fontSize: 13,
                                        fontWeight: 600,
                                        color: active ? 'var(--green)' : 'var(--text-3)',
                                        width: 64,
                                        textAlign: 'right'
                                    }}
                                >
                                    {active ? t('statusActive') : t('inactive')}
                                </span>
                                <Toggle
                                    on={active}
                                    disabled={busy === p.code || (paid && !granted)}
                                    onClick={() => void toggle(p, item)}
                                />
                            </label>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}

/* ============================ DEMOS PER MEMBER (trials) ============================ */
const DEMO_DAYS = 14
const DAY_MS = 24 * 60 * 60 * 1000

/** Does the trial run, and how many days it has left (started ones count as a whole day). */
function demoState(trial: LicenseItem['trials'][number] | undefined) {
    const left = trial ? new Date(trial.endsAt).getTime() - Date.now() : 0
    return { running: left > 0, days: Math.ceil(left / DAY_MS) }
}

/**
 * Per app: the demo (trial) of every member, and give (or extend) or stop it. A superadmin can always give one, also
 * when the demo of the app is turned off.
 */
function MemberDemos({ tenantId, items, reload }: { tenantId: string; items: LicenseItem[]; reload: () => void }) {
    const t = useT('Tenants')
    const f = useFormat()
    const push = useToast()
    const api = useApi()
    const base = `admin/tenants/${encodeURIComponent(tenantId)}`
    const products = useData<Product[]>('admin/products')
    const members = useData<Member[]>(`${base}/members`)
    const [code, setCode] = useState('')
    const [busy, setBusy] = useState<string | null>(null)
    const list = (products.data ?? []).filter(p => p.active)
    const product = list.find(p => p.code === code) ?? list[0]
    if (!product) return null
    const trials = items.find(x => x.product.code === product.code)?.trials ?? []

    const run = async (member: Member, fn: () => Promise<{ endsAt: string }>, done: (endsAt: string) => string) => {
        setBusy(member.userId)
        try {
            const result = await fn()
            push(done(result.endsAt), 'clock', 'green')
            reload()
        } catch (e) {
            push(e instanceof ApiFailure ? e.message : t('failed'), 'alert', 'red')
        } finally {
            setBusy(null)
        }
    }
    const give = (member: Member) =>
        run(
            member,
            () =>
                api<{ endsAt: string }>(`${base}/trials`, 'POST', {
                    productCode: product.code,
                    userId: member.userId,
                    days: DEMO_DAYS
                }),
            endsAt => t('demoGiven', { name: member.name || member.email, app: product.name, date: f.date(endsAt) })
        )
    const stop = (member: Member) =>
        run(
            member,
            () =>
                api<{ endsAt: string }>(
                    `${base}/trials/${encodeURIComponent(product.code)}/${encodeURIComponent(member.userId)}`,
                    'DELETE'
                ),
            () => t('demoStopped', { name: member.name || member.email, app: product.name })
        )

    return (
        <div className='fade-in card' style={{ overflow: 'hidden', marginTop: 18 }}>
            <div
                style={{
                    padding: '16px 20px',
                    borderBottom: '1px solid var(--border)',
                    background: 'var(--surface-2)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                    flexWrap: 'wrap'
                }}
            >
                <div style={{ flex: 1, minWidth: 220 }}>
                    <div className='t-h3'>{t('demosTitle')}</div>
                    <div className='hint' style={{ marginTop: 3 }}>
                        {t('demosHint', { days: DEMO_DAYS })}
                    </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {product.demoEnabled === false && (
                        <span style={{ fontSize: 12.5, color: 'var(--text-3)' }}>{t('demoOffForApp')}</span>
                    )}
                    <Select
                        className='select'
                        value={product.code}
                        ariaLabel={t('colApp')}
                        style={{ minWidth: 180 }}
                        onChange={e => setCode(e.target.value)}
                    >
                        {list.map(p => (
                            <option key={p.code} value={p.code}>
                                {p.name}
                            </option>
                        ))}
                    </Select>
                </div>
            </div>
            {members.loading && !members.data ? (
                <Loading rows={2} />
            ) : members.error && !members.data ? (
                <LoadError message={members.error.message} onRetry={() => void members.reload()} />
            ) : (
                <table className='tbl'>
                    <tbody>
                        {(members.data ?? []).length === 0 && (
                            <tr>
                                <td colSpan={3} className='empty-row'>
                                    {t('noUsers')}
                                </td>
                            </tr>
                        )}
                        {(members.data ?? []).map(m => {
                            const trial = trials.find(x => x.userId === m.userId)
                            const { running, days } = demoState(trial)
                            return (
                                <tr key={m.userId}>
                                    <td>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                                            <Avatar name={m.name || m.email} size={28} />
                                            <div>
                                                <div className='strong'>{m.name || m.email}</div>
                                                <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{m.email}</div>
                                            </div>
                                        </div>
                                    </td>
                                    <td>
                                        {running && trial ? (
                                            <Badge tone='violet' dot title={t('until', { date: f.date(trial.endsAt) })}>
                                                {t('demoRunning', { days })}
                                            </Badge>
                                        ) : trial ? (
                                            <span style={{ fontSize: 13, color: 'var(--text-3)' }}>
                                                {t('demoEnded', { date: f.date(trial.endsAt) })}
                                            </span>
                                        ) : (
                                            <span style={{ fontSize: 13, color: 'var(--text-3)' }}>
                                                {t('demoNone')}
                                            </span>
                                        )}
                                    </td>
                                    <td>
                                        <div style={{ display: 'flex', gap: 14, justifyContent: 'flex-end' }}>
                                            <button
                                                type='button'
                                                className='link-btn'
                                                disabled={busy === m.userId}
                                                onClick={() => void give(m)}
                                            >
                                                {running
                                                    ? t('demoExtend', { days: DEMO_DAYS })
                                                    : t('demoGive', { days: DEMO_DAYS })}
                                            </button>
                                            {running && (
                                                <button
                                                    type='button'
                                                    className='link-btn'
                                                    style={{ color: 'var(--red)' }}
                                                    disabled={busy === m.userId}
                                                    onClick={() => void stop(m)}
                                                >
                                                    {t('demoStop')}
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            )}
        </div>
    )
}
