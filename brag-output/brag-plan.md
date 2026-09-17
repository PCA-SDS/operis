# Operis ERP — Product Demo Video

**Deliverable:** `brag-output/brag.mp4` — 1920×1080, 30fps, ~100s, music bed, no narration.
**Audience:** prospective customers, stakeholders, management, presentations.
**Tone:** polished enterprise SaaS demo. Calm, confident, concise. No hype, no jokes.

## Source of truth

Every frame is a real screenshot of the running Operis application at
`localhost:3000`, captured by `tools/capture.mjs` against seeded example data
(Company A tenant). Nothing is mocked, redrawn or invented. Captures live in
`brag-output/captures/`.

**Data hygiene:** all records come from the modules' own `seed-examples` CLI
commands — fictional companies (Brightside Solar, Copperleaf Design Co.,
Harborview Analytics), fictional people, demo document numbers (`SO-DEMO-2003`,
`SQ-DEMO-1001`). No production, private or customer data appears. The dev-only
query-index warning banner and the cookie notice are stripped during capture.

## Scope decisions

**In:** the customer-to-cash spine, because it is the journey that has real,
coherent data end to end, and it is what a buying committee needs to see.

**Out (stated honestly):** WMS inventory, invoicing, tasks and calendar are
enabled modules but hold no seeded data in this environment, so they render
empty-state screens. Showing those would read as an unfinished product. Fulfilment
and finance are still demonstrated — through the order's own Shipments and
Payments tabs, which do carry real records.

## Brand

Sampled from the running app so the video and the product match exactly.

| Token | Value | Use |
|---|---|---|
| Navy (app sidebar) | `#43608E` | brand accent, eyebrows |
| Deep backdrop | `#101A2E` → `#1B2B49` | scene background gradient |
| Surface | `#F7F9FC` | app page background, card fills |
| Ink | `#0E1726` | headline text on light |
| Paper | `#EAF0F9` | headline text on dark |
| Muted | `#93A5C4` | sub-captions |

Type: the platform UI sans (`ui-sans-serif, system-ui`) — no webfont, so the
render is byte-stable. Title card 128px semibold, caption headline 35px medium,
eyebrow 19px uppercase tracked at 0.17em.

## Motion language

Deliberately restrained — the product is the subject, not the transitions.

- **Push-in:** every screen drifts 2.5% over its full slot. Nothing else moves.
- **Framing:** screens sit in a 1520×950 window on the navy field, so captions never cover the product. Scene zoom stays between 1.00 and 1.08 and is anchored **top-left**, so the sidebar and top bar are never sliced — the crop falls on the empty right/bottom page margins.
- **Transitions:** 0.65s cross-dissolve in, 0.5s out, with a ~26px lateral drift. No wipes, spins or flashes.
- **Cursor:** a soft pointer glides to a real, clickable target and pulses once, immediately before the cut to the screen that click actually produces. Used only where the click path is genuine (list → detail, tab → tab).
- **Highlight:** a rounded stroke box fades in around the region the caption refers to, on detail scenes only.
- **Captions:** lower-left card, eyebrow + headline. In at 0.4s, held for the rest of the slot, out at the cut. Every caption holds ≥ 3s.

## Storyboard

| # | In | Dur | Screen | Eyebrow | Headline | Motion |
|---|----|-----|--------|---------|----------|--------|
| 1 | 0.0 | 5.0 | Title card | — | **Operis** · Enterprise Resource Planning | Wordmark settles, rule draws, subline rises |
| 2 | 5.0 | 7.0 | `01-dashboard` | Workspace | Your workspace opens on what needs attention | Push-in |
| 3 | 12.0 | 6.0 | `02-companies` | Customers | Every customer in one list | Push-in + cursor → Brightside Solar row |
| 4 | 18.0 | 7.0 | `03-company-360` | Customer 360 | Contacts, deals and activity on a single record | Push-in + highlight on Active deals value |
| 5 | 25.0 | 7.0 | `04-pipeline` | Pipeline | Move opportunities stage by stage | Push-in across the kanban columns |
| 6 | 32.0 | 6.0 | `05-deals-list` | Forecasting | Pipeline value and win rate, always current | Highlight on the KPI row |
| 7 | 38.0 | 6.0 | `06-catalog` | Catalogue | Products and services in one catalogue | Push-in + cursor → Atlas Runner row |
| 8 | 44.0 | 6.0 | `07-product` | Product data | Variants, pricing and compliance in one place | Gentle push-in on the options panel |
| 9 | 50.0 | 6.0 | `08-quotes` | Quoting | Quote straight from the catalogue | Push-in |
| 10 | 56.0 | 6.0 | `09-orders` | Orders | Accepted quotes become orders | Push-in + cursor → SO-DEMO-2003 row |
| 11 | 62.0 | 7.0 | `10-order-items` | Order | One document carries the whole order | Highlight on order totals + cursor → Shipments tab |
| 12 | 69.0 | 6.0 | `11-order-shipments` | Fulfilment | Shipments tracked line by line | Push-in + cursor → Payments tab |
| 13 | 75.0 | 6.0 | `12-order-payments` | Finance | Payments settle against the order | Push-in on the payment row |
| 14 | 81.0 | 6.0 | `14-workflows` | Automation | Order-to-fulfilment runs as a workflow | Push-in |
| 15 | 87.0 | 6.0 | `16-rules` | Governance | Business rules enforce policy automatically | Gentle push-in on the rule rows |
| 16 | 93.0 | 8.0 | Outro card | — | Value summary, six pillars | Headline rises, six pillars stagger in |

**Total runtime: 101s.**

### Why this order

It is one continuous business journey, not a feature tour: a customer arrives
(3–4), becomes an opportunity (5–6), is quoted from the catalogue (7–9),
converts to an order (10–11), is fulfilled (12), is paid (13) — and the last two
scenes answer the question a buyer asks after seeing all of it: *does it run
itself, and can I control it?* (14–15).

Cross-module links are shown, not claimed: the customer record in scene 4 is the
same Harborview Analytics that appears on the order in scene 11; the catalogue
product in scene 8 is the same Atlas Runner Sneaker that appears as an order line.

### Outro copy

> **Operis**
> One platform for customers, sales, fulfilment and finance.
> *Customer 360 · Pipeline & forecasting · Catalogue & quoting ·
> Order to cash · Workflow automation · Multi-tenant by design*

## Audio

- Bed: `happy-beats-business-moves-vol-12` (ende.app), 117s, corporate-neutral.
- Trimmed to 101s, 1.6s fade in, 3.6s fade out.
- Measured on the delivered file: **−20.2 LUFS integrated, −7.6 dBTP**, LRA 4.0 —
  a bed you can talk over in a room, loud enough to carry on a phone.
- No SFX: clicks and whooshes read as consumer, not enterprise.
- No narration. Captions carry the message and survive muted autoplay, which is
  how this is watched in a feed or a deck.

## Gates

- [x] Every screen is a real capture of a working flow
- [x] No empty-state, error, debug or loading screens
- [x] No private or production data
- [x] Every caption holds ≥ 3s
- [x] Consistent palette, type and terminology throughout
- [x] `npx hyperframes check` — 0 errors (3 stylistic warnings: single-file composition)
- [x] `brag.mp4` rendered — 1920x1080, 30fps, 101s, H.264 + AAC stereo, music bed at -20.2 LUFS / -7.6 dBTP
- [x] Poster `brag.jpg` picked (pipeline kanban, t=28.6s) and attached as the video cover; frame 0 opens on the wordmark
