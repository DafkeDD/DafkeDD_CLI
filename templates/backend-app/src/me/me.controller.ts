import { Controller, Get } from '@nestjs/common'
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger'
import { Access, type Caller, CurrentCaller } from '../pasport/access.js'

/** Who is calling, as the access token of the login server says (nothing is looked up). */
@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
export class MeController {
    @Get()
    @Access('account')
    @ApiOperation({
        summary:
            'The caller: account id, organisation with role, superadmin and the licence for this app (from the access token)'
    })
    @ApiOkResponse({
        schema: {
            example: {
                sub: '1b2c3d4e-5f60-4718-8293-a4b5c6d7e8f9',
                tenant: { id: '0f9e8d7c-6b5a-4493-8271-605f4e3d2c1b', name: 'Praktijk De Linde', role: 'admin' },
                superadmin: false,
                license: { product: 'planner', status: 'trial', endsAt: '2026-11-03T08:00:00.000Z' }
            }
        }
    })
    @ApiUnauthorizedResponse({ description: 'errors.UNAUTHORIZED: no or no valid access token of the login server' })
    me(@CurrentCaller() caller: Caller) {
        return { sub: caller.sub, tenant: caller.tenant, superadmin: caller.superadmin, license: caller.license }
    }
}
