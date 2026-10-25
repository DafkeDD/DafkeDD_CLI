import { Suspense } from 'react'
import { TenantDetail } from '@/components/pasport/admin/tenants'

export default function TenantPage({ params }: { params: Promise<{ id: string }> }) {
    return (
        <Suspense fallback={null}>
            <Content params={params} />
        </Suspense>
    )
}

async function Content({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    return <TenantDetail tenantId={id} />
}
