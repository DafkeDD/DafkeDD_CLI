import { setRequestLocale } from 'next-intl/server'
import { Register } from '@/components/account-forms'

/** Create an account and a new organisation (POST /oidc/account/register). */
export default async function RegisterPage({ params }: { params: Promise<{ locale: string }> }) {
    setRequestLocale((await params).locale)
    return <Register />
}
