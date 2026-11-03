# Metronome - Shared Conventions

Single source of shared facts used by every `metronome-*` skill in this
repo. Specialist skills link here rather than duplicating this content.

---

## Base URL and auth

| Thing | Value |
|---|---|
| Base URL | `https://api.metronome.com` (sandbox and production use the same host; the token decides the tenant) |
| Auth header | `Authorization: Bearer <tenant-scoped token>` |
| Content type | `Content-Type: application/json` |
| User-agent (optional) | `<your-tool>/<semver>` helps when reading audit logs |

### Keys and environments

The `metro` CLI reads two tenant keys from `~/.metro/.env`:

- `METRONOME_SANDBOX_KEY` - sandbox tenant. Create at https://app.metronome.com/sandbox/developer/api-tokens
- `METRONOME_PROD_KEY` - production tenant. Create at https://app.metronome.com/developer/api-tokens

Rules for agents:

- Never print, echo, log, or commit a key. Never ask a user to paste a key
  into chat. Tell them to open `~/.metro/.env` and paste it there
  themselves (or run `metro init`, which walks a human through it).
- API keys are **tenant-scoped**: a production key does not authenticate
  sandbox calls, and vice versa.
- Never infer the tenant from which env vars happen to be set. Pass
  `--sandbox` or `--prod` explicitly on every `metro` command. A script
  that does "use the prod key if it exists" will hit production even when
  you meant sandbox.

### Method gotcha

Most Metronome endpoints are `POST`, **including many "list" and "get"
variants**. These are `GET`:

- `GET /v1/customers/{customer_id}`
- `GET /v1/customers?customer_ids=...&ingest_alias=...`
- `GET /v1/customers/{customer_id}/invoices?limit=N&status=...`
- `GET /v1/customers/{customer_id}/invoices/{invoice_id}/pdf`
- `GET /v1/credit-types/list` (pricing units)
- `GET /v1/auditLogs`
- `GET /v1/services`
- `GET /v1/billable-metrics/{billable_metric_id}`
- `GET /v1/billable-metrics`

If a POST 404s on a path you expect to exist, check
`skills/metronome-danger-zone/references/endpoint-matrix.md` or
`metro api search <query>`, then try GET with a query string.

---

## Credit types

| What | ID |
|---|---|
| Built-in USD (cents) | `2714e483-4ff1-48e4-9e25-ac732e8f24f2` (Metronome's built-in fiat type; it appears throughout the public docs) |
| Your custom credit type (example) | `00000000-0000-4000-8000-000000000001` (fake; discover yours with `GET /v1/credit-types/list`) |

- `access_schedule.credit_type_id` on a commit or credit is the unit the
  customer draws down. A custom credit type is valid here.
- `invoice_schedule.credit_type_id` on a commit **must be a fiat
  currency** (for example USD cents). Using a custom credit type returns
  `400 Credit type must be a fiat currency: <ID>`. This only surfaces on a
  live POST; schema validation does not catch it. See
  `metronome-danger-zone`.
- `invoice_schedule` is **optional** on PREPAID `add_commits[]`
  ([edit a contract](https://docs.metronome.com/api-reference/contracts/edit-a-contract.md)).
  Omit it for a pure access grant with no invoice artifact; include it with
  a fiat credit type for a $0 audit line or a paid top-up.
- Crossing these two IDs is one of the most common 400s on
  `/v2/contracts/edit`.

---

## Timestamp rules

| Field | Rule |
|---|---|
| `starting_at`, `ending_before` on contracts and schedules | Snap to **hour boundaries** (`:00:00Z`). Non-zero minutes or seconds return `400`. |
| "No expiry" | There is no never-expire flag. Recommended practice: `ending_before` about 100 years out (for example `2126-01-01T00:00:00Z`). |
| Event `timestamp` (ingest) | RFC 3339 UTC, within the 34-day back-date window |
| Minimum useful contract duration | 1 hour (bridge-contract pattern) |

All timestamps UTC, RFC 3339 / ISO 8601, `Z` suffix.

---

## Money and units

- Fiat amounts in API payloads are in **cents**. A $250 charge is `25000`.
- Amounts in a custom credit type are in that unit. Apply the contract's
  `credit_type_conversions` rate to get to fiat.

---

## Pagination

For nearly all modern list endpoints (including **POST** lists), `limit`
and `next_page` go in the **URL query string**, not the JSON body:

```
POST /v1/contracts/packages/list?limit=100&next_page=<token>
POST /v1/contract-pricing/rate-cards/getRates?limit=100&next_page=<token>
POST /v1/usage/groups?limit=100&next_page=<token>
```

GET lists (`/v1/customers`, invoices, etc.) use the same query shape.

`metro` validators reject `body.next_page` / `body.limit` on endpoints that
require query pagination. Set `limit` explicitly and never assume one page
is the full tenant inventory; prefer `metro` commands that already follow
pages.

---

## Retries and idempotency

| Scenario | Behavior |
|---|---|
| 5xx transient | Retry with exponential backoff (1s, 2s, 4s, 8s, 16s) plus jitter |
| 429 rate limit | Respect `Retry-After`; otherwise back off |
| Contract, package, commit, credit create | Pass a stable `uniqueness_key` (1-128 chars). Reusing a key returns `409` instead of creating a duplicate. A retry without one can create a duplicate. Recommended pattern: `<customer>-<plan>-<start>`, kept well under 128 chars. |
| Ingest | `transaction_id` (max 128 chars) is the dedupe key. Retrying the same event with the same `transaction_id` is safe. |

---

## Error-shape quick reference

Errors are JSON with a consistent shape:

```json
{
  "error": "BadRequest",
  "message": "instance failed to match exactly one schema (matched only 1 out of 2)"
}
```

| HTTP | Likely cause | First move |
|---|---|---|
| `400 instance failed to match exactly one schema` | Schema mismatch on `/v2/contracts/edit` | Check for a dedicated endpoint (`updateEndDate`, `updateInvoiceIssueDate`) |
| `400 Can't void invoice ... status is not finalized: DRAFT` | Invoice not finalized yet | Wait for finalize, then void (see `metronome-invoicing`) |
| `400 Invalid custom field keys: <key>` | Key not registered for that entity | `POST /v1/customFields/addKey` first |
| `400 ... starting_at must snap to hour boundary` | Non-zero minutes/seconds | Round to `:00:00Z` |
| `404 Resource not found` on a plausible path | Wrong path or method | Check the endpoint matrix; for example it is `/v1/contracts/updateInvoiceIssueDate`, not `/v1/invoices/...` |
| `409 Conflict` with `conflicting_id` | Ingest alias or `uniqueness_key` collision | Reuse the existing object or choose a different key |
| `400 Credit type must be a fiat currency: <ID>` | Custom credit type in `invoice_schedule.credit_type_id` | Use a fiat type or omit `invoice_schedule` |

---

## Source of truth for paths

Verify any path a skill gives you against
`skills/metronome-danger-zone/references/endpoint-matrix.md` (or
`metro api explain <endpoint-id>`) before writing code. If a skill and the
matrix disagree, the matrix wins; if the matrix and the official docs
disagree, the docs win and the matrix needs a fix.

---

## API documentation index

Doc page pattern:

```
https://docs.metronome.com/api-reference/<domain>/<kebab-slug>.md
```

Examples:

- https://docs.metronome.com/api-reference/contracts/create-a-contract.md
- https://docs.metronome.com/api-reference/invoices/void-an-invoice.md
- https://docs.metronome.com/api-reference/credits-and-commits/add-a-manual-balance-entry.md

Full index: https://docs.metronome.com/llms.txt. Specialist skills cite the
specific `.md` page next to each endpoint.

---

## How specialist skills reference this file

Each specialist `SKILL.md` Prerequisites section says:

> See `skills/_metronome-shared/conventions.md` for base URL, auth, credit
> types, timestamp rules, and error shapes.
