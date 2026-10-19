import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Notice, SECONDARY, WIDE_CARD } from '@/components/account-ui'
import { AppPage } from '@/components/shell/app-shell'
import { AuditLog } from '@/components/audit'
import { Link } from '@/i18n/navigation'
import { getSession } from '@/lib/session'

const ACTIVE = SECONDARY + ' border-[var(--accent-border)]! bg-[var(--accent-tint)]! text-[var(--accent-active)]!'

/**
 * The audit log. Admins: their organisation (GET /tenants/current/audit). Superadmins: also the whole platform
 * (/audit?scope=platform, GET /admin/audit); after a platform login (no organisation) that is the only one.
 */
export default async function AuditPage({
    params,
    searchParams
}: {
    params: Promise<{ locale: string }>
    searchParams: Promise<{ scope?: string }>
}) {
    setRequestLocale((await params).locale)
    return (
        <AppPage wide>
            <Suspense fallback={null}>
                <Content searchParams={searchParams} />
            </Suspense>
        </AppPage>
    )
}

async function Content({ searchParams }: { searchParams: Promise<{ scope?: string }> }) {
    const session = await getSession()
    const { scope } = await searchParams
    if (!session) redirect('/api/auth/login?returnTo=/audit' + (scope === 'platform' ? '%3Fscope%3Dplatform' : ''))
    const platform = session.superadmin && (scope === 'platform' || !session.tenant)
    if (!platform && session.tenant?.role !== 'admin') {
        const t = await getTranslations('Audit')
        return (
            <section className={WIDE_CARD}>
                <Notice tone='error'>{t('noAccess')}</Notice>
            </section>
        )
    }
    const t = await getTranslations('Audit')
    // A superadmin in an organisation: its log, or the one of the whole platform
    const both = session.superadmin && session.tenant?.role === 'admin'
    return (
        <div className='flex w-full flex-col gap-4'>
            {both && (
                <nav className='flex gap-2 text-sm'>
                    <Link
                        href='/audit'
                        aria-current={platform ? undefined : 'page'}
                        className={platform ? SECONDARY : ACTIVE}
                    >
                        {session.tenant?.name}
                    </Link>
                    <Link
                        href='/audit?scope=platform'
                        aria-current={platform ? 'page' : undefined}
                        className={platform ? ACTIVE : SECONDARY}
                    >
                        {t('categories.platform')}
                    </Link>
                </nav>
            )}
            <AuditLog key={platform ? 'platform' : 'tenant'} scope={platform ? 'platform' : 'tenant'} />
        </div>
    )
}
