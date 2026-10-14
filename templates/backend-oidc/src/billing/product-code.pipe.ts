import { HttpStatus, Injectable, type PipeTransform } from '@nestjs/common'
import { AppException } from '../common/app.exception.js'
import { PRODUCT_CODE } from './billing.dto.js'

/** A product code in the URL: lowercase letters, digits and dashes; anything else is "not found". */
@Injectable()
export class ProductCodePipe implements PipeTransform<string, string> {
    transform(value: string) {
        if (!PRODUCT_CODE.test(value)) throw new AppException('billing.PRODUCT_NOT_FOUND', HttpStatus.NOT_FOUND)
        return value
    }
}
