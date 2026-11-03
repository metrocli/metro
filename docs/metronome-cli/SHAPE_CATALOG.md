# Shape catalog

Shapes are local JSON/YAML contracts validated before any Metronome client loads.
List all shapes: `metro shape list --json`

## dimensional-rate-card

**Maturity:** local-validated (preview only; apply blocked in current CLI)

**Purpose:** One action-code USAGE rate append on an existing tier dimensional rate
card. Rules: [VALIDATION_AND_GUARDRAILS.md](./VALIDATION_AND_GUARDRAILS.md).

**Commands:**

```bash
metro shape explain dimensional-rate-card --json
metro validate --shape dimensional-rate-card --file <input.json> --json
metro rate-card dimensional preview --file <input.json> (--sandbox|--prod) --json
```

**Required pattern:**

- `usageProduct.pricingGroupKey`: `["action_code"]`
- `usageProduct.presentationGroupKey`: `["action_display_name"]`
- `billableMetric.groupKeys`: `[["action_code", "action_display_name"]]`
- `rates[]`: per-action FLAT credit prices with `entitled: true`
- `catalogMode`: `add-rates-only`
- Evidence flags: `metricGroupKeyVerified`, `invoiceImpactReviewed`, `canaryPlan`, `verificationPlan`, `rollbackPlan`

## product-rate-retirement

See `metro docs explain product-rate-retirement.readback --json`. Closes rates with
`entitled: false` before optional `products.archive`.
