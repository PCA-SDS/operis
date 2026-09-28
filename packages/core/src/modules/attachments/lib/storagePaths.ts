/**
 * Storage-key segments every attachments driver builds its keys from, so a file
 * lands at the same key whichever driver writes it: the local driver, the
 * partitioned local storage, or the S3 provider package.
 */
export function sanitizeFileName(fileName: string): string {
  if (!fileName) return 'file'
  return fileName.replace(/[^a-zA-Z0-9._-]/g, '_')
}

export function resolveOrgSegment(orgId: string | null | undefined): string {
  if (typeof orgId === 'string' && orgId.trim().length > 0) return `org_${orgId}`
  return 'org_shared'
}

export function resolveTenantSegment(tenantId: string | null | undefined): string {
  if (typeof tenantId === 'string' && tenantId.trim().length > 0) return `tenant_${tenantId}`
  return 'tenant_shared'
}
