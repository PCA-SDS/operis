import { Entity, Index, PrimaryKey, Property, Unique } from '@open-mercato/shared/lib/db/decorators'

/**
 * An OAuth client allowed to reach the MCP endpoint.
 *
 * Three provenances, matching the current MCP authorization spec's order of
 * preference (`registrationSource`):
 *  - `preconfigured` — seeded by an operator, the recommended production path.
 *  - `cimd` — resolved from a Client ID Metadata Document (the client id is an
 *    https URL that serves its own metadata).
 *  - `dynamic` — RFC 7591 Dynamic Client Registration, kept only as an
 *    interoperability fallback and disabled unless explicitly enabled.
 *
 * Public clients hold no secret; `clientSecretHash` stays null for them and PKCE
 * is the only proof of possession.
 */
@Entity({ tableName: 'mcp_oauth_clients' })
@Unique({ properties: ['clientId'] })
export class McpOAuthClient {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'client_id', type: 'text' })
  clientId!: string

  @Property({ name: 'client_name', type: 'text' })
  clientName!: string

  /** bcrypt hash; null for public clients, which authenticate with PKCE alone. */
  @Property({ name: 'client_secret_hash', type: 'text', nullable: true })
  clientSecretHash?: string | null

  @Property({ name: 'redirect_uris', type: 'json' })
  redirectUris!: string[]

  @Property({ name: 'allowed_scopes', type: 'json' })
  allowedScopes!: string[]

  @Property({ name: 'registration_source', type: 'text' })
  registrationSource!: 'preconfigured' | 'dynamic' | 'cimd'

  /** Tenant that owns a preconfigured client; null means any tenant may use it. */
  @Property({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId?: string | null

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, nullable: true, onUpdate: () => new Date() })
  updatedAt?: Date | null

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

/**
 * A single-use authorization code.
 *
 * The code itself is never stored — only a SHA-256 hash — so a database read
 * cannot be replayed against the token endpoint. `consumedAt` makes reuse
 * detectable: per OAuth 2.1 a replayed code revokes the whole grant.
 */
@Entity({ tableName: 'mcp_oauth_authorization_codes' })
@Unique({ properties: ['codeHash'] })
@Index({ properties: ['expiresAt'] })
export class McpOAuthAuthorizationCode {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'code_hash', type: 'text' })
  codeHash!: string

  @Property({ name: 'client_id', type: 'text' })
  clientId!: string

  @Property({ name: 'user_id', type: 'uuid' })
  userId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  /** Bound at consent time from the user's authorized organizations. */
  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'scopes', type: 'json' })
  scopes!: string[]

  /** Exact string the client sent; the token request must repeat it verbatim. */
  @Property({ name: 'redirect_uri', type: 'text' })
  redirectUri!: string

  @Property({ name: 'code_challenge', type: 'text' })
  codeChallenge!: string

  @Property({ name: 'code_challenge_method', type: 'text' })
  codeChallengeMethod!: 'S256'

  /** RFC 8707 resource indicator; binds the resulting token's audience. */
  @Property({ name: 'resource', type: 'text' })
  resource!: string

  @Property({ name: 'expires_at', type: Date })
  expiresAt!: Date

  @Property({ name: 'consumed_at', type: Date, nullable: true })
  consumedAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

/**
 * A rotating refresh token. Only the hash is stored.
 *
 * Rotation is enforced: redeeming a token marks it `rotatedAt` and issues a
 * successor. Presenting an already-rotated token is treated as theft and
 * revokes the entire chain via `grantId`.
 */
@Entity({ tableName: 'mcp_oauth_refresh_tokens' })
@Unique({ properties: ['tokenHash'] })
@Index({ properties: ['grantId'] })
@Index({ properties: ['expiresAt'] })
export class McpOAuthRefreshToken {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'token_hash', type: 'text' })
  tokenHash!: string

  /** Stable across rotations; revoking the grant kills every descendant. */
  @Property({ name: 'grant_id', type: 'uuid' })
  grantId!: string

  @Property({ name: 'client_id', type: 'text' })
  clientId!: string

  @Property({ name: 'user_id', type: 'uuid' })
  userId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'scopes', type: 'json' })
  scopes!: string[]

  @Property({ name: 'resource', type: 'text' })
  resource!: string

  @Property({ name: 'expires_at', type: Date })
  expiresAt!: Date

  @Property({ name: 'rotated_at', type: Date, nullable: true })
  rotatedAt?: Date | null

  @Property({ name: 'revoked_at', type: Date, nullable: true })
  revokedAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}
