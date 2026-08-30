export function parseTpsMigrateFlags(rest: string[]): { tenantId: string | undefined; organizationId: string | undefined; replace: boolean } {
  let tenantId: string | undefined
  let organizationId: string | undefined
  let replace = false

  const positionalArgs: string[] = []

  for (let i = 0; i < rest.length; i++) {
    const part = rest[i]
    if (!part) continue

    if (part === '--replace') {
      replace = true
    } else if (part.startsWith('--')) {
      // Ignore other flags
    } else {
      positionalArgs.push(part)
    }
  }

  if (positionalArgs.length > 0) tenantId = positionalArgs[0]
  if (positionalArgs.length > 1) organizationId = positionalArgs[1]

  return { tenantId, organizationId, replace }
}
