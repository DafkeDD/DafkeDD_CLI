import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { setRequestLocale } from 'next-intl/server'
import { Page } from '@/components/account-ui'
import { Security } from '@/components/security'
import { getSession } from '@/lib/session'

/** Two-step verification of the own account (GET /me/mfa and friends, through /api/backend). */
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
    return <Security />
}
