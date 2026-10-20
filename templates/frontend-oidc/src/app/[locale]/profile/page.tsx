import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server'
import { BUTTON, CARD, LINK, roleLabel } from '@/components/account-ui'
import { AppPage } from '@/components/shell/app-shell'
import { PASPORT_API_URL } from '@/lib/pasport'
import { ACCOUNT_URL, userinfo } from '@/lib/oidc'
import { getSession } from '@/lib/session'

/**
 * Protected page: the logged in user, the organisation (tenant) and whether the API accepts the access token.
 * The same page in every app: in an app linked to this login server the links go to these pages (OIDC_ACCOUNT_URL).
 */
export default async function ProfilePage({ params }: { params: Promise<{ locale: string }> }) {
    const { locale } = await params
    setRequestLocale(locale)

    return (
        <AppPage>
            {/* The session cookie is only known per request: render that part when the request comes in */}
            <Suspense fallback={null}>
                <Profile />
            </Suspense>
        </AppPage>
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
        <section className={CARD + ' max-w-xl'}>
            <h1 className='text-xl font-semibold tracking-tight'>{t('profileTitle')}</h1>
            <dl className='flex flex-col gap-3 text-sm'>
                {rows.map(([label, value]) => (
                    <div key={label} className='flex flex-col gap-0.5'>
                        <dt className='text-xs text-[var(--text-3)]'>{label}</dt>
                        <dd className='font-medium'>{value}</dd>
                    </div>
                ))}
            </dl>
            <div className='flex flex-wrap gap-4 text-sm'>
                <a href={ACCOUNT_URL + '/security'} className={LINK}>
                    {t('securityTitle')}
                </a>
                {session.tenant?.role === 'admin' && (
                    <a href={ACCOUNT_URL + '/members'} className={LINK}>
                        {t('manageMembers')}
                    </a>
                )}
                {session.superadmin && (
                    <a href={ACCOUNT_URL + '/admin'} className={LINK}>
                        {t('platformTitle')}
                    </a>
                )}
            </div>
            <div className={api ? 'text-sm text-[var(--green)]' : 'text-sm text-[var(--red)]'}>
                {api ? t('apiCheck') : t('apiFailed')}
            </div>
            {licenses.length > 0 && (
                <div className='flex flex-col gap-1.5 text-sm'>
                    <h2 className='text-base font-semibold'>{l('myLicenses')}</h2>
                    <ul className='flex flex-col gap-1'>
                        {licenses.map(license => (
                            <li key={license.code}>
                                <span className='font-medium'>{license.name}</span> ·{' '}
                                <span className={license.access ? 'text-[var(--green)]' : 'text-[var(--text-3)]'}>
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
                <button type='submit' className={BUTTON + ' w-full'}>
                    {t('logout')}
                </button>
            </form>
        </section>
    )
}

type MyLicense = { code: string; name: string; access: boolean; via?: 'trial' | 'seat' | 'superadmin'; endsAt?: string }

/** The products of the user in this organisation (GET /me/licenses of the API). */
async function myLicenses(accessToken: string): Promise<MyLicense[]> {
    const response = await fetch(PASPORT_API_URL + '/me/licenses', {
        headers: { Authorization: 'Bearer ' + accessToken, Accept: 'application/json' },
        cache: 'no-store'
    }).catch(() => null)
    return response?.ok ? ((await response.json()) as MyLicense[]) : []
}
