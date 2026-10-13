import { setRequestLocale } from 'next-intl/server'
import { Register } from '@/components/account-forms'
import { Page } from '@/components/account-ui'

/** Create an account and a new organisation (POST /oidc/account/register). */
export default async function RegisterPage({ params }: { params: Promise<{ locale: string }> }) {
    setRequestLocale((await params).locale)
    return (
        <Page>
            <Register />
        </Page>
    )
}
