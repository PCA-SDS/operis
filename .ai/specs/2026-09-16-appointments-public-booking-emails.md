# Public appointment booking emails

## 📝 TLDR

After a public appointment request is created, send the TPS-style internal notice and customer receipt email through the existing Resend-backed `sendEmail` helper. Keep delivery asynchronous and scoped to the public booking event. Email addresses are configured per tenant in appointments settings. The customer email clearly says the appointment is not confirmed yet.

## 📝 Problem Statement

The public appointment API stores the request and raises an internal notification event, but it does not email the spa or the customer. The TPS booking flow uses two different React Email templates for those audiences.

## 📝 Proposed Solution

Add two appointment-owned React Email templates and a persistent subscriber for `appointments.appointment.created`. The subscriber handles only events marked `source: public_booking`, reloads the appointment using tenant and organization scope, reads tenant-scoped recipient settings, and sends the internal email plus the customer receipt when a customer email exists. Reuse the shared Resend transport and its test capture behavior. TPS template branding is intentionally retained temporarily and can be generalized later.

## 📝 Architecture

- `POST /api/appointments/public/create` remains responsible for persistence and emits its existing event after successful creation.
- A new subscriber loads the appointment, line snapshots, selected option snapshots, and organization name, then sends emails independently with `sendEmail`.
- Staff-created and cloned appointments do not send these emails because they do not carry the public booking source.
- The internal template includes contact details, branch, requested date/time, service/options, prices when available, total when calculable, and a dashboard link. It accepts `externalNotes` in the loaded view model but does not render them, matching the TPS template.
- The customer template includes the unconfirmed-request notice, booking details, service prices, health and safety note, and update instructions. The feedback block is intentionally omitted for now.

## 📝 Data Model

No database changes. Email settings are stored in `ModuleConfigService` under the appointments module and scoped to the tenant. Emails use the existing customer and appointment snapshots. Membership is shown as “Not Yet” because the appointments module has no membership field.

## 📝 API Contracts

No public booking request or response contract changes. Internal settings API:

| Setting | Purpose |
|---|---|
| `from` | Tenant sender address; must be verified with the configured email provider |
| `to` | Comma-separated tenant internal recipients; required for internal notices |
| `cc` / `bcc` | Optional comma-separated tenant recipients |
| `replyTo` | Optional tenant reply address |

`RESEND_API_KEY` and the platform fallback `EMAIL_FROM` remain instance-level transport settings. Email settings are protected by `appointments.settings.manage` and resolved using the event tenant ID. There is no cross-tenant default recipient.

## 📝 UI/UX

Appointments settings includes per-tenant sender, internal recipients, CC, BCC, and reply-to fields. Email copy and layout follow the English TPS templates. The customer message is sent only when the appointment snapshot has an email address.

## 📝 Edge Cases & Failure Scenarios

- No internal recipient configured: internal email is skipped; customer email can still be sent. No recipient from another tenant or platform-wide default is used.
- No customer email: customer email is skipped; internal notice can still be sent.
- One provider send fails: log that recipient's failure and continue sending to the remaining recipients.
- Appointment or organization lookup fails: do not expose data; log and stop email construction.
- Missing prices: follow the TPS cart builder behavior and omit service items without a price.

## 📝 Risks & Impact Review

- Email delivery depends on the existing Resend key and sender configuration. Failures do not roll back the already-created appointment.
- Persistent event delivery can result in duplicate emails if a worker retries after Resend accepted a message but before the worker recorded success; Resend idempotency is not currently exposed by the shared helper.
- TPS branding, sender template text, and dashboard CTA remain temporary and should be generalized later.
- The feedback block is omitted per the current request.

## 📋 Phasing

Single phase: add templates, event subscriber, configuration documentation, and focused route/subscriber tests.

## 📋 Implementation Plan

1. Add appointment email view-model formatting and the internal/customer React Email templates.
2. Add a scoped persistent subscriber that sends only for public booking events through the shared mail helper.
3. Document instance transport configuration and test tenant settings, recipient handling, missing-email behavior, and non-public event filtering.

## Final Compliance Report

- Tenant and organization scope are applied to appointment lookup.
- No public route payload or database schema changes; tenant settings use the existing module config store, and the shared email helper supports `cc`, `bcc`, and multiple recipients.
- `@react-email/components` and Resend were already installed; no dependency was added.
- Resend is called through the shared helper; no credentials are read by templates.
- Focused settings route and subscriber tests cover tenant-scoped storage, input validation, event origin, and delivery recipient behavior.

## Changelog

| Date | Change |
|---|---|
| 2026-09-16 | Implemented TPS-matched appointment emails, tenant-scoped email address settings, and omitted the feedback block temporarily. |
