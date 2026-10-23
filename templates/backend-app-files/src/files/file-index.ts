/** The description of a file of an organisation (its bytes are in the FileStore). */
export interface FileInfo {
    id: string
    name: string
    contentType: string
    size: number
    sha256: string
    createdBy: string
    createdAt: string
}

/**
 * The descriptions of the files, per organisation: PostgreSQL in the app (PgFileIndex), in memory in the tests
 * (MemoryFileIndex). Every method only sees the files of `tenantId`.
 */
export interface FileIndex {
    find(tenantId: string, id: string): Promise<FileInfo | null>
    /** The newest first, at most 100 */
    list(tenantId: string): Promise<FileInfo[]>
    add(tenantId: string, info: FileInfo): Promise<FileInfo>
    /** False when there was no such file */
    remove(tenantId: string, id: string): Promise<boolean>
}

export const FILE_INDEX = Symbol('FILE_INDEX')
