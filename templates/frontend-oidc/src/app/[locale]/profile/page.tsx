import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server'
import { LINK, roleLabel } from '@/components/account-ui'
import { Link } from '@/i18n/navigation'
import { API_URL } from '@/lib/api'
import { userinfo } from '@/lib/oidc'
import { getSession } from '@/lib/session'

const CARD =
    'flex w-full max-w-md flex-col gap-5 rounded-2xl border border-black/10 bg-black/[.03] p-6 text-left dark:border-white/15 dark:bg-white/[.04]'
const BUTTON =
    'inline-flex h-11 w-full items-center justify-center rounded-xl bg-[var(--accent,#171717)] px-5 text-sm font-semibold text-[var(--accent-fg,#ffffff)] dark:bg-[var(--accent,#ededed)] dark:text-[var(--accent-fg,#0a0a0a)]'

/** Protected page: the logged in user, the organisation (tenant) and whether the API accepts the access token. */
export default async function ProfilePage({ params }: { params: Promise<{ locale: string }> }) {
    const { locale } = await params
    setRequestLocale(locale)

    return (
        <main className='flex flex-1 flex-col items-center justify-center px-6 pt-10 pb-28'>
            {/* The session cookie is only known per request: render that part when the request comes in */}
            <Suspense fallback={null}>
                <Profile />
            </Suspense>
        </main>
    )
}

async function Profile() {
    const session = await getSession()
    // Not logged in (or the access token expired): log in again. With an open session of the OIDC server this needs no password.
    if (!session) redirect('/api/auth/login?returnTo=/profile')

    const t = await getTranslations('Oidc')
    const format = await getFormatter()
    const api = await userinfo(session.accessToken).catch(() => null)
    const licenses = session.tenant ? await myLicenses(session.accessToken) : []
    const l = await getTranslations('Licenses')
    const rows = [
        [t('name'), session.name],
        [t('email'), session.email],
        [t('organisation'), session.tenant?.name ?? t('platformTitle')],
        [
            t('role'),
            [session.tenant ? roleLabel(t, session.tenant.role) : null, session.superadmin ? t('superadmin') : null]
                .filter(Boolean)
                .join(' · ')
        ],
        [t('validUntil'), format.dateTime(new Date(session.expiresAt), { timeStyle: 'short' })]
    ]

    return (
        <section className={CARD}>
            <h1 className='text-2xl font-bold tracking-tight'>{t('profileTitle')}</h1>
            <dl className='flex flex-col gap-3 text-sm'>
                {rows.map(([label, value]) => (
                    <div key={label} className='flex flex-col gap-0.5'>
                        <dt className='text-xs opacity-70'>{label}</dt>
                        <dd className='font-medium'>{value}</dd>
                    </div>
                ))}
            </dl>
            <div className='flex flex-wrap gap-4 text-sm'>
                <Link href='/security' className={LINK}>
                    {t('securityTitle')}
                </Link>
                {session.tenant?.role === 'admin' && (
                    <Link href='/members' className={LINK}>
                        {t('manageMembers')}
                    </Link>
                )}
                {session.superadmin && (
                    <Link href='/admin' className={LINK}>
                        {t('platformTitle')}
                    </Link>
                )}
            </div>
            <div
                className={
                    api ? 'text-sm text-green-700 dark:text-green-400' : 'text-sm text-red-600 dark:text-red-400'
                }
            >
                {api ? t('apiCheck') : t('apiFailed')}
            </div>
            {licenses.length > 0 && (
                <div className='flex flex-col gap-1.5 text-sm'>
                    <h2 className='text-base font-semibold'>{l('myLicenses')}</h2>
                    <ul className='flex flex-col gap-1'>
                        {licenses.map(license => (
                            <li key={license.code}>
                                <span className='font-medium'>{license.name}</span> ·{' '}
                                <span className={license.access ? 'text-green-700 dark:text-green-400' : 'opacity-70'}>
                                    {license.via === 'trial' && license.endsAt
                                        ? l('trialUntil', {
                                              date: format.dateTime(new Date(license.endsAt), { dateStyle: 'medium' })
                                          })
                                        : license.access
                                          ? l('licensed')
                                          : l('noLicense')}
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            <form method='post' action='/api/auth/logout'>
                <button type='submit' className={BUTTON}>
                    {t('logout')}
                </button>
            </form>
        </section>
    )
}

type MyLicense = { code: string; name: string; access: boolean; via?: 'trial' | 'seat' | 'superadmin'; endsAt?: string }

/** The products of the user in this organisation (GET /me/licenses of the API). */
async function myLicenses(accessToken: string): Promise<MyLicense[]> {
    const response = await fetch(API_URL + '/me/licenses', {
        headers: { Authorization: 'Bearer ' + accessToken, Accept: 'application/json' },
        cache: 'no-store'
    }).catch(() => null)
    return response?.ok ? ((await response.json()) as MyLicense[]) : []
}
