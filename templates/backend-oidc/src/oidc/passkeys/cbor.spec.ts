import { type Cbor, encodeCbor } from '../../../test/virtual-authenticator.js'
import { CborError, decodeCbor, decodeCborPrefix } from './cbor.js'

describe('decodeCbor', () => {
    it('reads numbers, text, bytes, arrays, maps and simple values', () => {
        const value = decodeCbor(
            encodeCbor(
                new Map<Cbor, Cbor>([
                    [1, 2],
                    [-7, 'text'],
                    ['bytes', Buffer.from([1, 2, 3])],
                    ['list', [1, 300, 70000, true, false]]
                ])
            )
        ) as Map<unknown, unknown>
        expect(value.get(1)).toBe(2)
        expect(value.get(-7)).toBe('text')
        expect(Buffer.from(value.get('bytes') as Uint8Array)).toEqual(Buffer.from([1, 2, 3]))
        expect(value.get('list')).toEqual([1, 300, 70000, true, false])
        expect(decodeCbor(Buffer.from([0xf6]))).toBeNull()
    })

    it('returns where the first item ends', () => {
        const data = Buffer.concat([Buffer.from([9, 9]), encodeCbor('abc'), Buffer.from([1])])
        expect(decodeCborPrefix(data, 2)).toEqual({ value: 'abc', offset: 6 })
    })

    it.each([
        ['trailing bytes', [0x01, 0x02]],
        ['truncated', [0x62, 0x61]],
        ['indefinite length', [0x5f, 0x41, 0x00, 0xff]],
        ['a tag', [0xc0, 0x01]],
        ['a float', [0xf9, 0x3c, 0x00]],
        ['a huge length', [0x5b, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]],
        ['empty', []]
    ])('refuses %s', (_name, bytes) => {
        expect(() => decodeCbor(Buffer.from(bytes))).toThrow(CborError)
    })

    it('refuses too deep nesting', () => {
        expect(() => decodeCbor(Buffer.from([...Array.from({ length: 40 }, () => 0x81), 0x01]))).toThrow(CborError)
    })

    it('refuses a duplicate map key', () => {
        expect(() => decodeCbor(Buffer.from([0xa2, 0x01, 0x01, 0x01, 0x02]))).toThrow(CborError)
    })
})
