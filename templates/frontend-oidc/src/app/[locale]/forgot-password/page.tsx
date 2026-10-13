import { setRequestLocale } from 'next-intl/server'
import { ForgotPassword } from '@/components/account-forms'
import { Page } from '@/components/account-ui'

/** Ask for a link to choose a new password (POST /oidc/account/forgot-password). */
export default async function ForgotPasswordPage({ params }: { params: Promise<{ locale: string }> }) {
    setRequestLocale((await params).locale)
    return (
        <Page>
            <ForgotPassword />
        </Page>
    )
}
