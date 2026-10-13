import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { getSession } from '@/lib/session'

// The login link is a small GET form: /api/auth/login is a route handler that needs a full page load.
/** Home page: "Log in", or who is logged in, in which organisation, with a link to the profile. */
export async function SessionLinks() {
    const t = await getTranslations('Oidc')
    const session = await getSession()

    return (
        <div className='relative flex flex-wrap items-center justify-center gap-3 text-sm'>
            {session ? (
                <>
                    <span>
                        {t('signedInAs', { name: session.name || session.email })} ·{' '}
                        {session.tenant?.name ?? t('platformTitle')}
                    </span>
                    <Link href='/profile' className='font-semibold underline'>
                        {t('profile')}
                    </Link>
                </>
            ) : (
                <form action='/api/auth/login' method='get'>
                    <button type='submit' className='cursor-pointer font-semibold underline'>
                        {t('signIn')}
                    </button>
                </form>
            )}
        </div>
    )
}
