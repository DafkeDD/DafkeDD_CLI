/** The kinds of file the API accepts (never SVG or HTML: those can carry scripts) */
export type FileType = 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf'

const starts = (data: Buffer, bytes: number[], at = 0) => bytes.every((byte, i) => data[at + i] === byte)

/** The type of a file by its first bytes, never by what the client says it is. Null: not an accepted type. */
export function sniff(data: Buffer): FileType | null {
    if (starts(data, [0xff, 0xd8, 0xff])) return 'image/jpeg'
    if (starts(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
    // RIFF....WEBP
    if (starts(data, [0x52, 0x49, 0x46, 0x46]) && starts(data, [0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp'
    if (starts(data, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf'
    return null
}
