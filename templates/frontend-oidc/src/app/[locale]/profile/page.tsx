import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server'
import { roleLabel } from '@/components/account-ui'
import { AskDemo } from '@/components/ask-demo'
import { PageHead } from '@/components/pasport/page-head'
import { Avatar, Badge } from '@/components/pasport/ui'
import { AppPage } from '@/components/shell/app-shell'
import { PASPORT_API_URL } from '@/lib/pasport'
import { userinfo } from '@/lib/oidc'
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

    const pages = await getTranslations('Pages')
    return (
        <div className='fade-in' style={{ maxWidth: 760, margin: '0 auto' }}>
            <PageHead title={t('profileTitle')} text={pages('profileText')} />
            <div
                className='card card-pad'
                style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 18, marginBottom: 20 }}
            >
                <Avatar name={session.name || session.email} size={62} />
                <div style={{ flex: '1 1 180px', minWidth: 0 }}>
                    <div style={{ fontSize: 19, fontWeight: 650, letterSpacing: '-0.02em' }}>
                        {session.name || session.email}
                    </div>
                    <div className='t-muted' style={{ fontSize: 14 }}>
                        {session.email}
                    </div>
                </div>
                <Badge tone={api ? 'green' : 'red'} icon={api ? 'check' : 'alert'}>
                    {api ? t('apiCheck') : t('apiFailed')}
                </Badge>
            </div>
            <div className='card card-pad' style={{ marginBottom: 20 }}>
                <div className='t-eyebrow' style={{ marginBottom: 14 }}>
                    {pages('profileDetails')}
                </div>
                <dl className='detail-grid'>
                    {rows.map(([label, value]) => (
                        <div key={label} className='detail-cell'>
                            <dt className='dc-label'>{label}</dt>
                            <dd className='dc-value'>{value}</dd>
                        </div>
                    ))}
                </dl>
            </div>
            {licenses.length > 0 && (
                <div className='card card-pad'>
                    <div className='t-eyebrow' style={{ marginBottom: 14 }}>
                        {l('myLicenses')}
                    </div>
                    <ul style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {licenses.map(license => (
                            <li
                                key={license.code}
                                style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}
                            >
                                <span style={{ fontWeight: 600 }}>{license.name}</span>
                                <Badge tone={license.access ? 'green' : 'neutral'}>
                                    {license.via === 'trial' && license.endsAt
                                        ? l('trialUntil', {
                                              date: format.dateTime(new Date(license.endsAt), { dateStyle: 'medium' })
                                          })
                                        : license.access
                                          ? l('licensed')
                                          : l('noLicense')}
                                </Badge>
                                {/* No licence: ask a demo (once per product; it never starts by itself) */}
                                {!license.access && <AskDemo code={license.code} />}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
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
