import { getTranslations } from 'next-intl/server'
import { BUTTON, CARD, LINK } from '@/components/account-ui'
import { Link } from '@/i18n/navigation'
import { getSession } from '@/lib/session'

// The login link is a small GET form: /api/auth/login is a route handler that needs a full page load.
/** Home page: "Log in", or who is logged in, in which organisation, with a link to the profile. */
export async function SessionLinks() {
    const t = await getTranslations('Oidc')
    const session = await getSession()

    return (
        <section className={CARD}>
            {session ? (
                <div className='flex flex-wrap items-center justify-between gap-3 text-sm'>
                    <span>
                        {t('signedInAs', { name: session.name || session.email })} ·{' '}
                        {session.tenant?.name ?? t('platformTitle')}
                    </span>
                    <Link href='/profile' className={LINK}>
                        {t('profile')}
                    </Link>
                </div>
            ) : (
                <div className='flex flex-wrap items-center justify-between gap-3 text-sm'>
                    <span>{t('startText')}</span>
                    <form action='/api/auth/login' method='get'>
                        <button type='submit' className={BUTTON}>
                            {t('signIn')}
                        </button>
                    </form>
                </div>
            )}
        </section>
    )
}
