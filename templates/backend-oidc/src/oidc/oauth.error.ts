/**
 * An OAuth 2.0 / OpenID Connect error (RFC 6749 section 5.2, OpenID Connect Core 3.1.2.6). `error` is one of the
 * codes of the specifications and is never translated; `description` is for developers.
 */
export class OAuthError extends Error {
    constructor(
        public readonly error: string,
        public readonly description: string,
        public readonly status = 400
    ) {
        super(description)
    }

    toJSON() {
        return { error: this.error, error_description: this.description }
    }
}
