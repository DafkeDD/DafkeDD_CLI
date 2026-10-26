/** The eHealth vault of every account. PgVaultStore keeps it in PostgreSQL, MemoryVaultStore in memory (tests). */
export const VAULT_STORE = Symbol('VAULT_STORE')

/** What the certificate says (null while it could not be opened: the password is not known yet). */
export interface CertificateMeta {
    /** SHA-1 of the certificate, upper-case hex with colons. */
    thumbprint: string | null
    subject: string | null
    issuer: string | null
    /** Hex. */
    serial: string | null
    validUntil: Date | null
}

/** The eHealth certificate (PKCS#12) of one account: the file and its password only encrypted. */
export interface VaultEntry extends CertificateMeta {
    userId: string
    filename: string
    sizeBytes: number
    /** The file, encrypted (see VaultService). */
    p12Encrypted: Buffer
    /** The password, encrypted; null while it is not known. */
    passwordEncrypted: Buffer | null
    uploadedAt: Date
}

export interface VaultStore {
    find(userId: string): Promise<VaultEntry | null>
    /** Stores a new file (it replaces the old one and its password). */
    save(entry: Omit<VaultEntry, 'uploadedAt'>): Promise<VaultEntry>
    /** The password that opens the file, with what the certificate says. False when there is no file. */
    setPassword(userId: string, passwordEncrypted: Buffer, meta: CertificateMeta): Promise<boolean>
    delete(userId: string): Promise<boolean>
    /** The colleagues (in that organisation) a doctor lets use the certificate: their account ids. */
    listDelegates(ownerId: string, tenantId: string): Promise<string[]>
    /** Replaces that list (only members of the organisation; the doctor never). */
    setDelegates(ownerId: string, tenantId: string, delegateIds: string[]): Promise<void>
    /** The doctors (in that organisation) who let this account use their certificate. */
    ownersFor(delegateId: string, tenantId: string): Promise<string[]>
}
