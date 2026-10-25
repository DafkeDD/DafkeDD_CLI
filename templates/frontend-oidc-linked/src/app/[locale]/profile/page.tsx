import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server'
import { AskDemo } from '@/components/ask-demo'
import { Profile } from '@/components/pasport/profile'
import { Badge } from '@/components/pasport/ui'
import { AppPage } from '@/components/shell/app-shell'
import { PASPORT_API_URL } from '@/lib/pasport'
import { getSession } from '@/lib/session'

/**
 * Protected page: the own profile (name, email, phone, language, the billing details of the organisation and what the
 * eID says; GET and PATCH /me/profile) and the licences of the user in this organisation. The same page in every app.
 */
export default async function ProfilePage({ params }: { params: Promise<{ locale: string }> }) {
    const { locale } = await params
    setRequestLocale(locale)

    return (
        <AppPage>
            {/* The session cookie is only known per request: render that part when the request comes in */}
            <Suspense fallback={null}>
                <Content />
            </Suspense>
        </AppPage>
    )
}

async function Content() {
    const session = await getSession()
    // Not logged in (or the access token expired): log in again. With an open session of the OIDC server this needs no password.
    if (!session) redirect('/api/auth/login?returnTo=/profile')

    const format = await getFormatter()
    const licenses = session.tenant ? await myLicenses(session.accessToken) : []
    const l = await getTranslations('Licenses')
    return (
        <>
            <Profile />
            <div style={{ maxWidth: 760, margin: '20px auto 0' }}>
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
                                                  date: format.dateTime(new Date(license.endsAt), {
                                                      dateStyle: 'medium'
                                                  })
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
        </>
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
