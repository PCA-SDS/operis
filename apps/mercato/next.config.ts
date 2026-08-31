import type { NextConfig } from "next";
import path from "node:path";
import { resolveAllowedDevOrigins } from './src/lib/dev-origins'
import {
  buildBaseSecurityHeaders,
  buildContentSecurityPolicy,
} from './src/lib/security-headers'
import { telemetryServerExternalPackages } from '@open-mercato/telemetry/nextjs-config'

const isDevelopment = process.env.NODE_ENV !== 'production'
const allowedDevOrigins = isDevelopment ? resolveAllowedDevOrigins() : []

const contentSecurityPolicy = buildContentSecurityPolicy(isDevelopment)
const baseSecurityHeaders = buildBaseSecurityHeaders(isDevelopment)

const nextConfig: NextConfig & { agentRules?: boolean } = {
  distDir: '.mercato/next',
  // Next 16.3+ has `next dev` auto-generate AGENTS.md/CLAUDE.md pointing agents
  // at node_modules/next/dist/docs. This repo owns its own agent-instruction
  // chain with a ratcheted byte budget (yarn agents:check-budget), so the
  // generated files would be untracked churn outside that system.
  agentRules: false,
  experimental: {
    // Tell Turbopack/Webpack to treat these packages as having modularized
    // exports — only the named exports actually used in source are
    // evaluated. Big win in dev mode for barrel-heavy libraries.
    //   - lucide-react: 398 import sites, full barrel ~1000 icons.
    //   - recharts: 12 import sites; pairs with the next/dynamic split in
    //     packages/ui/src/backend/charts/*Impl.tsx.
    //   - date-fns: already uses deep imports everywhere; listing it here
    //     is defense-in-depth and harmless.
    optimizePackageImports: ['lucide-react', 'recharts', 'date-fns'],
    // Minification is ON. It was disabled for years because MikroORM's LEGACY decorators
    // keyed entity metadata off `target.constructor.name`: the minifier mangled distinct
    // entity classes down to the same short identifier, their metadata buckets collided, and
    // `next build` died with `MetadataError: Multiple property decorators used on
    // 'I.comments'` while collecting page data. Turbopack applies `turbopackMinify` to the
    // server graph too, so turning off only `serverMinification` was not enough and the
    // client shipped ~62 MB of unminified JS.
    //
    // Entities now use the TC39 (Stage-3) decorators via
    // `@open-mercato/shared/lib/db/decorators`. Those receive the class name as a
    // compile-time string literal and attach metadata per class through the decorator
    // context, so identifier mangling cannot merge two entities' metadata. Verified by
    // building the collision case (`comments` as @OneToMany on one entity and a scalar
    // @Property on another) with esbuild --minify and reading back MikroORM's metadata, and
    // by `yarn db:generate` reporting zero schema drift after the migration.
    //
    // If a future change reintroduces `@mikro-orm/decorators/legacy` anywhere in the entity
    // graph, this must go back to `false` — see tsconfig.base.json.
    ...(isDevelopment
      ? {
          preloadEntriesOnStart: false,
        }
      : {}),
  },
  turbopack: {
    // Monorepo root is two levels up from apps/mercato
    root: path.resolve(process.cwd(), "../.."),
  },
  allowedDevOrigins: allowedDevOrigins.length > 0 ? allowedDevOrigins : undefined,
  // Externalize packages that are only used in CLI context, not Next.js
  serverExternalPackages: [
    'esbuild',
    '@esbuild/darwin-arm64',
    '@open-mercato/cli',
    // Telemetry: the OTEL SDK + instrumentations must run as real Node modules,
    // not be bundled — the auto-instrumentations (pg/undici) monkey-patch the
    // underlying drivers at runtime. The full list is owned by
    // @open-mercato/telemetry so it can never drift into a partial (silently
    // "emits nothing") copy.
    ...telemetryServerExternalPackages,
  ],
  // Mirror server-only env vars that client components must observe. Keep this
  // list minimal — anything added here is inlined into the client bundle.
  env: {
    OM_SEARCH_MIN_LEN: process.env.OM_SEARCH_MIN_LEN,
  },
  /**
   * RFC 8414 / RFC 9728 require these documents at the ORIGIN root, but the
   * handlers live in the `mcp` module and are therefore served under
   * `/api/mcp/...`. Rewriting keeps the spec-mandated URLs without adding route
   * files outside the module.
   *
   * The `:path*` variants cover RFC 9728 §3.1 path-insertion — a client
   * discovering the resource `https://host/api/mcp/tasks` fetches
   * `https://host/.well-known/oauth-protected-resource/api/mcp/tasks`.
   */
  async rewrites() {
    return [
      {
        source: '/.well-known/oauth-protected-resource',
        destination: '/api/mcp/oauth/protected-resource-metadata',
      },
      {
        source: '/.well-known/oauth-protected-resource/:path*',
        destination: '/api/mcp/oauth/protected-resource-metadata',
      },
      {
        source: '/.well-known/oauth-authorization-server',
        destination: '/api/mcp/oauth/authorization-server-metadata',
      },
      {
        source: '/.well-known/oauth-authorization-server/:path*',
        destination: '/api/mcp/oauth/authorization-server-metadata',
      },
    ]
  },
  async headers() {
    const originHeaderName = (process.env.CUSTOMER_DOMAIN_ORIGIN_HEADER ?? 'X-Open-Mercato-Origin').trim()
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: contentSecurityPolicy },
          ...baseSecurityHeaders,
        ],
      },
      {
        // Attachment file downloads set their own restrictive CSP (sandbox)
        // in the route handler — override the global app CSP so it is not
        // replaced at the Next.js config layer.
        source: '/api/attachments/file/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: "default-src 'none'; sandbox" },
          ...baseSecurityHeaders,
        ],
      },
      {
        // Marker header consumed by the custom-domain DNS reverse-resolve check
        // (see SPEC 2026-04-08-portal-custom-domain-routing). Lets the verifier
        // tell "request reached our origin" from "request was answered by an
        // unrelated host that proxied it through Cloudflare/Fastly".
        source: '/_next/health',
        headers: [{ key: originHeaderName, value: '1' }],
      },
    ]
  },
}

export default nextConfig
