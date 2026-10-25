'use client'

import { useState } from 'react'
import { type AdminTenant, ApiFailure, useApi, useData } from '@/lib/portal'
import { useT } from '../i18n'
import { LoadError, Loading } from '../page-state'
import { useToast } from '../toast'
import { Avatar, Badge, Btn, Field, Input, Select } from '../ui'
import { Modal } from '../widgets'
import { UserManagement } from './tenants'

const PLATFORM = 'platform'

/** Users per tenant (invite, edit, remove), and the superadmins of the platform. */
export function AdminUsers({ me }: { me: string }) {
    const t = useT('AdminUsers')
    const tenants = useData<AdminTenant[]>('admin/tenants')
    const [tenant, setTenant] = useState<string | null>(null)

    if (tenants.loading && !tenants.data) return <Loading />
    if (tenants.error && !tenants.data)
        return <LoadError message={tenants.error.message} onRetry={() => void tenants.reload()} />
    const list = tenants.data ?? []
    const selected = tenant ?? list[0]?.id ?? PLATFORM
    const tn = list.find(x => x.id === selected)

    return (
        <div className='fade-in content-wide'>
            <div className='page-head'>
                <div className='ph-text'>
                    <h1>{t('title')}</h1>
                    <p>{t('subtitle')}</p>
                </div>
                <div className='page-actions'>
                    <Select
                        className='select'
                        style={{ width: 280 }}
                        value={selected}
                        onChange={e => setTenant(e.target.value)}
                        ariaLabel={t('tenant')}
                    >
                        <option value={PLATFORM}>{t('superadmins')}</option>
                        {list.map(x => (
                            <option key={x.id} value={x.id}>
                                {x.name}
                            </option>
                        ))}
                    </Select>
                </div>
            </div>
            {tn ? (
                <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                        <Badge tone='accent' icon='building'>
                            {tn.name}
                        </Badge>
                        <span className='t-mono' style={{ fontSize: 13, color: 'var(--text-3)' }}>
                            {tn.slug}.pasport.be
                        </span>
                    </div>
                    <UserManagement key={tn.id} tenantId={tn.id} embedded />
                </>
            ) : (
                <Superadmins me={me} />
            )}
        </div>
    )
}

type Superadmin = { userId: string; name: string; email: string }

function Superadmins({ me }: { me: string }) {
    const t = useT('AdminUsers')
    const push = useToast()
    const api = useApi()
    const { data, error, loading, reload } = useData<Superadmin[]>('admin/superadmins')
    const [modal, setModal] = useState(false)
    const [email, setEmail] = useState('')
    const [busy, setBusy] = useState(false)

    if (loading && !data) return <Loading rows={2} />
    if (error && !data) return <LoadError message={error.message} onRetry={() => void reload()} />
    const run = async (fn: () => Promise<unknown>, done: string, icon: string) => {
        setBusy(true)
        try {
            await fn()
            push(done, icon, 'green')
            return true
        } catch (e) {
            push(e instanceof ApiFailure ? e.message : t('failed'), 'alert', 'red')
            return false
        } finally {
            setBusy(false)
            void reload()
        }
    }

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
                <span style={{ fontSize: 13.5, color: 'var(--text-3)' }}>{t('superadminsText')}</span>
                <Btn
                    icon='plus'
                    size='sm'
                    onClick={() => {
                        setEmail('')
                        setModal(true)
                    }}
                >
                    {t('addSuperadmin')}
                </Btn>
            </div>
            <div className='table-wrap'>
                <table className='tbl'>
                    <thead>
                        <tr>
                            <th>{t('colName')}</th>
                            <th>{t('colEmail')}</th>
                            <th>{t('colRole')}</th>
                            <th />
                        </tr>
                    </thead>
                    <tbody>
                        {(data ?? []).map(a => (
                            <tr key={a.userId}>
                                <td>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                                        <Avatar name={a.name || a.email} size={32} color='var(--text)' />
                                        <span className='strong'>{a.name || a.email}</span>
                                        {a.userId === me && <Badge tone='neutral'>{t('you')}</Badge>}
                                    </div>
                                </td>
                                <td>{a.email}</td>
                                <td>
                                    <Badge tone='blue' icon='shield'>
                                        {t('superadmin')}
                                    </Badge>
                                </td>
                                <td>
                                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                        <Btn
                                            variant='ghost'
                                            size='sm'
                                            icon='trash'
                                            title={t('revoke')}
                                            aria-label={t('revoke')}
                                            disabled={busy || a.userId === me}
                                            onClick={() =>
                                                void run(
                                                    () =>
                                                        api(
                                                            `admin/superadmins/${encodeURIComponent(a.userId)}`,
                                                            'DELETE'
                                                        ),
                                                    t('revoked', { name: a.name || a.email }),
                                                    'trash'
                                                )
                                            }
                                        />
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <Modal
                open={modal}
                onClose={() => setModal(false)}
                title={t('addSuperadmin')}
                width={440}
                footer={
                    <>
                        <Btn variant='ghost' onClick={() => setModal(false)}>
                            {t('cancel')}
                        </Btn>
                        <Btn
                            variant='primary'
                            icon='shield'
                            disabled={busy || !/^\S+@\S+\.\S+$/.test(email.trim())}
                            onClick={() =>
                                void run(
                                    () => api('admin/superadmins', 'POST', { email: email.trim() }),
                                    t('added', { email: email.trim() }),
                                    'shield'
                                ).then(ok => ok && setModal(false))
                            }
                        >
                            {t('add')}
                        </Btn>
                    </>
                }
            >
                <Field label={t('email')} hint={t('addHint')}>
                    <Input icon='mail' type='email' value={email} onChange={e => setEmail(e.target.value)} autoFocus />
                </Field>
            </Modal>
        </div>
    )
}
