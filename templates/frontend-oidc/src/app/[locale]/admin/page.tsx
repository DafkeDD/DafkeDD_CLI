import { Suspense } from 'react'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Notice } from '@/components/account-ui'
import { Platform } from '@/components/platform'
import { PageHead } from '@/components/pasport/page-head'
import { AppPage } from '@/components/shell/app-shell'
import { getSession } from '@/lib/session'

/** /admin: the platform: every organisation and the superadmins. Only for superadmins. */
export default async function AdminPage({ params }: { params: Promise<{ locale: string }> }) {
    setRequestLocale((await params).locale)
    return (
        <AppPage wide admin>
            <Suspense fallback={null}>
                <Content />
            </Suspense>
        </AppPage>
    )
}

async function Content() {
    const session = await getSession()
    if (!session?.superadmin) {
        const o = await getTranslations('Oidc')
        return <Notice tone='error'>{o('onlySuperadmins')}</Notice>
    }
    const t = await getTranslations('Pages')
    return (
        <>
            <PageHead title={t('platformTitle')} text={t('platformText')} />
            <Platform me={session.sub} />
        </>
    )
}
