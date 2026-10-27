import { Injectable } from '@nestjs/common'

/**
 * The `license` claim in the tokens of an app that sells a product: whether the user may use it in the organisation of
 * the token. `trial`: the trial runs (until `ends_at`, seconds since 1970); `seat`: one of the seats of the
 * organisation; `superadmin`: always; `none`: no licence (the app refuses its data, the user buys one on /licenses).
 */
export interface LicenseClaim {
    product: string
    status: 'trial' | 'seat' | 'superadmin' | 'none'
    ends_at?: number
}

/** What the licences part (src/billing) answers for the OpenID Connect part. */
export interface LicenseSource {
    productExists(code: string): Promise<boolean>
    claim(tenantId: string | null, userId: string, code: string, superadmin: boolean): Promise<LicenseClaim>
    /** Gives a member one of the free seats of the product (an accepted invitation); false when none is free. */
    assign(actor: { tenantId: string; userId: string }, code: string, userId: string): Promise<boolean>
    /** May this member still ask a demo of the product (its demo is on, and the member never had one)? */
    demoAvailable(tenantId: string, userId: string, code: string): Promise<boolean>
    /** The member asks its demo (once per product); false when that is not possible. */
    requestDemo(tenantId: string, userId: string, code: string): Promise<boolean>
}

/**
 * Connects the apps (OpenID Connect clients) to the licences without a circular module dependency: the billing module
 * registers itself here when it starts. Without it no product exists and every claim is `none`.
 */
@Injectable()
export class AppLicenses {
    private source: LicenseSource | null = null

    register(source: LicenseSource) {
        this.source = source
    }

    productExists(code: string): Promise<boolean> {
        return this.source ? this.source.productExists(code) : Promise.resolve(false)
    }

    claim(tenantId: string | null, userId: string, code: string, superadmin: boolean): Promise<LicenseClaim> {
        return this.source
            ? this.source.claim(tenantId, userId, code, superadmin)
            : Promise.resolve({ product: code, status: 'none' })
    }

    assign(actor: { tenantId: string; userId: string }, code: string, userId: string): Promise<boolean> {
        return this.source ? this.source.assign(actor, code, userId) : Promise.resolve(false)
    }

    demoAvailable(tenantId: string, userId: string, code: string): Promise<boolean> {
        return this.source ? this.source.demoAvailable(tenantId, userId, code) : Promise.resolve(false)
    }

    requestDemo(tenantId: string, userId: string, code: string): Promise<boolean> {
        return this.source ? this.source.requestDemo(tenantId, userId, code) : Promise.resolve(false)
    }
}
