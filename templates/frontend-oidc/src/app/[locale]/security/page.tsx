import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { setRequestLocale } from 'next-intl/server'
import { Page } from '@/components/account-ui'
import { EidSecurity, Security, SessionsSecurity } from '@/components/security'
import { getSession } from '@/lib/session'

/** Two-step verification, the eID and the sessions of the own account (/me/mfa, /me/eid, /me/sessions via /api/backend). */
export default async function SecurityPage({ params }: { params: Promise<{ locale: string }> }) {
    setRequestLocale((await params).locale)
    return (
        <Page>
            <Suspense fallback={null}>
                <Content />
            </Suspense>
        </Page>
    )
}

async function Content() {
    if (!(await getSession())) redirect('/api/auth/login?returnTo=/security')
    return (
        <div className='flex w-full max-w-sm flex-col gap-6'>
            <Security />
            <EidSecurity />
            <SessionsSecurity />
        </div>
    )
}
