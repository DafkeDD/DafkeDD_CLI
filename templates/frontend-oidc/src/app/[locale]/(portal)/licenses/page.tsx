import { redirect } from 'next/navigation'

/** Licences are assigned on "Gebruikers" and bought in "Ontdek apps" now. */
export default function LicensesPage() {
    redirect('/users')
}
