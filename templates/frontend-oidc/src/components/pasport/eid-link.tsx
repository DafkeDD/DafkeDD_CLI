'use client'

import { EidLink } from '@/components/security'

/** The eID screen of the shell, step 2: reads the eID and links it here (the same flow as /security). */
export function EidLinkStep({ onLinked }: { onLinked: () => void; accountUrl?: string; app?: string }) {
    return <EidLink onLinked={onLinked} />
}
