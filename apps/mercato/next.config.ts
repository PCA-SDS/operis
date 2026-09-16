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

/**
 * Cap on the workers Next forks for the production build.
 *
 * Each worker carries its own heap, so on a memory-constrained machine — a Docker
 * daemon with a small VM, most obviously — the default (one per core) is what
 * OOM-kills `next build` rather than the main process heap. Unset means "use the
 * Next default", so this is inert everywhere it is not deliberately set.
 */
const nextBuildWorkers = (() => {
  const raw = process.env.NEXT_BUILD_WORKERS
  if (!raw) return undefined
  const parsed = Number.parseInt(raw, 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
})()

/**
 * Skip the type check `next build` runs, because something else already ran it.
 *
 * CI's `typecheck` job runs `yarn typecheck:serial` over all 26 packages and is
 * inside the `ci-required` aggregator that the image build waits on, so by the
 * time the Dockerfile reaches `yarn build` the exact same commit has already been
 * type-checked. Running it again costs ~55s and, measured on a constrained
 * daemon, ~5 GB of peak heap — it was the single largest memory consumer in the
 * image build and the phase that OOM-killed it.
 *
 * Opt-in only. Unset — every local `yarn build:app`, and any build that is not
 * behind the CI gate — keeps the check. The one case this genuinely removes
 * coverage from is a `workflow_dispatch` with `skip_quality: true`, which skips
 * `ci-required` and still builds the image; that dispatch is an explicit request
 * to bypass the quality gates, and this is consistent with it.
 */
const skipTypeCheck = process.env.NEXT_SKIP_TYPE_CHECK === '1'

const contentSecurityPolicy = buildContentSecurityPolicy(isDevelopment)
const baseSecurityHeaders = buildBaseSecurityHeaders(isDevelopment)

const nextConfig: NextConfig & { agentRules?: boolean } = {
  distDir: '.mercato/next',
  // Next 16.3+ has `next dev` auto-generate AGENTS.md/CLAUDE.md pointing agents
  // at node_modules/next/dist/docs. This repo owns its own agent-instruction
  // chain with a ratcheted byte budget (yarn agents:check-budget), so the
  // generated files would be untracked churn outside that system.
  agentRules: false,
  typescript: { ignoreBuildErrors: skipTypeCheck },
  experimental: {
    // Honour NEXT_BUILD_WORKERS when it is set; otherwise leave Next's own
    // default in place (spreading `undefined` would pin the key to undefined).
    ...(nextBuildWorkers ? { cpus: nextBuildWorkers } : {}),
    // Tell Turbopack/Webpack to treat these packages as having modularized
    // exports — only the named exports actually used in source are
    // evaluated. Big win in dev mode for barrel-heavy libraries.
    //   - lucide-react: 398 import sites, full barrel ~1000 icons.
    //   - recharts: 12 import sites; pairs with the next/dynamic split in
    //     packages/ui/src/backend/charts/*Impl.tsx.
    //   - date-fns: already uses deep imports everywhere; listing it here
    //     is defense-in-depth and harmless.
    optimizePackageImports: ['lucide-react', 'recharts', 'date-fns'],
    // BOTH minifiers MUST stay off. Under Turbopack they are NOT independent:
    // `turbopackMinify` governs server output too, and `serverMinification: false`
    // does not constrain it. That was measured on 2026-09-16 — see reason 2.
    //
    // Two reasons the minifiers were originally both disabled. Both are now resolved:
    //
    // 1. MikroORM legacy decorators keyed entity metadata off `target.constructor.name`,
    //    which mangling collapses. FIXED — entities now use the TC39 decorators via
    //    `@open-mercato/shared/lib/db/decorators`, which receive the class name as a
    //    compile-time string literal. Verified with an esbuild --minify probe and by
    //    `yarn db:generate` reporting zero schema drift.
    //
    // 2. Awilix runs in `InjectionMode.CLASSIC` (packages/shared/src/lib/di/container.ts),
    //    which resolves every dependency BY CONSTRUCTOR PARAMETER NAME. Mangling renames
    //    those parameters to `e`, `t`, `n`, so every `asClass` registration fails at runtime:
    //
    //        ⨯ Could not resolve 'e'.  Resolution path: authService -> e
    //
    //    STILL OPEN. The assumption that this was a server-only concern — and that
    //    `turbopackMinify` therefore only touched browser bundles — was WRONG, and
    //    setting it to `true` took the application down completely:
    //
    //        POST /api/auth/login -> 500
    //        ⨯ Could not resolve 'e'.  Resolution path: authService -> e
    //          at packages/core/src/modules/auth/api/login.ts:107
    //
    //    Reproduced 2026-09-16 on a clean production build AND in dev, and confirmed
    //    causal in both directions by flipping this one flag. Nobody could sign in.
    //
    // WHY THE 2026-09-15 VERIFICATION MISSED IT. That probe recorded
    // `POST /api/auth/login -> 400 {"ok":false,"error":"Invalid email or password"}`
    // and read it as "the container resolved authService and ran the password check".
    // It did not. `/api/auth/login` accepts `application/x-www-form-urlencoded` or form
    // data ONLY; any other body (e.g. JSON) throws in `parseLoginForm`, which catches and
    // yields empty fields, so zod fails and the handler returns 400 at login.ts:104 —
    // three lines BEFORE `container.resolve('authService')` at login.ts:107. A 400 proves
    // the request never reached the container. The probe could not have failed.
    //
    // THE ONLY VALID PROBE is a real credentialed sign-in that returns 200 with a token:
    //
    //   curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/auth/login \
    //     -H 'Content-Type: application/x-www-form-urlencoded' \
    //     --data-urlencode "email=$EMAIL" --data-urlencode "password=$PASSWORD"
    //   # 200 = container resolved. 500 = minification broke DI. 400 = malformed probe,
    //   # NOT a pass — fix the probe and re-run.
    //
    // `/api/configs/health` is likewise insufficient: it resolves nothing from the
    // container. Re-enabling EITHER flag first requires moving the container off CLASSIC
    // to explicit `asFunction((cradle) => ...).proxy()` registrations (17 `asClass` sites
    // plus the named-parameter `asFunction` sites in container.ts), so that parameter
    // names stop being load-bearing. Until then both stay false.
    serverMinification: false,
    turbopackMinify: false,
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
