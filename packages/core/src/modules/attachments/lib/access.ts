import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import type { Attachment, AttachmentPartition } from '../data/entities'

export type AttachmentScope = {
  tenantId?: string | null
  organizationId?: string | null
}

function normalizeScopeValue(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Enforce the attachments scope invariant at every creation boundary:
 * an attachment is either fully **global** (both `tenant_id` and
 * `organization_id` null) or fully **scoped** (both set) — never partial.
 *
 * `isSameScope` deliberately treats a partial-null row as inaccessible to
 * every non-superadmin principal (fail-closed, #2107), so a partial-null row
 * is dead data that can only ever leak through a future code path that skips
 * the access check. Guarding creation keeps that class of fail-open bug from
 * re-emerging (#2109). Call this before persisting any `Attachment`.
 */
export function assertAttachmentScopeInvariant(scope: AttachmentScope): void {
  const tenantId = normalizeScopeValue(scope.tenantId)
  const organizationId = normalizeScopeValue(scope.organizationId)
  const tenantSet = tenantId !== null
  const organizationSet = organizationId !== null
  if (tenantSet !== organizationSet) {
    const missing = tenantSet ? 'organization_id' : 'tenant_id'
    throw new Error(
      `[internal] Attachment scope invariant violated: ${missing} is null while the other scope column is set. ` +
        'Attachments must be either fully scoped (both tenant_id and organization_id) or fully global (both null).',
    )
  }
}

export function isSuperAdminAuth(auth: AuthContext | null | undefined): boolean {
  if (!auth) return false
  if ((auth as any).isSuperAdmin === true) return true
  const roles = Array.isArray(auth.roles) ? auth.roles : []
  return roles.some((role) => typeof role === 'string' && role.trim().toLowerCase() === 'superadmin')
}

function isSameScope(auth: AuthContext | null | undefined, attachment: Attachment): boolean {
  if (!auth) return false
  const attachmentTenant = attachment.tenantId ?? null
  const attachmentOrg = attachment.organizationId ?? null
  // Preserve the legacy "global attachment" semantics: a row with both scope
  // columns null is treated as accessible to any authenticated principal.
  // The unauthenticated branch in checkAttachmentAccess already gates this on
  // partition.isPublic.
  if (attachmentTenant === null && attachmentOrg === null) {
    return true
  }
  // Fail-closed on partial-null scope. Previously a missing tenant_id or
  // organization_id was treated as "matches any auth value", which allowed
  // cross-tenant / cross-org access on private partitions when an attachment
  // ended up with one scope column unset. Mirrors the fail-closed pattern
  // from #2012 (mergeIdFilter).
  return attachmentTenant === auth.tenantId && attachmentOrg === auth.orgId
}

/**
 * Whether the scan has cleared this file for reading.
 *
 * Inlined rather than imported from the scan service: this module is on every
 * read path, and the service reaches a socket client through its scanner
 * resolution. A one-line comparison is not worth that dependency.
 */
function isScanCleared(attachment: Attachment): boolean {
  return attachment.scanStatus === 'clean'
}

/**
 * Whether a principal may read this attachment.
 *
 * Two questions in a fixed order, and the order is the point. Authorization is
 * settled first, so a caller from another tenant is told 403 and learns
 * nothing else; only a caller who was already entitled to the file gets told
 * anything about its scan state. Answering "still scanning" to an outsider
 * would confirm the file exists, which is the disclosure the scope check is
 * there to prevent.
 *
 * `allowUnscanned` is for callers that show a file's own status back to the
 * person who uploaded it — a composer row that says "checking" or "rejected".
 * It must never be set on a path that serves bytes.
 */
export function checkAttachmentAccess(
  auth: AuthContext | null | undefined,
  attachment: Attachment,
  partition: AttachmentPartition,
  options?: { requireAuthForPublic?: boolean; allowUnscanned?: boolean }
): { ok: true } | { ok: false; status: number } {
  const authorized = checkAttachmentAuthorization(auth, attachment, partition, options)
  if (!authorized.ok) return authorized

  // 409, not 404: the caller is entitled to this file, so pretending it does
  // not exist would be a lie they can disprove. It is not ready, and that is a
  // state they can act on — wait, or re-upload something that passes.
  if (options?.allowUnscanned !== true && !isScanCleared(attachment)) {
    return { ok: false, status: 409 }
  }
  return { ok: true }
}

function checkAttachmentAuthorization(
  auth: AuthContext | null | undefined,
  attachment: Attachment,
  partition: AttachmentPartition,
  options?: { requireAuthForPublic?: boolean }
): { ok: true } | { ok: false; status: number } {
  const superAdmin = isSuperAdminAuth(auth)
  const requireAuth = !partition.isPublic || options?.requireAuthForPublic === true

  if (requireAuth) {
    if (!auth) {
      return { ok: false, status: 401 }
    }
    if (superAdmin || isSameScope(auth, attachment)) {
      return { ok: true }
    }
    return { ok: false, status: 403 }
  }

  if (!auth) {
    const isTenantScoped = !!attachment.tenantId || !!attachment.organizationId
    if (isTenantScoped) {
      return { ok: false, status: 401 }
    }
    return { ok: true }
  }

  if (!superAdmin && !isSameScope(auth, attachment)) {
    return { ok: false, status: 403 }
  }
  return { ok: true }
}
