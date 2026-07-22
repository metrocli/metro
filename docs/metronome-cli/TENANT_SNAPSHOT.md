# Tenant snapshot (`metro.tenant.snapshot.v1`)

Local account model so agents learn a Metronome tenant once and route faster.
Does **not** authorize live writes.

## Files

| Path | Purpose |
|---|---|
| `~/.metro/profiles.json` → `profiles.*.workspaceCatalog` | Bound IDs for plan templates (from `metro catalog bind --write`) |
| `~/.metro/snapshots/sandbox.json` | Versioned snapshot + inventory + classification |
| `~/.metro/snapshots/production.json` | Same for production |

## Schema (high level)

```json
{
  "schemaVersion": "metro.tenant.snapshot.v1",
  "tenant": "sandbox",
  "capturedAt": "ISO-8601",
  "sourceCommand": "metro catalog bind --sandbox --write",
  "catalog": {
    "creditTypeId": "...",
    "dimensionalBillableMetricId": "...",
    "sharedDimensionalProductId": "...",
    "payloadMode": "code-only",
    "fixedProductId": "...",
    "seatProductId": "...",
    "rateCardIds": { "alias": "uuid" },
    "dimensionalProductIds": {}
  },
  "inventory": {
    "rateCardCount": 0,
    "productCount": 0,
    "billableMetricCount": 0,
    "creditTypeCount": 0,
    "rateCards": [{ "id": "...", "name": "..." }],
    "products": [],
    "billableMetrics": [],
    "creditTypes": []
  },
  "classification": {
    "pattern": "dimensional-shared-usage|package-and-credits|greenfield-needed|unknown",
    "confidence": "high|medium|low",
    "reasons": [],
    "nextCommands": []
  }
}
```

## Patterns

| Pattern | Meaning |
|---|---|
| `dimensional-shared-usage` | Shared USAGE product + BM + ≥1 rate card - prefer addRates / dimensional intents |
| `package-template` | Tier-like rate card names (free/payg/pro/annual/…) without dimensional bindings |
| `commit-grant-heavy` | Credit type + inventory names skew commit/grant over usage |
| `package-and-credits` | Credit type / cards present but no dimensional USAGE product binding |
| `greenfield-needed` | Missing usage product or BM - `metro plan greenfield-credits-product` for local templates |
| `unknown` | Insufficient data - run `metro catalog bind` |

## Agent commands

```bash
metro catalog bind --sandbox --write
metro tenant snapshot show --markdown
metro tenant snapshot diff --sandbox --markdown
metro tenant snapshot diff --sandbox --against=production --markdown
metro plan greenfield-credits-product --sandbox --json
metro route --goal "add a credits product" --sandbox --json
metro docs explain credits.product.decision --markdown
```

History: each `writeSnapshot` copies the prior file to `~/.metro/snapshots/{tenant}.prev.json` for diff.

## Sandbox catalog create (P5)

`products.create` / `billableMetrics.create` are allowlisted for **sandbox** apply only after the full evidence ladder **and**:

```bash
--confirm-live-apply=I_UNDERSTAND_THIS_WILL_WRITE_LIVE_METRONOME_SANDBOX
--confirm-greenfield-create=I_UNDERSTAND_SANDBOX_CATALOG_CREATE
```

Production create apply stays blocked. Prefer preview templates from `metro plan greenfield-credits-product` before any apply.
