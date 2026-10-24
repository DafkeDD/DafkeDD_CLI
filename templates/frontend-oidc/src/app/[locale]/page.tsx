import { Suspense } from 'react'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { ApiStatus } from '@/components/api-status'
import { SessionLinks } from '@/components/session-links'
import { AppPage } from '@/components/shell/app-shell'
import { PageHead } from '@/components/pasport/page-head'

/** The home page of this app, in the shell: who is logged in, and the connection with the API. */
export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
    const { locale } = await params
    setRequestLocale(locale)
    const t = await getTranslations('HomePage')

    return (
        <AppPage>
            <PageHead title={t('title')} text={t('description')} />
            <div className='flex flex-col gap-4'>
                <Suspense fallback={null}>
                    <SessionLinks />
                </Suspense>
                <ApiStatus />
            </div>
        </AppPage>
    )
}
