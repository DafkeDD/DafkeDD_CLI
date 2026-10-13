import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Notice, Page, WIDE_CARD } from '@/components/account-ui'
import { Members } from '@/components/members'
import { getSession } from '@/lib/session'

/** Members of the current organisation: for its admins (and superadmins). */
export default async function MembersPage({ params }: { params: Promise<{ locale: string }> }) {
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
    if (!session) redirect('/api/auth/login?returnTo=/members')
    if (session.tenant?.role !== 'admin') {
        const t = await getTranslations('Oidc')
        return (
            <section className={WIDE_CARD}>
                {/* A superadmin without an organisation chooses one on the platform page */}
                <Notice tone='error'>{session.tenant ? t('noAccess') : t('chooseOrganisation')}</Notice>
            </section>
        )
    }
    return <Members tenantName={session.tenant.name} me={session.sub} superadmin={session.superadmin} />
}
