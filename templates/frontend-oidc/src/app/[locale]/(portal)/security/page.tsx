import { Suspense } from 'react'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { AuditLog } from '@/components/audit'
import { EidBackBanner } from '@/components/pasport/eid-required'
import { PasswordCard } from '@/components/pasport/password-card'
import { ConsentsSecurity } from '@/components/consents'
import { PasskeysSecurity } from '@/components/passkeys'
import { EidSecurity, Security, SessionsSecurity } from '@/components/security'

/**
 * Two-step verification, passkeys, the eID, the sessions, the allowed applications and the recent activity of the own
 * account (/me/mfa, /me/passkeys, /me/eid, /me/sessions, /me/consents and /me/audit via /api/backend).
 */
export default async function SecurityPage({ params }: { params: Promise<{ locale: string }> }) {
    setRequestLocale((await params).locale)
    return (
        <Suspense fallback={null}>
            <Content />
        </Suspense>
    )
}

async function Content() {
    const t = await getTranslations('Portal.Security')
    return (
        <div className='fade-in' style={{ maxWidth: 980, margin: '0 auto' }}>
            <div className='page-head'>
                <div className='ph-text'>
                    <h1>{t('title')}</h1>
                    <p>{t('subtitle')}</p>
                </div>
            </div>
            <EidBackBanner />
            <div className='security-grid'>
                <PasswordCard />
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
