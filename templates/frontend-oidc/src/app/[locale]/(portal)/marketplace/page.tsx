import { Suspense } from 'react'
import { Marketplace } from '@/components/pasport/customer/marketplace'

export default function MarketplacePage() {
    return (
        <Suspense fallback={null}>
            <Marketplace />
        </Suspense>
    )
}
