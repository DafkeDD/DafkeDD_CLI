'use client'

import type { NavItem, ShellAccount } from '@/components/pasport/shell'

/** The logged in account in the topbar of the shell: this project has no login (see the README to add one). */
export function useAccount(): { account: ShellAccount | null; menu: NavItem[] } {
    return { account: null, menu: [] }
}
