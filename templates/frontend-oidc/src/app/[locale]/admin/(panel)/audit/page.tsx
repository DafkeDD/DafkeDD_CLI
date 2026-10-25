import { Suspense } from 'react'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { AuditLog } from '@/components/audit'

/** The audit log of the whole platform (GET /admin/audit). */
export default async function AdminAuditPage({ params }: { params: Promise<{ locale: string }> }) {
    setRequestLocale((await params).locale)
    return (
        <Suspense fallback={null}>
            <Content />
        </Suspense>
    )
}

async function Content() {
    const t = await getTranslations('Portal.Activity')
    return (
        <div className='fade-in content-wide'>
            <div className='page-head'>
                <div className='ph-text'>
                    <h1>{t('platformTitle')}</h1>
                    <p>{t('platformSubtitle')}</p>
                </div>
            </div>
            <AuditLog scope='platform' />
        </div>
    )
}
