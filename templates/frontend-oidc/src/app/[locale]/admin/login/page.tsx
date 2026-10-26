import { redirect } from 'next/navigation'

/**
 * One login screen for everybody: /admin/login (an old link) is /login, back to the platform afterwards. A superadmin
 * chooses "Platform management" after the login, or one of its organisations.
 */
export default function AdminLoginPage() {
    redirect('/login?returnTo=%2Fadmin')
}
