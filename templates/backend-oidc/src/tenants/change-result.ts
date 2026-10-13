import { HttpStatus } from '@nestjs/common'
import { AppException } from '../common/app.exception.js'
import type { ChangeResult } from '../oidc/store/oidc.store.js'

/** Turns the result of a store change into a translated error, or nothing when it went fine. */
export function assertChanged(result: ChangeResult, notFound: string, last: string): void {
    if (result === 'not-found') throw new AppException(notFound, HttpStatus.NOT_FOUND)
    if (result === 'last-admin') throw new AppException(last, HttpStatus.CONFLICT)
}
