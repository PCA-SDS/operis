# ADR-0003 — Remove the foreign domain from the `PLATFORM_DOMAINS` default

- **Status:** Accepted
- **Date:** 2026-08-23

## Context

`platformDomains()` parses `PLATFORM_DOMAINS` into the set of hostnames the
deployment considers its **own** (admin app, marketing site, loopback).

That set is security-relevant, because of how it is consumed in
`packages/core/src/modules/customer_accounts/lib/resolveTenantContext.ts`:

```ts
const isPlatform = hostname ? platformDomains().includes(hostname) : true

if (isPlatform) {
  // tenant comes from the REQUEST BODY (bodyTenantId / bodyOrganizationId)
} else {
  // custom-domain host: tenant is derived SERVER-SIDE from the registered domain
}
```

Classifying a host as "platform" therefore switches tenant resolution from
**server-derived** to **client-supplied**. On the real admin login surface that is
intended — a user picks their tenant at login and credentials are then validated
against it. But it means the platform-domain list is a trust boundary.

### Current OpenMercato behavior

```ts
process.env.PLATFORM_DOMAINS ?? 'localhost,openmercato.com'
```

The default trusts `openmercato.com` — correct for Open Mercato's own hosted
deployment, and meaningless-to-harmful for anyone else.

## Decision

Default to `localhost` only:

```ts
process.env.PLATFORM_DOMAINS ?? 'localhost'
```

`PLATFORM_DOMAINS` remains the configuration mechanism; deployments must set it to
their own hostnames.

## Reason

`openmercato.com` is a domain Operis does not control. Leaving a third party's
hostname in a security-relevant trust list is wrong on its face, independent of
exploitability. Concretely, an Operis deployment that forgot to set
`PLATFORM_DOMAINS` would treat a request bearing `Host: openmercato.com` as
platform traffic and accept a body-supplied tenant id.

This is an upstream-specific assumption rather than an intentional behaviour worth
preserving, so it is corrected rather than inherited.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Keep the upstream default | Bakes a foreign domain into our trust boundary |
| Substitute an Operis domain | No production hostname is known yet; guessing one repeats the same mistake |
| Fail hard when `PLATFORM_DOMAINS` is unset | Breaks local development, where `localhost` is the correct and only needed value |

## Security impact

Positive but modest. This narrows a trust list; it does not itself close a
demonstrated exploit path.

Assessed and found **not** vulnerable during the same review:
`readForcedHost()` honours `X-Force-Host` only when `NODE_ENV === 'test'` **and**
`X-Force-Host-Secret` matches via a constant-time comparison. That override is
correctly guarded and was left unchanged.

The residual consideration is ordinary Host-header trust: `resolveTenantContext`
reads `req.headers.get('host')`, so the deployment's reverse proxy must set/validate
`Host` as usual. That is a deployment concern, not a code defect.

## Migration impact

Behavioural change for any deployment that relied on the default while serving
`openmercato.com` — which, for Operis, is none. Deployments must set
`PLATFORM_DOMAINS` explicitly, which they should already be doing.

The unit test asserting the documented default was updated to expect
`['localhost']`.

## Future implications

When Operis has real production hostnames, set `PLATFORM_DOMAINS` in deployment
configuration. Do not reintroduce a hard-coded production domain in source.
