import { Suspense } from 'react'
import { setRequestLocale } from 'next-intl/server'
import { StartLogin } from '@/components/shell/start-login'

/** /admin/login: the same login server, shown in the dark superadmin style; afterwards the platform (/admin). */
export default async function AdminLoginPage({
    params,
    searchParams
}: {
    params: Promise<{ locale: string }>
    searchParams: Promise<{ error?: string }>
}) {
    setRequestLocale((await params).locale)
    return (
        <Suspense fallback={null}>
            <Content searchParams={searchParams} />
        </Suspense>
    )
}

async function Content({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
    const { error } = await searchParams
    return <StartLogin admin error={error} />
}
