import type { ProductCatalog } from './store/billing.store.js'

/** The catalogue fields of a product as an admin sends them (all optional). */
export type CatalogInput = { [K in keyof ProductCatalog]?: ProductCatalog[K] | undefined }

/**
 * Cleans the catalogue fields that are given: texts trimmed, features trimmed without empty ones, an empty colour or
 * launch URL becomes null. Fields that are left out are left out (an update keeps them).
 */
export function cleanCatalog(input: CatalogInput): Partial<ProductCatalog> {
    const result: Partial<ProductCatalog> = {}
    if (input.icon !== undefined) result.icon = input.icon.trim()
    if (input.category !== undefined) result.category = input.category.trim()
    if (input.short !== undefined) result.short = input.short.trim()
    if (input.features !== undefined) result.features = input.features.map(feature => feature.trim()).filter(Boolean)
    if (input.color !== undefined) result.color = input.color?.trim().toLowerCase() || null
    if (input.requiresVault !== undefined) result.requiresVault = input.requiresVault
    if (input.demoEnabled !== undefined) result.demoEnabled = input.demoEnabled
    if (input.launchUrl !== undefined) result.launchUrl = input.launchUrl?.trim() || null
    if (input.sort !== undefined) result.sort = input.sort
    return result
}

/** The launch URL of an app for an organisation: {slug} becomes the slug of the organisation. */
export function launchUrlFor(template: string | null, slug: string): string | null {
    return template ? template.replaceAll('{slug}', encodeURIComponent(slug)) : null
}
