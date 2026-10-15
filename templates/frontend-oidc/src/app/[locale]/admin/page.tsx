import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Notice, Page, WIDE_CARD } from '@/components/account-ui'
import { Apps } from '@/components/apps'
import { BillingAdmin } from '@/components/billing-admin'
import { Platform } from '@/components/platform'
import { getSession } from '@/lib/session'

/**
 * The platform: every organisation, the superadmins, the products and the discount codes, and the apps that may log in.
 * Only for superadmins.
 */
export default async function AdminPage({ params }: { params: Promise<{ locale: string }> }) {
    setRequestLocale((await params).locale)
    return (
        <Page wide>
            <Suspense fallback={null}>
                <Content />
            </Suspense>
        </Page>
    )
}

async function Content() {
    const session = await getSession()
    if (!session) redirect('/api/auth/login?returnTo=/admin')
    if (!session.superadmin) {
        const t = await getTranslations('Oidc')
        return (
            <section className={WIDE_CARD}>
                <Notice tone='error'>{t('onlySuperadmins')}</Notice>
            </section>
        )
    }
    return (
        <div className='flex w-full max-w-3xl flex-col gap-6'>
            <Platform me={session.sub} />
            <BillingAdmin />
            <Apps />
        </div>
    )
}
