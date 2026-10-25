import { formatMoney, invoicePdf } from './invoice-pdf.js'
import type { Invoice } from './invoices.store.js'
import { PdfPage, textWidth, winAnsi, wrap } from './pdf.js'

const invoice: Invoice = {
    id: 'i',
    number: 'FAC-2026-0007',
    tenantId: 't',
    paymentId: 'tr_1',
    settledBy: null,
    subscriptionId: 's',
    productCode: 'planner',
    productName: 'Planner',
    description: 'subscription',
    period: 'year',
    seats: 3,
    vatPercent: 21,
    amountCents: 30000,
    vatCents: 6300,
    totalCents: 36300,
    status: 'paid',
    checkoutUrl: null,
    issuedAt: new Date('2026-03-01T10:00:00Z'),
    paidAt: new Date('2026-03-02T10:00:00Z'),
    tenantName: 'Huisartsenpraktijk De Linde',
    company: 'De Linde BV',
    vat: 'BE0123456789',
    billingAddress: 'Kerkstraat 1\n9000 Gent',
    billingEmail: 'boekhouding@delinde.be'
}

/** The text of the content stream, decoded from the hex strings (WinAnsi). */
function shownText(pdf: Buffer) {
    return [...pdf.toString('latin1').matchAll(/<([0-9a-f]+)> Tj/g)]
        .map(match => Buffer.from(match[1] ?? '', 'hex').toString('latin1'))
        .join('\n')
}

describe('PDF writer', () => {
    it('encodes text as WinAnsi: accents and the euro sign work, the rest becomes ?', () => {
        expect(winAnsi('€ é ü ß – “x”')).toEqual([0x80, 32, 0xe9, 32, 0xfc, 32, 0xdf, 32, 0x96, 32, 0x93, 0x78, 0x94])
        expect(winAnsi('1 234 €')).toEqual([0x31, 32, 0x32, 0x33, 0x34, 32, 0x80])
        expect(winAnsi('漢')).toEqual([63])
    })

    it('measures and wraps text with the Helvetica metrics', () => {
        expect(textWidth('0000', 10)).toBeCloseTo(22.24)
        expect(textWidth('W', 10, 'bold')).toBeCloseTo(9.44)
        expect(textWidth('é', 10)).toBe(textWidth('e', 10))
        expect(wrap('one two three four', textWidth('three four', 10), 10)).toEqual(['one two', 'three four'])
        expect(wrap('one two three four', textWidth('one', 10), 10)).toEqual(['one', 'two', 'three', 'four'])
        expect(wrap('a\nb', 100, 10)).toEqual(['a', 'b'])
    })

    it('writes a valid file: every object and the cross-reference table at their offsets', () => {
        const page = new PdfPage()
        page.text(50, 800, 'Hello', { font: 'bold', align: 'right' })
        page.line(50, 790, 500, 790)
        page.rect(50, 700, 100, 20, [0, 0, 0])
        const pdf = page.build({ title: 'Factuur' })
        const text = pdf.toString('latin1')
        expect(text.startsWith('%PDF-1.4')).toBe(true)
        expect(text.trimEnd().endsWith('%%EOF')).toBe(true)
        const start = Number(/startxref\n(\d+)/.exec(text)?.[1])
        expect(text.slice(start, start + 4)).toBe('xref')
        const offsets = [...text.slice(start).matchAll(/^(\d{10}) 00000 n $/gm)].map(match => Number(match[1]))
        expect(offsets).toHaveLength(7)
        offsets.forEach((offset, index) => expect(text.slice(offset).startsWith(`${index + 1} 0 obj`)).toBe(true))
        expect(text).toContain('/BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding')
        const length = Number(/\/Length (\d+) >>\nstream\n/.exec(text)?.[1])
        const content = text.indexOf('stream\n') + 'stream\n'.length
        expect(text.slice(content + length, content + length + 10)).toBe('\nendstream')
    })
})

describe('the invoice PDF', () => {
    const t = (key: string, args?: Record<string, string>) =>
        key.replace('invoices.', '') + (args ? ' ' + Object.values(args).join(' ') : '')
    const seller = {
        name: 'Pasport',
        address: ['Dorpsstraat 2', '2000 Antwerpen'],
        vat: 'BE0999999999',
        email: null,
        iban: null
    }

    it('shows the seller, the buyer as it was, the line, the VAT, the total and the status', () => {
        const text = shownText(invoicePdf(invoice, seller, t, 'nl'))
        for (const part of [
            'Pasport',
            'PDF_TITLE',
            'FAC-2026-0007',
            'PDF_STATUS_paid',
            'De Linde BV',
            'Huisartsenpraktijk De Linde',
            'Kerkstraat 1',
            '9000 Gent',
            'PDF_VAT_NUMBER BE0123456789',
            'Planner',
            'PDF_SEATS 3',
            'PDF_VAT 21',
            '\x80 300,00',
            '\x80 63,00',
            '\x80 363,00'
        ])
            expect(text).toContain(part)
    })

    it('formats money in the language of the reader', () => {
        const plain = (text: string) => text.replace(/\s/g, ' ')
        expect(plain(formatMoney(123456, 'nl'))).toBe('€ 1.234,56')
        expect(plain(formatMoney(123456, 'en'))).toBe('€1,234.56')
        expect(winAnsi(formatMoney(123456, 'fr'))).toEqual(winAnsi('1 234,56 €'))
    })
})
