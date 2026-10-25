import { Suspense } from 'react'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { AuditLog } from '@/components/audit'
import { ClientRedirect, Notice } from '@/components/pasport/page-state'
import { getSession } from '@/lib/session'

/** The activity (audit log) of the own organisation, for its admins (GET /tenants/current/audit). */
export default async function AuditPage({ params }: { params: Promise<{ locale: string }> }) {
    setRequestLocale((await params).locale)
    return (
        <Suspense fallback={null}>
            <Content />
        </Suspense>
    )
}

async function Content() {
    const session = await getSession()
    if (!session?.tenant && session?.superadmin) return <ClientRedirect to='/admin/audit' />
    const t = await getTranslations('Portal.Activity')
    if (session?.tenant?.role !== 'admin') return <Notice title={t('noAccess')} />
    return (
        <div className='fade-in content-wide'>
            <div className='page-head'>
                <div className='ph-text'>
                    <h1>{t('title')}</h1>
                    <p>{t('subtitle', { practice: session.tenant.name })}</p>
                </div>
            </div>
            <AuditLog scope='tenant' />
        </div>
    )
}
