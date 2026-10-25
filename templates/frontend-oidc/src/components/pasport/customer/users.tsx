'use client'

import { useState } from 'react'
import { useLocale } from 'next-intl'
import {
    ApiFailure,
    type AppRole,
    type AppRolesMember,
    type CatalogApp,
    type Invitation,
    type LicenseItem,
    type Member,
    type ShownPresence,
    type Profession,
    type Role,
    type TenantApp,
    useApi,
    useData,
    useFormat
} from '@/lib/portal'
import { useMe } from '../portal-shell'
import { useT, type T } from '../i18n'
import { LoadError, Loading, Notice } from '../page-state'
import { useToast } from '../toast'
import { AppIcon, appColor, Avatar, Badge, Btn, Field, Icon, Input, Select, Toggle } from '../ui'
import { Modal } from '../widgets'

type Status = 'active' | 'invited' | 'disabled'
type Row = {
    id: string
    kind: 'member' | 'invitation'
    name: string
    email: string
    role: Role
    status: Status
    profession: Profession
    lastSeen: string
    /** The status of a member (a dot on its avatar); an invitation has none. */
    presence?: ShownPresence
    apps: string[]
}

const ST_BADGE: Record<Status, ['green' | 'amber' | 'neutral', string]> = {
    active: ['green', 'statusActive'],
    invited: ['amber', 'statusInvited'],
    disabled: ['neutral', 'statusDisabled']
}

/** "Vandaag", "Gisteren", "3 dagen geleden", … from the last heartbeat. */
export function lastSeenLabel(t: T, member: { online?: boolean; lastSeenAt: string | null }) {
    if (member.online) return t('online')
    if (!member.lastSeenAt) return '—'
    const days = Math.floor((Date.now() - new Date(member.lastSeenAt).getTime()) / 86_400_000)
    const sameDay = new Date(member.lastSeenAt).toDateString() === new Date().toDateString()
    if (sameDay) return t('today')
    if (days <= 1) return t('yesterday')
    if (days < 14) return t('daysAgo', { count: days })
    return t('weeksAgo', { count: Math.floor(days / 7) })
}

function LicenseChips({ keys, apps, t }: { keys: string[]; apps: CatalogApp[]; t: T }) {
    if (keys.length === 0)
        return (
            <span className='t-muted' style={{ fontSize: 12.5 }}>
                {t('noLicenses')}
            </span>
        )
    return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {keys.map(k => {
                const a = apps.find(x => x.code === k)
                if (!a) return null
                return (
                    <span className='badge badge-neutral' key={k}>
                        <span
                            style={{
                                width: 7,
                                height: 7,
                                borderRadius: '50%',
                                background: appColor(a),
                                display: 'inline-block',
                                flex: 'none'
                            }}
                        />
                        {a.name}
                    </span>
                )
            })}
        </div>
    )
}

/** The roles of an app as checkboxes (the developer of the app defines them; their names per language). */
function RolePicker({
    roles,
    value,
    onToggle,
    disabled,
    t
}: {
    roles: AppRole[]
    value: string[]
    onToggle: (key: string) => void
    disabled: boolean
    t: T
}) {
    const locale = useLocale() as keyof AppRole['names']
    return (
        <div
            style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 14px', padding: '0 12px 2px' }}
        >
            <span className='t-muted' style={{ fontSize: 12 }}>
                {t('appRoles')}
            </span>
            {roles.map(role => (
                <label key={role.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                    <input
                        type='checkbox'
                        checked={value.includes(role.key)}
                        disabled={disabled}
                        onChange={() => onToggle(role.key)}
                    />
                    {role.names[locale] ?? role.names.en}
                </label>
            ))}
        </div>
    )
}

function LicensePicker({
    ownedApps,
    value,
    onToggle,
    disabled,
    roles,
    t
}: {
    ownedApps: CatalogApp[]
    value: string[]
    onToggle: (k: string) => void
    /** The licence of an app can not be changed here (all of them, or per app). */
    disabled: boolean | ((code: string) => boolean)
    /** The roles per app: shown under an app that has them (when `show` says so). */
    roles?: {
        of: (code: string) => AppRole[]
        value: (code: string) => string[]
        onToggle: (code: string, key: string) => void
        show: (code: string) => boolean
    }
    t: T
}) {
    const f = useFormat()
    const off = (code: string) => (typeof disabled === 'function' ? disabled(code) : disabled)
    if (ownedApps.length === 0) return <p className='hint'>{t('noAppsYet')}</p>
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {ownedApps.map(a => (
                <div key={a.code} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <label
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 12,
                            padding: '10px 12px',
                            border: '1px solid var(--border)',
                            borderRadius: 'var(--r-md)',
                            background: 'var(--surface-2)',
                            cursor: off(a.code) ? 'default' : 'pointer',
                            opacity: off(a.code) ? 0.6 : 1
                        }}
                    >
                        <AppIcon app={a} size={32} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: 13.5 }}>{a.name}</div>
                            <div className='t-muted' style={{ fontSize: 12 }}>
                                {t('perLicense', { price: f.eur(a.priceMonthCents) })} ·{' '}
                                {t('seatsLeft', { used: a.seatsUsed, total: a.seatsTotal })}
                            </div>
                        </div>
                        <Toggle on={value.includes(a.code)} onClick={() => onToggle(a.code)} disabled={off(a.code)} />
                    </label>
                    {roles && roles.show(a.code) && roles.of(a.code).length > 0 && (
                        <RolePicker
                            roles={roles.of(a.code)}
                            value={roles.value(a.code)}
                            onToggle={key => roles.onToggle(a.code, key)}
                            disabled={false}
                            t={t}
                        />
                    )}
                </div>
            ))}
        </div>
    )
}

/** roles: the roles per app (client id = app code); rolesBefore: what the member had (to save only changes). */
type Draft = {
    email: string
    role: Role
    status: Status
    profession: Profession
    apps: string[]
    roles: Record<string, string[]>
    rolesBefore: Record<string, string[]>
}
const EMPTY: Draft = {
    email: '',
    role: 'user',
    status: 'invited',
    profession: 'staff',
    apps: [],
    roles: {},
    rolesBefore: {}
}
const defaults = (app: TenantApp | undefined) => (app?.roles ?? []).filter(r => r.default).map(r => r.key)
const sameRoles = (a: string[], b: string[]) => a.length === b.length && a.every(key => b.includes(key))

export function CustomerUsers({ me, admin }: { me: string; admin: boolean }) {
    const t = useT('Users')
    const tp = useT('Presence')
    const push = useToast()
    const api = useApi()
    const shell = useMe()
    const members = useData<Member[]>(admin ? 'tenants/current/members' : null)
    const invitations = useData<Invitation[]>(admin ? 'tenants/current/invitations' : null)
    const licenses = useData<LicenseItem[]>(admin ? 'tenants/current/licenses' : null)
    const catalog = useData<CatalogApp[]>(admin ? 'tenants/current/catalog' : null)
    // The apps that can be given in an invitation, with their roles (the client id is the app code)
    const tenantApps = useData<TenantApp[]>(admin ? 'tenants/current/apps' : null)
    const [modal, setModal] = useState<{ mode: 'add' | 'edit'; row?: Row } | null>(null)
    const [del, setDel] = useState<Row | null>(null)
    const [draft, setDraft] = useState<Draft>(EMPTY)
    const [busy, setBusy] = useState(false)

    if (!admin) return <Notice title={t('adminOnly')} />
    if ((members.loading && !members.data) || (catalog.loading && !catalog.data)) return <Loading />
    if (members.error && !members.data)
        return <LoadError message={members.error.message} onRetry={() => void members.reload()} />

    const apps = catalog.data ?? []
    const ownedApps = apps.filter(a => a.owned)
    const appOf = (code: string) => (tenantApps.data ?? []).find(x => x.clientId === code)
    const assigned = (userId: string) =>
        (licenses.data ?? [])
            .filter(i => i.assignments.some(a => a.userId === userId && a.active))
            .map(i => i.product.code)

    const rows: Row[] = [
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
            apps: assigned(m.userId)
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
            // The licences that come with the invitation
            apps: (i.apps ?? []).filter(a => a.seat).map(a => a.clientId)
        }))
    ]
    const team = rows.length

    const reloadAll = () => {
        void members.reload()
        void invitations.reload()
        void licenses.reload()
        void catalog.reload()
    }
    const fail = (e: unknown) => push(e instanceof ApiFailure ? e.message : t('failed'), 'alert', 'red')

    const openAdd = () => {
        setDraft(EMPTY)
        setModal({ mode: 'add' })
    }
    const openEdit = (row: Row) => {
        setDraft({
            email: row.email,
            role: row.role,
            status: row.status,
            profession: row.profession,
            apps: [...row.apps],
            roles: {},
            rolesBefore: {}
        })
        setModal({ mode: 'edit', row })
        // The roles of the member in every app that has roles
        for (const app of (tenantApps.data ?? []).filter(a => a.roles.length > 0))
            api<AppRolesMember[]>(`tenants/current/apps/${encodeURIComponent(app.clientId)}/members`)
                .then(list => {
                    const roles = list.find(m => m.userId === row.id)?.roles ?? []
                    setDraft(d => ({
                        ...d,
                        roles: { ...d.roles, [app.clientId]: roles },
                        rolesBefore: { ...d.rolesBefore, [app.clientId]: roles }
                    }))
                })
                .catch(() => undefined)
    }
    const toggleDraftApp = (k: string) =>
        setDraft(d => {
            const on = !d.apps.includes(k)
            // A new invitation starts with the default roles of the app
            const roles = on && !(k in d.roles) ? { ...d.roles, [k]: defaults(appOf(k)) } : d.roles
            return { ...d, roles, apps: on ? [...d.apps, k] : d.apps.filter(x => x !== k) }
        })
    const toggleDraftRole = (code: string, key: string) =>
        setDraft(d => {
            const list = d.roles[code] ?? []
            return {
                ...d,
                roles: { ...d.roles, [code]: list.includes(key) ? list.filter(x => x !== key) : [...list, key] }
            }
        })

    const save = async () => {
        if (!modal) return
        setBusy(true)
        try {
            if (modal.mode === 'add') {
                // The ticked apps: a licence and their roles (the default roles are sent as null: they follow the app)
                const invited = draft.apps.filter(code => appOf(code))
                await api('tenants/current/invitations', 'POST', {
                    email: draft.email.trim(),
                    role: draft.role,
                    apps: invited.map(code => {
                        const roles = draft.roles[code] ?? defaults(appOf(code))
                        return {
                            clientId: code,
                            roles: sameRoles(roles, defaults(appOf(code))) ? null : roles,
                            seat: true
                        }
                    })
                })
                push(t('invited', { email: draft.email.trim() }), 'mail', 'accent')
            } else if (modal.row) {
                const row = modal.row
                const base = `tenants/current/members/${encodeURIComponent(row.id)}`
                if (row.kind === 'member') {
                    if (draft.role !== row.role) await api(base, 'PATCH', { role: draft.role })
                    if (draft.status !== row.status && draft.status !== 'invited')
                        await api(base + '/status', 'PATCH', { status: draft.status })
                    if (draft.profession !== row.profession)
                        await api(base + '/profession', 'PATCH', { profession: draft.profession })
                    for (const code of ownedApps.map(a => a.code)) {
                        const before = row.apps.includes(code)
                        const after = draft.apps.includes(code)
                        if (before === after) continue
                        await api(
                            `tenants/current/licenses/${encodeURIComponent(code)}/seats/${encodeURIComponent(row.id)}`,
                            after ? 'POST' : 'DELETE'
                        )
                    }
                    // The roles per app that changed
                    for (const [code, roles] of Object.entries(draft.roles)) {
                        const before = draft.rolesBefore[code]
                        if (!before || sameRoles(before, roles)) continue
                        await api(
                            `tenants/current/apps/${encodeURIComponent(code)}/members/${encodeURIComponent(row.id)}`,
                            'PUT',
                            { roles }
                        )
                    }
                }
                push(t('updated'), 'check', 'green')
            }
            setModal(null)
        } catch (e) {
            fail(e)
        } finally {
            setBusy(false)
            reloadAll()
        }
    }
    const confirmDel = async () => {
        if (!del) return
        setBusy(true)
        try {
            await api(
                del.kind === 'member'
                    ? `tenants/current/members/${encodeURIComponent(del.id)}`
                    : `tenants/current/invitations/${encodeURIComponent(del.id)}`,
                'DELETE'
            )
            push(del.kind === 'member' ? t('removed') : t('invitationRemoved'), 'trash', 'red')
            setDel(null)
        } catch (e) {
            fail(e)
        } finally {
            setBusy(false)
            reloadAll()
        }
    }
    const resend = async (row: Row) => {
        try {
            await api(`tenants/current/invitations/${encodeURIComponent(row.id)}/resend`, 'POST')
            push(t('resent', { email: row.email }), 'mail', 'accent')
        } catch (e) {
            fail(e)
        }
    }

    const editing = modal?.mode === 'edit' ? modal.row : undefined

    return (
        <div className='fade-in content-wide'>
            <div className='page-head'>
                <div className='ph-text'>
                    <h1>{t('title')}</h1>
                    <p>{t('subtitle', { practice: shell.tenant?.name ?? '' })}</p>
                </div>
                <div className='page-actions'>
                    <Btn icon='plus' onClick={openAdd}>
                        {t('invite')}
                    </Btn>
                </div>
            </div>

            <div className='kpi-grid' style={{ marginBottom: 20 }}>
                <div className='card kpi'>
                    <div className='kpi-top'>
                        <div
                            className='kpi-icon'
                            style={{
                                background: 'color-mix(in srgb, var(--accent) 14%, transparent)',
                                color: 'var(--accent)'
                            }}
                        >
                            <Icon name='users' size={17} />
                        </div>
                    </div>
                    <div className='kpi-value'>{team}</div>
                    <div className='kpi-label'>{t('teamMembers')}</div>
                </div>
                {ownedApps.map(a => {
                    const col = appColor(a)
                    const withLicense = rows.filter(r => r.apps.includes(a.code)).length
                    return (
                        <div className='card kpi' key={a.code}>
                            <div className='kpi-top'>
                                <div
                                    className='kpi-icon'
                                    style={{ background: `color-mix(in srgb, ${col} 14%, transparent)`, color: col }}
                                >
                                    <Icon name={a.icon} size={17} />
                                </div>
                            </div>
                            <div className='kpi-value'>
                                {withLicense}
                                <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-3)' }}>
                                    {' '}
                                    / {a.seatsTotal || team}
                                </span>
                            </div>
                            <div className='kpi-label'>{t('appLicenses', { app: a.name })}</div>
                        </div>
                    )
                })}
            </div>

            <div className='table-wrap'>
                <table className='tbl'>
                    <thead>
                        <tr>
                            <th>{t('colName')}</th>
                            <th>{t('colEmail')}</th>
                            <th>{t('colRole')}</th>
                            <th>{t('colLicenses')}</th>
                            <th>{t('colStatus')}</th>
                            <th>{t('colLastSeen')}</th>
                            <th />
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(u => {
                            const [tone, lbl] = ST_BADGE[u.status]
                            const self = u.kind === 'member' && u.id === me
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
                                            {self && <Badge tone='neutral'>{t('you')}</Badge>}
                                            {u.profession === 'doctor' && (
                                                <Badge tone='accent' icon='vault'>
                                                    {t('doctor')}
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
                                        <LicenseChips keys={u.apps} apps={apps} t={t} />
                                    </td>
                                    <td>
                                        <Badge tone={tone} dot>
                                            {t(lbl)}
                                        </Badge>
                                    </td>
                                    <td style={{ color: 'var(--text-3)', fontSize: 13 }}>{u.lastSeen}</td>
                                    <td>
                                        <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                                            {u.kind === 'invitation' && (
                                                <Btn
                                                    variant='ghost'
                                                    size='sm'
                                                    icon='refresh'
                                                    title={t('resend')}
                                                    aria-label={t('resend')}
                                                    onClick={() => void resend(u)}
                                                />
                                            )}
                                            {u.kind === 'member' && (
                                                <Btn
                                                    variant='ghost'
                                                    size='sm'
                                                    icon='edit'
                                                    title={t('edit')}
                                                    aria-label={t('edit')}
                                                    onClick={() => openEdit(u)}
                                                />
                                            )}
                                            <Btn
                                                variant='ghost'
                                                size='sm'
                                                icon='trash'
                                                title={t('delete')}
                                                aria-label={t('delete')}
                                                disabled={self}
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
                title={modal?.mode === 'add' ? t('inviteTitle') : t('editTitle')}
                width={480}
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
                            type='email'
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
                                disabled={editing?.id === me}
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
                                disabled={!editing || editing.id === me}
                                onChange={e => setDraft(d => ({ ...d, status: e.target.value as Status }))}
                            >
                                <option value='active'>{t('statusActive')}</option>
                                {!editing && <option value='invited'>{t('statusInvited')}</option>}
                                <option value='disabled'>{t('statusDisabled')}</option>
                            </Select>
                        </Field>
                    </div>
                    {editing && (
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
                    )}
                    <Field label={t('licenses')} hint={editing ? t('licensesHint') : t('licensesWithInvite')}>
                        <LicensePicker
                            ownedApps={ownedApps}
                            value={draft.apps}
                            onToggle={toggleDraftApp}
                            // An invitation can only give the apps that are linked to this login server
                            disabled={editing ? false : code => !appOf(code)}
                            roles={{
                                of: code => appOf(code)?.roles ?? [],
                                value: code => draft.roles[code] ?? [],
                                onToggle: toggleDraftRole,
                                // Inviting: under a ticked app; editing: once the roles of the member are known
                                show: code => (editing ? code in draft.rolesBefore : draft.apps.includes(code))
                            }}
                            t={t}
                        />
                    </Field>
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
                        <Btn variant='danger' icon='trash' disabled={busy} onClick={() => void confirmDel()}>
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
