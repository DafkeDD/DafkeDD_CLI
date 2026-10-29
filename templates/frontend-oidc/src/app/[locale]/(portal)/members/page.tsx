import { redirect } from 'next/navigation'

/** The old members page is now "Users" in the portal. */
export default function MembersPage() {
    redirect('/users')
}
