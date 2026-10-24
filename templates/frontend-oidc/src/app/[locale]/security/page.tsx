import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { PageHead } from '@/components/pasport/page-head'
import { AppPage } from '@/components/shell/app-shell'
import { AuditLog } from '@/components/audit'
import { ConsentsSecurity } from '@/components/consents'
import { PasskeysSecurity } from '@/components/passkeys'
import { EidSecurity, Security, SessionsSecurity } from '@/components/security'
import { getSession } from '@/lib/session'

/**
 * Two-step verification, passkeys, the eID, the sessions, the allowed applications and the recent activity of the own
 * account (/me/mfa, /me/passkeys, /me/eid, /me/sessions, /me/consents and /me/audit via /api/backend).
 */
export default async function SecurityPage({ params }: { params: Promise<{ locale: string }> }) {
    setRequestLocale((await params).locale)
    return (
        <AppPage>
            <Suspense fallback={null}>
                <Content />
            </Suspense>
        </AppPage>
    )
}

async function Content() {
    if (!(await getSession())) redirect('/api/auth/login?returnTo=/security')
    const pg = await getTranslations('Pages')
    return (
        <div className='fade-in' style={{ maxWidth: 980, margin: '0 auto' }}>
            <PageHead title={pg('securityTitle')} text={pg('securityText')} />
            <div className='security-grid'>
                <Security />
                <PasskeysSecurity />
                <EidSecurity />
                <SessionsSecurity />
                <ConsentsSecurity />
            </div>
            <div style={{ marginTop: 18 }}>
                <AuditLog scope='me' />
            </div>
        </div>
    )
}
