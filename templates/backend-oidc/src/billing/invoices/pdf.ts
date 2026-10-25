/**
 * A very small PDF writer: one A4 page, text in Helvetica and Helvetica-Bold (two of the 14 standard fonts that every
 * PDF reader has, so nothing is embedded), lines and filled rectangles. Text is encoded as WinAnsi (Windows-1252), so
 * accents and the euro sign work; other characters become "?". Enough for an invoice, without a dependency.
 */

export const A4 = { width: 595.28, height: 841.89 }

export type Font = 'regular' | 'bold'
/** r, g, b from 0 to 1. */
export type Color = [number, number, number]

// Glyph widths (per 1000 units of the font size) of the characters 32 to 126, from the Adobe font metrics.
// prettier-ignore
const HELVETICA = [
    278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556,
    556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833,
    722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556,
    556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334,
    260, 334, 584
]
// prettier-ignore
const HELVETICA_BOLD = [
    278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556,
    556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833,
    722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611,
    556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389,
    280, 389, 584
]

/** The characters of Windows-1252 between 0x80 and 0x9F (the rest of 0xA0-0xFF is the same as Unicode). */
const WIN_ANSI: Record<string, number> = {
    '€': 0x80,
    '‚': 0x82,
    ƒ: 0x83,
    '„': 0x84,
    '…': 0x85,
    '†': 0x86,
    '‡': 0x87,
    ˆ: 0x88,
    '‰': 0x89,
    Š: 0x8a,
    '‹': 0x8b,
    Œ: 0x8c,
    Ž: 0x8e,
    '‘': 0x91,
    '’': 0x92,
    '“': 0x93,
    '”': 0x94,
    '•': 0x95,
    '–': 0x96,
    '—': 0x97,
    '˜': 0x98,
    '™': 0x99,
    š: 0x9a,
    '›': 0x9b,
    œ: 0x9c,
    ž: 0x9e,
    Ÿ: 0x9f
}

/** The bytes of a text in WinAnsi encoding. Spaces of any kind become a space; unknown characters a "?". */
export function winAnsi(text: string): number[] {
    const bytes: number[] = []
    for (const char of text.normalize('NFC')) {
        const code = char.codePointAt(0) ?? 63
        if (/\s/.test(char)) bytes.push(32)
        else if ((code >= 32 && code <= 126) || (code >= 0xa0 && code <= 0xff)) bytes.push(code)
        else bytes.push(WIN_ANSI[char] ?? 63)
    }
    return bytes
}

/** The width of a text in points. Accented letters count as their base letter. */
export function textWidth(text: string, size: number, font: Font = 'regular'): number {
    const widths = font === 'bold' ? HELVETICA_BOLD : HELVETICA
    let total = 0
    for (const char of text.normalize('NFC')) {
        const base = char.normalize('NFD').codePointAt(0) ?? 32
        total += base >= 32 && base <= 126 ? (widths[base - 32] ?? 556) : 556
    }
    return (total * size) / 1000
}

/** Splits a text into lines of at most `width` points (at spaces; a word that is too long gets its own line). */
export function wrap(text: string, width: number, size: number, font: Font = 'regular'): string[] {
    const lines: string[] = []
    for (const paragraph of text.split(/\r?\n/)) {
        let line = ''
        for (const word of paragraph.split(/\s+/).filter(Boolean)) {
            const next = line ? line + ' ' + word : word
            if (line && textWidth(next, size, font) > width) {
                lines.push(line)
                line = word
            } else line = next
        }
        lines.push(line)
    }
    return lines
}

const number = (value: number) => (Math.round(value * 100) / 100).toString()
const color = (rgb: Color) => rgb.map(number).join(' ')

/** One page; draw on it, then build() gives the PDF file. Coordinates in points from the bottom left (like PDF). */
export class PdfPage {
    private readonly operations: string[] = []

    text(
        x: number,
        y: number,
        text: string,
        options: { size?: number; font?: Font; color?: Color; align?: 'left' | 'right' | 'center' } = {}
    ) {
        const size = options.size ?? 10
        const font = options.font ?? 'regular'
        const width = textWidth(text, size, font)
        const left = options.align === 'right' ? x - width : options.align === 'center' ? x - width / 2 : x
        const hex = winAnsi(text)
            .map(byte => byte.toString(16).padStart(2, '0'))
            .join('')
        this.operations.push(
            `BT /${font === 'bold' ? 'F2' : 'F1'} ${number(size)} Tf ${color(options.color ?? [0.09, 0.09, 0.09])} rg ` +
                `${number(left)} ${number(y)} Td <${hex}> Tj ET`
        )
        return width
    }

    line(x1: number, y1: number, x2: number, y2: number, options: { width?: number; color?: Color } = {}) {
        this.operations.push(
            `${color(options.color ?? [0.85, 0.85, 0.85])} RG ${number(options.width ?? 0.75)} w ` +
                `${number(x1)} ${number(y1)} m ${number(x2)} ${number(y2)} l S`
        )
    }

    rect(x: number, y: number, width: number, height: number, fill: Color) {
        this.operations.push(`${color(fill)} rg ${number(x)} ${number(y)} ${number(width)} ${number(height)} re f`)
    }

    /** The PDF file (PDF 1.4): catalog, pages, the page, two fonts and the content stream. */
    build(info: { title?: string; author?: string } = {}): Buffer {
        const content = Buffer.from(this.operations.join('\n'), 'latin1')
        const literal = (text: string) =>
            '<' +
            [
                0xfe,
                0xff,
                ...text.split('').flatMap(char => {
                    const code = char.charCodeAt(0)
                    return [code >> 8, code & 0xff]
                })
            ]
                .map(byte => byte.toString(16).padStart(2, '0'))
                .join('') +
            '>'
        const font = (name: string) => `<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>`
        const objects: Buffer[] = [
            Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
            Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
            Buffer.from(
                `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4.width} ${A4.height}] ` +
                    '/Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>'
            ),
            Buffer.from(font('Helvetica')),
            Buffer.from(font('Helvetica-Bold')),
            Buffer.concat([
                Buffer.from(`<< /Length ${content.length} >>\nstream\n`),
                content,
                Buffer.from('\nendstream')
            ]),
            Buffer.from(
                `<< /Producer (Pasport)${info.title ? ' /Title ' + literal(info.title) : ''}` +
                    `${info.author ? ' /Author ' + literal(info.author) : ''} >>`
            )
        ]
        const parts: Buffer[] = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')]
        const offsets: number[] = []
        let length = parts[0]!.length
        objects.forEach((body, index) => {
            offsets.push(length)
            const object = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), body, Buffer.from('\nendobj\n')])
            parts.push(object)
            length += object.length
        })
        const xref =
            `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
            offsets.map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('') +
            `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${objects.length} 0 R >>\n` +
            `startxref\n${length}\n%%EOF\n`
        parts.push(Buffer.from(xref))
        return Buffer.concat(parts)
    }
}
