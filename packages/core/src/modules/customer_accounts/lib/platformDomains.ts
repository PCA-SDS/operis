/**
 * Parse the `PLATFORM_DOMAINS` env into a normalized list of platform hostnames.
 *
 * Platform hosts are the deployment's own domains (admin app, marketing site,
 * loopback). Custom-domain routing MUST treat platform hosts as non-tenant
 * traffic, so domain registration, resolver lookups, and tenant-context
 * fallbacks all share the same view of which hosts are platform-owned.
 *
 * Deployments MUST set `PLATFORM_DOMAINS` to their own hostnames. The default is
 * deliberately only `localhost` (local development): a platform host resolves the
 * tenant from the *request body* rather than from the registered custom domain
 * (see `resolveTenantContext`), so listing a hostname here is a trust decision.
 * Upstream Open Mercato defaulted to `localhost,openmercato.com`; that second
 * entry is a domain this deployment does not control and was removed when the
 * project was forked. See docs/architecture/adr/ADR-0003-platform-domains-default.md.
 */
export function platformDomains(): string[] {
  return (process.env.PLATFORM_DOMAINS ?? 'localhost')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
}
