import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Notice, Page, WIDE_CARD } from '@/components/account-ui'
import { Platform } from '@/components/platform'
import { getSession } from '@/lib/session'

/** The platform: every organisation and the superadmins. Only for superadmins. */
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
    return <Platform me={session.sub} />
}
