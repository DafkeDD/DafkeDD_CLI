import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Notice, WIDE_CARD } from '@/components/account-ui'
import { AppPage } from '@/components/shell/app-shell'
import { Members } from '@/components/members'
import { getSession } from '@/lib/session'

/** Members of the current organisation: for its admins (and superadmins). */
export default async function MembersPage({ params }: { params: Promise<{ locale: string }> }) {
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
    if (!session) redirect('/api/auth/login?returnTo=/members')
    // A superadmin on the platform (no organisation): opening one is done on the platform page
    if (!session.tenant && session.superadmin) redirect('/admin')
    if (session.tenant?.role !== 'admin') {
        const t = await getTranslations('Oidc')
        return (
            <section className={WIDE_CARD}>
                <Notice tone='error'>{t('noAccess')}</Notice>
            </section>
        )
    }
    return <Members tenantName={session.tenant.name} me={session.sub} superadmin={session.superadmin} />
}
