/**
 * The modules the caller may reach, for narrowing assignment enrichment.
 *
 * Fails soft to `null` ("do not narrow"): an attachment library that renders no
 * assignment labels because RBAC hiccuped is a worse outcome than a stale link,
 * and the pages those links point at enforce entitlement themselves.
 */
export async function resolveReachableModuleIds(
  resolve: (name: string) => unknown,
  auth: { sub?: string | null; tenantId?: string | null; orgId?: string | null },
): Promise<string[] | null> {
  try {
    const rbac = resolve('rbacService') as {
      getReachableModuleIds: (
        userId: string | null | undefined,
        scope: { tenantId: string | null; organizationId: string | null },
      ) => Promise<string[]>
    }
    return await rbac.getReachableModuleIds(auth.sub ?? null, {
      tenantId: auth.tenantId ?? null,
      organizationId: auth.orgId ?? null,
    })
  } catch {
    return null
  }
}
