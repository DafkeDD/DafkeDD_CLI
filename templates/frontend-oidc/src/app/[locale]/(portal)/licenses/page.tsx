import { redirect } from 'next/navigation'

/** Licences are assigned on "Users" and bought in "Discover apps" now. */
export default function LicensesPage() {
    redirect('/users')
}
