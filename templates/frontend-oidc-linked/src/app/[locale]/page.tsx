import { Suspense } from 'react'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { ApiStatus } from '@/components/api-status'
import { AppLicense } from '@/components/app-license'
import { Notes } from '@/components/notes'
import { SessionLinks } from '@/components/session-links'
import { AppPage } from '@/components/shell/app-shell'
import { PageHeader } from '@/components/ui'
import { getSession } from '@/lib/session'

/**
 * The home page of this app, in the shell of the login server it is linked to: who is logged in, the licence for the
 * product of this app, the notes of the organisation (the API and database of this app) and the status of that API.
 */
export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
    const { locale } = await params
    setRequestLocale(locale)
    const t = await getTranslations('HomePage')

    return (
        <AppPage>
            <PageHeader title={t('title')} description={t('description')} />
            <div className='flex flex-col gap-4'>
                <Suspense fallback={null}>
                    <SessionLinks />
                    <OrganisationNotes />
                </Suspense>
                <ApiStatus />
            </div>
        </AppPage>
    )
}

/** The licence and the notes, for whoever is logged in with an organisation (the notes only with a licence). */
async function OrganisationNotes() {
    const session = await getSession()
    if (!session?.tenant) return null
    const admin = session.tenant.role === 'admin' || session.superadmin
    const license = session.license ?? null
    return (
        <>
            {license && <AppLicense license={license} admin={admin} />}
            {license?.status !== 'none' && <Notes admin={admin} me={session.sub} />}
        </>
    )
}
