import type { Invoice } from './invoices.store.js'
import { A4, type Color, PdfPage, textWidth, wrap } from './pdf.js'

/** Translates a key of src/i18n/<language>/invoices.json with its arguments. */
export type InvoiceTranslate = (key: string, args?: Record<string, string>) => string

/** Who sends the invoices (INVOICE_SELLER_* in .env). */
export interface Seller {
    name: string
    /** Lines of the address. */
    address: string[]
    vat: string | null
    email: string | null
    iban: string | null
}

const LOCALES: Record<string, string> = { nl: 'nl-BE', fr: 'fr-BE', de: 'de-BE', en: 'en-GB' }

const INK: Color = [0.09, 0.09, 0.09]
const MUTED: Color = [0.42, 0.42, 0.42]
const STATUS_COLORS: Record<Invoice['status'], Color> = {
    paid: [0.09, 0.5, 0.27],
    free: [0.09, 0.5, 0.27],
    open: [0.75, 0.4, 0.03],
    void: [0.6, 0.12, 0.12]
}

/** An amount in the language of the reader: € 1.234,56 (nl, fr, de) or €1,234.56 (en). */
export function formatMoney(cents: number, lang: string, currency = 'EUR') {
    return new Intl.NumberFormat(LOCALES[lang] ?? 'en-GB', { style: 'currency', currency }).format(cents / 100)
}

export function formatDate(date: Date, lang: string) {
    return new Intl.DateTimeFormat(LOCALES[lang] ?? 'en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'Europe/Brussels'
    }).format(date)
}

/** A simple, clean A4 invoice: seller, buyer (the billing details when it was issued), the line, VAT, total, status. */
export function invoicePdf(invoice: Invoice, seller: Seller, t: InvoiceTranslate, lang: string): Buffer {
    const page = new PdfPage()
    const left = 56
    const right = A4.width - 56
    const money = (cents: number) => formatMoney(cents, lang)

    // The seller (top left) and the title with the number and the status (top right)
    let y = A4.height - 72
    page.text(left, y, seller.name, { size: 18, font: 'bold' })
    page.text(right, y, t('invoices.PDF_TITLE'), { size: 20, font: 'bold', align: 'right' })
    y -= 18
    const sellerLines = [
        ...seller.address,
        seller.vat ? t('invoices.PDF_VAT_NUMBER', { vat: seller.vat }) : '',
        seller.email ?? ''
    ].filter(Boolean)
    let sellerY = y
    for (const line of sellerLines) {
        page.text(left, sellerY, line, { size: 9, color: MUTED })
        sellerY -= 12
    }
    page.text(right, y, invoice.number, { size: 11, align: 'right' })
    const status = t(`invoices.PDF_STATUS_${invoice.status}`)
    const badge = textWidth(status, 9, 'bold') + 16
    page.rect(right - badge, y - 26, badge, 16, STATUS_COLORS[invoice.status])
    page.text(right - badge / 2, y - 21, status, { size: 9, font: 'bold', color: [1, 1, 1], align: 'center' })

    // The buyer (left) and the dates (right)
    y = Math.min(sellerY, y - 40) - 28
    page.text(left, y, t('invoices.PDF_BILLED_TO').toUpperCase(), { size: 8, font: 'bold', color: MUTED })
    const facts: [string, string][] = [
        [t('invoices.PDF_DATE'), formatDate(invoice.issuedAt, lang)],
        ...(invoice.paidAt
            ? ([[t('invoices.PDF_PAID_ON'), formatDate(invoice.paidAt, lang)]] as [string, string][])
            : []),
        [t('invoices.PDF_PERIOD'), t(`invoices.PDF_PERIOD_${invoice.period}`)]
    ]
    let factY = y
    for (const [label, value] of facts) {
        page.text(right - 150, factY, label, { size: 9, color: MUTED })
        page.text(right, factY, value, { size: 9, align: 'right' })
        factY -= 14
    }
    let buyerY = y - 16
    page.text(left, buyerY, invoice.company || invoice.tenantName, { size: 11, font: 'bold' })
    buyerY -= 14
    const buyerLines = [
        ...(invoice.company && invoice.company !== invoice.tenantName ? [invoice.tenantName] : []),
        ...wrap(invoice.billingAddress ?? '', 250, 9),
        invoice.vat ? t('invoices.PDF_VAT_NUMBER', { vat: invoice.vat }) : '',
        invoice.billingEmail ?? ''
    ].filter(Boolean)
    for (const line of buyerLines) {
        page.text(left, buyerY, line, { size: 9, color: MUTED })
        buyerY -= 12
    }

    // The line of the invoice
    y = Math.min(buyerY, factY) - 36
    page.text(left, y, t('invoices.PDF_DESCRIPTION').toUpperCase(), { size: 8, font: 'bold', color: MUTED })
    page.text(right - 150, y, t('invoices.PDF_QUANTITY').toUpperCase(), { size: 8, font: 'bold', color: MUTED })
    page.text(right, y, t('invoices.PDF_AMOUNT').toUpperCase(), { size: 8, font: 'bold', color: MUTED, align: 'right' })
    y -= 8
    page.line(left, y, right, y)
    y -= 18
    page.text(left, y, invoice.productName, { size: 10, font: 'bold' })
    page.text(right - 150, y, t('invoices.PDF_SEATS', { seats: String(invoice.seats) }), { size: 10 })
    page.text(right, y, money(invoice.amountCents), { size: 10, align: 'right' })
    y -= 13
    page.text(
        left,
        y,
        t(`invoices.PDF_LINE_${invoice.description}`, { period: t(`invoices.PDF_PERIOD_${invoice.period}`) }),
        { size: 9, color: MUTED }
    )
    y -= 14
    page.line(left, y, right, y)

    // The totals
    const total = (label: string, value: string, bold = false) => {
        y -= 18
        page.text(right - 150, y, label, { size: bold ? 11 : 10, font: bold ? 'bold' : 'regular' })
        page.text(right, y, value, { size: bold ? 11 : 10, font: bold ? 'bold' : 'regular', align: 'right' })
    }
    total(t('invoices.PDF_SUBTOTAL'), money(invoice.amountCents))
    total(t('invoices.PDF_VAT', { percent: String(invoice.vatPercent) }), money(invoice.vatCents))
    y -= 6
    page.line(right - 150, y, right, y, { color: INK })
    total(t('invoices.PDF_TOTAL'), money(invoice.totalCents), true)

    // How it is (or was) paid
    y -= 40
    const note =
        invoice.status === 'paid' && invoice.paidAt
            ? t('invoices.PDF_NOTE_PAID', { date: formatDate(invoice.paidAt, lang) })
            : invoice.status === 'free'
              ? t('invoices.PDF_NOTE_FREE')
              : invoice.status === 'void'
                ? t('invoices.PDF_NOTE_VOID')
                : seller.iban
                  ? t('invoices.PDF_NOTE_OPEN_IBAN', { iban: seller.iban, number: invoice.number })
                  : t('invoices.PDF_NOTE_OPEN')
    for (const line of wrap(note, right - left, 9)) {
        page.text(left, y, line, { size: 9, color: MUTED })
        y -= 12
    }

    page.line(left, 64, right, 64)
    page.text(left, 50, [seller.name, ...seller.address].join(' · '), { size: 7.5, color: MUTED })
    if (seller.vat)
        page.text(right, 50, t('invoices.PDF_VAT_NUMBER', { vat: seller.vat }), {
            size: 7.5,
            color: MUTED,
            align: 'right'
        })

    return page.build({ title: `${t('invoices.PDF_TITLE')} ${invoice.number}`, author: seller.name })
}
