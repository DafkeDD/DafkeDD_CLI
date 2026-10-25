import { Body, Controller, Get, Patch } from '@nestjs/common'
import { ApiConflictResponse, ApiOkResponse, ApiOperation, ApiTags, ApiTooManyRequestsResponse } from '@nestjs/swagger'
import { I18n, I18nContext } from 'nestjs-i18n'
import { Access, Auth, type AuthContext, EidOptional } from '../access/access.js'
import { UpdateProfileDto } from './profile.dto.js'
import { ProfileService } from './profile.service.js'

const PROFILE =
    '{ id, name, firstName, lastName, email, emailVerified, pendingEmail, phone, locale, superadmin, ' +
    'eid: { linked, rrn: "YY.MM.DD-XXX.XX" | null, address }, tenant: { id, name, slug, role, profession } | null }'

/** The own profile of the logged in account. */
@ApiTags('account')
@Controller('me/profile')
@Access('account')
export class ProfileController {
    constructor(private readonly profiles: ProfileService) {}

    @Get()
    // Also without a linked eID (OIDC_EID_REQUIRED): the portal reads it before it shows the eID screen
    @EidOptional()
    @ApiOperation({
        summary:
            'My profile: name, email (and a new one waiting for confirmation), phone, language, what my eID says, and my role and profession in the organisation of the token'
    })
    @ApiOkResponse({ description: PROFILE })
    profile(@Auth() auth: AuthContext) {
        return this.profiles.profile(auth)
    }

    @Patch()
    @ApiOperation({
        summary:
            'Change my profile. A new email address only changes after the link sent to it was opened (POST /oidc/account/verify-email). The national register number and the address come from the eID (read-only).'
    })
    @ApiOkResponse({ description: PROFILE })
    @ApiConflictResponse({ description: 'oidc.EMAIL_TAKEN: another account has this email address' })
    @ApiTooManyRequestsResponse({ description: 'oidc.TOO_MANY_ATTEMPTS (email changes)' })
    update(@Auth() auth: AuthContext, @Body() body: UpdateProfileDto, @I18n() i18n: I18nContext) {
        return this.profiles.update(auth, body, i18n.lang)
    }
}
