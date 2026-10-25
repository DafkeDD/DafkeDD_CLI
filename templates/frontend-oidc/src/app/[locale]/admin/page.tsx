import { redirect } from 'next/navigation'

// Pure redirect: there is no shell to prerender, so skip instant validation.
export const instant = false

/** /admin: the superadmin panel opens on the statistics. */
export default function AdminIndex() {
    redirect('/admin/stats')
}
