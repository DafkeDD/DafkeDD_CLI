'use client'

import { type FormEvent, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { BUTTON, DANGER, Heading, INPUT, LoginButton, Notice, SECONDARY, WIDE_CARD } from '@/components/account-ui'
import { type Answer, useBackend } from '@/lib/account'

type Tenant = { id: string; slug: string; name: string; status: 'active' | 'suspended'; members: number }
type Superadmin = { userId: string; name: string; email: string }

/** /admin: every organisation of the platform and the superadmins. Only for superadmins (the API checks it too). */
export function Platform({ me }: { me: string }) {
    const t = useTranslations('Oidc')
    const backend = useBackend()
    const [tenants, setTenants] = useState<Tenant[] | null>(null)
    const [admins, setAdmins] = useState<Superadmin[]>([])
    const [problem, setProblem] = useState<'session' | 'access' | null>(null)
    const [error, setError] = useState('')
    const [notice, setNotice] = useState('')
    const [busy, setBusy] = useState(false)
    const [confirm, setConfirm] = useState('')

    const fetchAll = () => Promise.all([backend('admin/tenants'), backend('admin/superadmins')])

    /** Shows the tenants and the superadmins (or why they cannot be shown). */
    function show([list, superadmins]: Answer[]) {
        if (list?.status === 401) return setProblem('session')
        if (list?.status === 403) return setProblem('access')
        if (list?.status !== 200) return setError(list?.message || t('offline'))
        setTenants(list.body as unknown as Tenant[])
        if (superadmins?.status === 200) setAdmins(superadmins.body as unknown as Superadmin[])
    }
    const load = async () => show(await fetchAll())

    useEffect(() => {
        fetchAll()
            .then(show)
            .catch(() => setError(t('offline')))
        // once when the page opens
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    async function change(path: string, method: string, body: object | undefined, success: string) {
        setBusy(true)
        setError('')
        setNotice('')
        try {
            const result = await backend(path, method, body)
            if (result.status === 401) setProblem('session')
            else if (result.status >= 400) setError(result.message || t('offline'))
            else setNotice(success)
            await load()
        } catch {
            setError(t('offline'))
        }
        setConfirm('')
        setBusy(false)
    }

    function createTenant(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const form = event.currentTarget
        const values = Object.fromEntries(new FormData(form))
        const name = String(values.name)
        const adminEmail = String(values.adminEmail ?? '').trim()
        void change(
            'admin/tenants',
            'POST',
            { name, ...(adminEmail ? { adminEmail } : {}) },
            t('created', { name })
        ).then(() => form.reset())
    }

    function grant(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const form = event.currentTarget
        const email = String(new FormData(form).get('email'))
        void change('admin/superadmins', 'POST', { email }, t('saved')).then(() => form.reset())
    }

    if (problem === 'session')
        return (
            <section className={WIDE_CARD}>
                <Notice tone='error'>{t('sessionExpired')}</Notice>
                <LoginButton label={t('signIn')} returnTo='/admin' />
            </section>
        )
    if (problem === 'access')
        return (
            <section className={WIDE_CARD}>
                <Notice tone='error'>{t('onlySuperadmins')}</Notice>
            </section>
        )

    return (
        <section className={WIDE_CARD}>
            <Heading title={t('platformTitle')} text={t('platformText')} />
            {error && <Notice tone='error'>{error}</Notice>}
            {notice && <Notice tone='success'>{notice}</Notice>}

            <h2 className='text-base font-semibold'>{t('tenantsTitle')}</h2>
            {!tenants ? (
                <p className='text-sm text-[var(--text-3)]'>{t('busy')}</p>
            ) : tenants.length === 0 ? (
                <p className='text-sm text-[var(--text-2)]'>{t('noTenantsYet')}</p>
            ) : (
                <ul className='flex flex-col divide-y divide-[var(--border)]'>
                    {tenants.map(tenant => (
                        <li key={tenant.id} className='flex flex-wrap items-center gap-3 py-3'>
                            <div className='flex min-w-0 flex-1 basis-48 flex-col'>
                                <span className='truncate text-sm font-semibold'>{tenant.name}</span>
                                <span className='truncate text-xs text-[var(--text-3)]'>
                                    {tenant.slug} · {t('memberCount', { count: tenant.members })}
                                </span>
                            </div>
                            <span
                                className={
                                    'rounded-full px-2.5 py-0.5 text-xs font-semibold ' +
                                    (tenant.status === 'active'
                                        ? 'bg-[var(--green)]/10 text-[var(--green)]'
                                        : 'bg-[var(--red)]/10 text-[var(--red)]')
                                }
                            >
                                {tenant.status === 'active' ? t('active') : t('suspended')}
                            </span>
                            {tenant.status === 'active' && (
                                // Into this organisation (its members): with the open session, no new password or code
                                <form action='/api/auth/login' method='get'>
                                    <input type='hidden' name='tenant' value={tenant.id} />
                                    <input type='hidden' name='returnTo' value='/members' />
                                    <button type='submit' className={SECONDARY}>
                                        {t('openTenant')}
                                    </button>
                                </form>
                            )}
                            <button
                                type='button'
                                disabled={busy}
                                className={SECONDARY}
                                onClick={() =>
                                    void change(
                                        'admin/tenants/' + tenant.id,
                                        'PATCH',
                                        { status: tenant.status === 'active' ? 'suspended' : 'active' },
                                        t('saved')
                                    )
                                }
                            >
                                {tenant.status === 'active' ? t('suspend') : t('activate')}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            <form onSubmit={createTenant} className='flex flex-col gap-3 border-t border-[var(--border)] pt-5'>
                <h2 className='text-base font-semibold'>{t('newTenant')}</h2>
                <div className='flex flex-wrap gap-2.5'>
                    <input
                        name='name'
                        required
                        minLength={2}
                        maxLength={100}
                        placeholder={t('organisation')}
                        aria-label={t('organisation')}
                        className={INPUT + ' min-w-48 flex-1'}
                    />
                    <input
                        name='adminEmail'
                        type='email'
                        maxLength={254}
                        placeholder={t('adminEmailOptional')}
                        aria-label={t('adminEmailOptional')}
                        className={INPUT + ' min-w-56 flex-1'}
                    />
                    <button type='submit' disabled={busy} className={BUTTON}>
                        {t('create')}
                    </button>
                </div>
            </form>

            <div className='flex flex-col gap-3 border-t border-[var(--border)] pt-5'>
                <h2 className='text-base font-semibold'>{t('superadminsTitle')}</h2>
                <ul className='flex flex-col divide-y divide-[var(--border)]'>
                    {admins.map(admin => (
                        <li key={admin.userId} className='flex flex-wrap items-center gap-3 py-3'>
                            <div className='flex min-w-0 flex-1 basis-48 flex-col'>
                                <span className='truncate text-sm font-semibold'>
                                    {admin.name}
                                    {admin.userId === me && (
                                        <span className='font-normal text-[var(--text-3)]'> ({t('you')})</span>
                                    )}
                                </span>
                                <span className='truncate text-xs text-[var(--text-3)]'>{admin.email}</span>
                            </div>
                            {confirm === admin.userId ? (
                                <button
                                    type='button'
                                    disabled={busy}
                                    className={DANGER}
                                    onClick={() =>
                                        void change(
                                            'admin/superadmins/' + admin.userId,
                                            'DELETE',
                                            undefined,
                                            t('saved')
                                        )
                                    }
                                >
                                    {t('removeConfirm')}
                                </button>
                            ) : (
                                <button
                                    type='button'
                                    disabled={busy}
                                    className={SECONDARY}
                                    onClick={() => setConfirm(admin.userId)}
                                >
                                    {t('revoke')}
                                </button>
                            )}
                        </li>
                    ))}
                </ul>
                <form onSubmit={grant} className='flex flex-wrap gap-2.5'>
                    <input
                        name='email'
                        type='email'
                        required
                        maxLength={254}
                        placeholder={t('email')}
                        aria-label={t('email')}
                        className={INPUT + ' min-w-56 flex-1'}
                    />
                    <button type='submit' disabled={busy} className={BUTTON}>
                        {t('addSuperadmin')}
                    </button>
                </form>
            </div>
        </section>
    )
}
