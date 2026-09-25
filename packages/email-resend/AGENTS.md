# `@open-mercato/email-resend` — Agent Guidelines

Keep Resend provider ownership in this package. Appointment and other feature modules may consume the stable `resend` integration ID, but they MUST NOT own Resend registration or provider-specific health logic.

## Always

- **MUST keep** the module id and integration id as `resend` unless a data migration is explicitly approved.
- **MUST scope** credential and health-check operations through the integration service's tenant and organization scope.
- **MUST register** every `healthCheck.service` declared in `integration.ts` under the exact same DI token in `di.ts`.
- **MUST run** `yarn generate` after changing module discovery files, DI, setup, ACL, or integration definitions.
- **MUST preserve** the global email fallback used by shared email delivery when scoped credentials are absent.

## Ask First

- Ask before changing Resend credential keys, integration IDs, or persisted module identifiers.
- Ask before adding Resend-specific behavior to `packages/core` or coupling this provider to a feature module.

## Never

- Never expose credentials or API keys in logs, health details, errors, or tests.
- Never make health checks read credentials from another tenant or organization.
- Never edit generated registries by hand.

## Validation Commands

```bash
yarn workspace @open-mercato/email-resend typecheck
yarn workspace @open-mercato/email-resend test
yarn generate
```
