---
name: metronome-ingestion-events
description: >-
  Send usage events to Metronome via `/v1/ingest`, shape the event payload
  correctly (customer_id as ingest alias or Metronome ID, transaction_id dedupe
  key, RFC 3339 timestamp), batch up to 100 events per request, query past
  events for QA, and reason about the 34-day back-date window and billable
  metrics. Use when the user says "ingest events", "send events",
  "transaction_id", "usage events", "backfill", "past-dated ingest", "dedupe",
  "replay events", "batch ingestion", "billable metric", or asks about event
  schema, retry semantics on `/v1/ingest`, searching events by transaction_id,
  or `POST /v1/usage/groups`. Do NOT use for invoice lines (that's
  metronome-invoicing) or how an event gets priced (that's
  metronome-pricing-catalog).
---

# Metronome Ingestion & Events

> Before calling any Metronome endpoint, verify paths against
> `skills/metronome-danger-zone/references/endpoint-matrix.md` §1
> (Usage / Ingest). If this skill and the endpoint-matrix disagree, the
> endpoint-matrix wins.

## Purpose

This skill fires whenever you need to push usage data INTO Metronome - fresh
events from the product, backfills, replays, or QA lookups by
`transaction_id`. It covers the request shape, batching, retry semantics, the
34-day back-date window, the small family of read-back endpoints
(`/v1/events/search`, `/v1/usage/groups`) used to verify what Metronome
actually received, and the basics of billable metrics that consume events.

It does NOT cover how those quantities roll up onto invoices (see
`metronome-invoicing`) or how they are priced (see `metronome-pricing-catalog`).

## Prerequisites

See `skills/_metronome-shared/conventions.md` for base URL, auth
(`Authorization: Bearer <tenant-scoped API token>`), retry/backoff rules, and
the error-shape quick reference. For which key (sandbox vs production) and how
`metro` selects it, see the `metro` skill. Always pass `--sandbox` or `--prod`
explicitly; never infer the tenant from whichever key happens to be set.

## Mental model

```
Product action          customer_id           Metronome           Billable metric
-----------------  ->  (alias or ID)  ->   /v1/ingest   ->    (matches event_type
  user_id                                     |                 + property filters)
  action_code                         event stored,                  |
  (anything)                          dedup'd by                aggregate to
                                      transaction_id             quantity
```

Events are the **raw input layer**. They are deduplicated on
`transaction_id`. A billable metric (defined separately, see
"Billable metrics" below) reads this stream and produces quantities that a
rate card prices. If no metric matches an event's `event_type` +
`property_filters`, the event is retained but produces no invoice impact.

The `customer_id` you send on an event can be **either** the customer's
ingest alias **or** the Metronome customer ID (the ingest docs list both as
valid). Recommended practice: send an ingest alias that is your own stable
identifier (for example your account ID), so your product never needs to
store Metronome IDs. One customer can have many aliases (see
`metronome-customers-hierarchies` for alias management).

## Endpoint inventory

| Method + Path | Purpose | Official docs |
|---|---|---|
| `POST /v1/ingest` | Submit a batch (<=100) of usage events | [ingest-events](https://docs.metronome.com/api-reference/usage/ingest-events.md) |
| `POST /v1/events/search` | Find events by `transaction_id` (34-day window, sampling/QA only) | [search-events](https://docs.metronome.com/api-reference/usage/search-events.md) |
| `POST /v1/usage/groups` | Paginated usage data aggregated by `group_key` dimensions (body carries the query; `limit`/`next_page` are query-string params) | [get-usage-data-with-paginated-groupings](https://docs.metronome.com/api-reference/usage/get-usage-data-with-paginated-groupings.md) |
| `POST /v1/usage/groups/batch` | Batched usage across multiple customers at once | [get-batched-usage-data](https://docs.metronome.com/api-reference/usage/get-batched-usage-data.md) |

All ingest/usage endpoints live under `https://api.metronome.com`. In `metro`,
start with `metro usage ingest preview --file <input.json> --sandbox --json`
to validate event shape and transaction-id idempotency before any live call.

## The event schema

Every element in the `/v1/ingest` array is an object with these fields:

| Field | Required | Type | Notes |
|---|---|---|---|
| `customer_id` | yes | string | Either the **Metronome customer ID** OR an **ingest alias**. Sending an unknown/unmapped ID or alias means the event matches no customer and has no billing effect. |
| `event_type` | yes | string | Free-form label the billable metric matches on (e.g. `api_call`, `document_processed`). Pick one per product action family and never rename it while a metric depends on it. |
| `timestamp` | yes | string | RFC 3339 timestamp, UTC with `Z` suffix. Must be within the **34-day back-date window** (older events are dropped). Future timestamps are accepted but are usually a bug. |
| `transaction_id` | yes | string | Unique dedupe key, **maxLength 128 chars**. A retry with the same `transaction_id` is a no-op; the dedupe window is **34 days** per docs. See "Dedupe & idempotency" below. |
| `properties` | optional | object | Arbitrary key/value pairs the billable metric filters/aggregates on (e.g. `user_id`, `action_code`, `tokens`). Values used in `property_filters` should be strings; numeric `aggregation_key` values come from here too. |

`POST /v1/ingest` returns HTTP `200` on success. Any non-200 status
indicates failure.

## Working payloads

### Single-event ingest (canonical)

```js
await axios.post('https://api.metronome.com/v1/ingest', [{
  customer_id: 'acme_corp',               // ingest alias (or Metronome customer ID)
  event_type: 'api_call',
  timestamp: new Date().toISOString(),    // UTC RFC 3339
  transaction_id: crypto.randomUUID(),    // unique, <= 128 chars
  properties: {
    user_id: 'user_123',
    endpoint: '/v1/search',
  },
}], { headers: { Authorization: `Bearer ${token}` } });
```

**Notes:**
- Even a single event MUST be wrapped in a JSON array: `[{...}]`. Sending a
  bare object returns `400`.
- Never log or print the bearer token.

### Batch-of-N ingest (<=100)

```js
async function ingest(events) {
  for (let i = 0; i < events.length; i += 100) {
    const batch = events.slice(i, i + 100);
    await withRetry(() => client.post('/v1/ingest', batch), `INGEST (${batch.length} events)`);
  }
}
```

**Notes:**
- Hard limit is **100 events per request**. 101+ returns `400`.
- `withRetry` should handle 429 and 5xx with exponential backoff. Because
  every event carries a stable `transaction_id`, replaying the whole batch
  is safe (Metronome dedupes).
- A schema error in any record rejects the whole batch. Validate
  client-side first.

### Search events by transaction_id (QA)

```js
const hits = await post('/v1/events/search', {
  transactionIds: ['<TRANSACTION_ID>'],  // NOTE: camelCase per docs
});
```

**Notes:**
- Request field is **`transactionIds`** (camelCase), not `transaction_ids`.
- Heavily rate-limited; docs say this is for *sampling* workflows, not
  per-event verification. Response includes `is_duplicate`,
  `matched_customer`, and `matched_billable_metrics[]` for each hit.
- 34-day window; older events are not searchable here.
- For reconciliation, prefer `/v1/usage/groups` (below) or the invoice
  line-item breakdown (`metronome-invoicing`).

### Aggregated usage readback

```js
// POST body; limit + next_page are query-string params
const groups = await post('/v1/usage/groups?limit=100', {
  customer_id: '<METRONOME_CUSTOMER_ID>',
  billable_metric_id: '<METRIC_ID>',
  window_size: 'day',                  // 'hour' | 'day' | 'none'
  starting_on: '<ISO>',
  ending_before: '<ISO>',
  group_key: ['region'],               // array - supports compound keys
  group_filters: { region: ['us-east1'] },
});
```

Use this when someone asks "did Metronome see our events?" and you want the
aggregated-by-dimension view rather than raw events. The cross-customer
version is `POST /v1/usage/groups/batch`.

**Gotcha:** for compound group keys you MUST pass the complete set;
partial matches return `400`.

## Billable metrics (the consumer of events)

| Method + Path | Purpose |
|---|---|
| `POST /v1/billable-metrics/create` | Create a metric (`name`, `aggregation_type` required; `event_type_filter`, `property_filters`, `aggregation_key`, `group_keys` optional) |
| `GET /v1/billable-metrics/{id}` | Get one metric |
| `GET /v1/billable-metrics` | List metrics |
| `POST /v1/billable-metrics/archive` | Archive a metric |

- Aggregation types: `COUNT`, `SUM`, `MAX`, `UNIQUE`, `LATEST`. `SUM`/`MAX`/
  `UNIQUE`/`LATEST` need an `aggregation_key` (a property name).
- Docs: [create-a-billable-metric](https://docs.metronome.com/api-reference/billable-metrics/create-a-billable-metric.md).
- A USAGE product references exactly one billable metric (see
  `metronome-pricing-catalog`).

## Dedupe & idempotency

Metronome's idempotency primitive on ingest is `transaction_id`.
- Must be **unique per event** across your tenant, and **<= 128 characters**.
- A replay with the same `transaction_id` inside the 34-day window is a
  silent no-op. This is what makes 5xx/429 retries safe.
- If you construct deterministic IDs (e.g. `"<action>-<record-id>"`), make
  sure they can't collide across product actions; collisions look like
  "missing events" in QA. Long composite IDs can also blow the 128-char limit,
  so hash them if needed.

Recommended generators, in order of preference:
1. A deterministic ID derived from the source record (e.g. `"<event-kind>-<db-row-id>"`),
   which makes replays from your own system idempotent.
2. `crypto.randomUUID()` generated once and persisted with the record before sending.
3. Never generate a fresh random ID on each retry; that defeats dedupe.

## The 34-day back-date window

Events with a `timestamp` older than **34 days** from the call's wall clock
are dropped. This is a hard product limit.

| Want to ingest events older than 34 days | Do |
|---|---|
| For billing impact | Use `POST /v1/contracts/createHistoricalInvoices` instead (see `metronome-packages-contracts` / `metronome-invoicing`). |
| For historical accuracy only (no $) | Accept the drop; ingest won't work. Consider a reconciliation report instead. |

## Past-dated ingest & retroactive invoice changes

Even within the 34-day window, past-dated events are **not harmless**. They
can:

1. **Change a still-open (DRAFT) invoice for a prior period** that has not
   finalized yet, so the customer sees a different amount than expected.
2. **Change commit burn-down history**, shifting which period crosses
   a threshold alert.
3. Land in a period whose invoice already finalized, in which case they have
   no effect on that invoice and quietly create a mismatch between usage
   reports and billed amounts.

See `metronome-danger-zone` §1.4 for the full writeup. Recommended practice:
**only ingest `timestamp = now`** in normal product flow. Past-dated ingest
is a deliberate operation that requires confirming which invoice window the
events will land in.

## Retry semantics

`/v1/ingest` shares the global Metronome retry rules from
`skills/_metronome-shared/conventions.md`:

| Status | Treatment |
|---|---|
| `200` | Success. |
| `400` | Schema error - do NOT retry; fix payload. |
| `429` | Respect `Retry-After`; otherwise exponential backoff with jitter. |
| `5xx` | Transient; exponential backoff up to ~5 attempts. |
| Network timeout | Retry - Metronome's dedupe on `transaction_id` makes this safe. |

## Decision trees

**"Should this be an ingest event, a scheduled charge, or a commit entry?"**

| Thing happening | Use |
|---|---|
| A user did something you meter (API call, action, compute-second) | `POST /v1/ingest` (this skill) |
| A fixed periodic fee (monthly platform, seat subscription) | Subscription / fixed product on the contract (see `metronome-pricing-catalog`, `metronome-subscriptions-seats`) |
| One-off adjustment charge not tied to usage | `add_scheduled_charges` on `/v2/contracts/edit` (see `metronome-packages-contracts`) |
| Grant/credit/commit that burns against usage | `add_commits` / `add_credits` on `/v2/contracts/edit` (see `metronome-packages-contracts`) |

**"Did the event land?"**

1. `POST /v1/events/search` with the `transaction_id` - cheapest.
2. `POST /v1/usage/groups` filtered to the customer + metric + time window -
   confirms the metric picked it up.
3. Invoice preview / the current DRAFT usage invoice - confirms it will appear
   on the next invoice (see `metronome-invoicing`).

## Edge cases & gotchas

- **`customer_id` accepts either the ingest alias OR the Metronome ID.**
  Sending an *unknown* ID/alias means the event attaches to no customer. Set
  aliases via `POST /v1/customers/{id}/setIngestAliases` (see
  `metronome-customers-hierarchies`).
- **Array wrapper is mandatory.** Even one event is `[{...}]`.
- **100-event hard cap per request.** Chunk client-side.
- **Billable metrics are NOT retroactive.** If a metric was created AFTER an
  event was ingested, the event is not counted by that metric. Re-ingest
  (within 34d, with new transaction IDs only if the old events never matched
  anything billable) or use `createHistoricalInvoices`.
- **Numeric properties.** Property values that feed a numeric aggregation are
  commonly sent as strings (`"42"`); Metronome parses them. Be consistent.
- **Do not rename an `event_type` that a live metric references.** The
  metric filters on the exact string; a rename silently orphans future
  events. Deprecate via a new `event_type` + a new metric instead.
- **Past-dated `timestamp` within 34d still has billing consequences** - see
  above and `metronome-danger-zone` §1.4.
- **Tenant isolation.** API keys are tenant-scoped. A production token
  cannot ingest into the sandbox tenant and vice versa. Wrong key means `401`
  or events attributed to the wrong tenant.

## Cross-references

- `metro` - sandbox vs production key selection, preview before apply.
- `metronome-danger-zone` - endpoint-matrix is source of truth for paths;
  §1.4 documents past-dated ingest blast radius.
- `metronome-invoicing` - how quantities from ingested events become invoice
  line items, and the DRAFT/FINALIZED/VOID state machine.
- `metronome-customers-hierarchies` - managing ingest aliases and the
  GET-with-query-string customer lookup.
- `metronome-packages-contracts` - `createHistoricalInvoices` for anything
  older than the 34-day ingest window.
- `skills/_metronome-shared/conventions.md` - auth header, rate limits, 429 backoff.

## When NOT to use this skill

- **"Why does the invoice line look wrong?"** - invoice rendering; use
  `metronome-invoicing`.
- **"Why is the customer being charged the wrong $?"** - that's the price,
  not the event; use `metronome-pricing-catalog`.
- **"I need to backfill billable usage from >34 days ago"** - use
  `POST /v1/contracts/createHistoricalInvoices` in
  `metronome-packages-contracts`.
- **"I need to change the customer's ingest alias"** - use
  `metronome-customers-hierarchies`.
- **"A webhook fired because of a usage threshold"** - handler design lives
  in `metronome-danger-zone`.
