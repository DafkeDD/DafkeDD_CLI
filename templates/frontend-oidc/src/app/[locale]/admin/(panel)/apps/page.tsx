import { redirect } from 'next/navigation'

/** The OIDC apps are part of the app catalogue now (tab "Connection", or an internal app): old links go there. */
export default async function AppsPage({ params }: { params: Promise<{ locale: string }> }) {
    redirect(`/${(await params).locale}/admin/catalog`)
}
