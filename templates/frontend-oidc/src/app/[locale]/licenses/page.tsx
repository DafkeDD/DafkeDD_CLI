import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Notice, WIDE_CARD } from '@/components/account-ui'
import { AppPage } from '@/components/shell/app-shell'
import { Licenses } from '@/components/licenses'
import { getSession } from '@/lib/session'

/** The licences of the current organisation: for its admins (and superadmins, who can also give free seats). */
export default async function LicensesPage({ params }: { params: Promise<{ locale: string }> }) {
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
    if (!session) redirect('/api/auth/login?returnTo=/licenses')
    // A superadmin on the platform (no organisation): opening one is done on the platform page
    if (!session.tenant && session.superadmin) redirect('/admin')
    if (session.tenant?.role !== 'admin') {
        const t = await getTranslations('Licenses')
        return (
            <section className={WIDE_CARD}>
                <Notice tone='error'>{t('noAccess')}</Notice>
            </section>
        )
    }
    return <Licenses superadmin={session.superadmin} tenantId={session.tenant.id} />
}
