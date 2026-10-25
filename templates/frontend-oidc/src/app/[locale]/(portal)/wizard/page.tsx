import { Suspense } from 'react'
import { PurchaseWizard } from '@/components/pasport/customer/wizard'

export default function WizardPage() {
    return (
        <Suspense fallback={null}>
            <PurchaseWizard />
        </Suspense>
    )
}
