import { setRequestLocale } from 'next-intl/server'
import { ForgotPassword } from '@/components/account-forms'
import { AuthPage } from '@/components/shell/auth-screen'

/** Ask for a link to choose a new password (POST /oidc/account/forgot-password). */
export default async function ForgotPasswordPage({ params }: { params: Promise<{ locale: string }> }) {
    setRequestLocale((await params).locale)
    return (
        <AuthPage>
            <ForgotPassword />
        </AuthPage>
    )
}
