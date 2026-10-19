import { Suspense } from 'react'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { SessionLinks } from '@/components/session-links'
import { AppPage } from '@/components/shell/app-shell'
import { PageHeader } from '@/components/ui'

/** The home page of this app, in the shell of the login server it is linked to: who is logged in. */
export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
    const { locale } = await params
    setRequestLocale(locale)
    const t = await getTranslations('HomePage')

    return (
        <AppPage>
            <PageHeader title={t('title')} description={t('description')} />
            <Suspense fallback={null}>
                <SessionLinks />
            </Suspense>
        </AppPage>
    )
}
