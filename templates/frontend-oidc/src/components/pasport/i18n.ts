'use client'

import { useTranslations } from 'next-intl'

export type T = (key: string, values?: Record<string, string | number | Date>) => string

/** The translations of one part of the portal (messages/portal/<locale>.json → Portal.<ns>). */
export function useT(ns: string): T {
    return useTranslations(`Portal.${ns}` as never) as unknown as T
}
