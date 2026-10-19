import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Notice, WIDE_CARD } from '@/components/account-ui'
import { AppPage } from '@/components/shell/app-shell'
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
        <AppPage wide>
            <Suspense fallback={null}>
                <Content />
            </Suspense>
        </AppPage>
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
        <div className='flex w-full flex-col gap-6'>
            <Platform me={session.sub} />
            <BillingAdmin />
            <Apps />
        </div>
    )
}
