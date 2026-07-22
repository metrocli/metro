# Validation and guardrails

Validator rules: `metro docs validator-reference --json`

## Rate-card rules (dimensional)

| Rule ID | What it enforces |
|---------|------------------|
| MTR-RATE-001 | At least one dimensional action rate; `entitled: true` for active codes |
| MTR-RATE-004 | `rateCardId` required |
| MTR-RATE-005 | USAGE product, compound BM group key, FLAT rates only, `metricGroupKeyVerified` |
| MTR-IDEMP-003 | Idempotency / collision review for catalog changes |
| MTR-VERIFY-001 | Verification plan required before apply evidence |
| MTR-VERIFY-002 | Rollback plan required |
| MTR-VERIFY-003 | Sandbox proof required before production approval evidence |
| MTR-USAGE-002 | Usage events must carry `action_code` (and display name) for routing |

## API request rules (rateCards.addRates)

`metro api validate rateCards.addRates` checks:

- `body.rate_card_id` - safe identifier
- `body.starting_at` - UTC hour boundary
- `body.rates` - non-empty array

Full runbook: [DIMENSIONAL_RATE_CARD_RUNBOOK.md](./DIMENSIONAL_RATE_CARD_RUNBOOK.md)

## Live execution boundaries (current release)

| Operation | Sandbox | Production |
|-----------|---------|------------|
| Guarded reads (`metro api read`) | 20 endpoints | Same endpoints with `--prod` |
| Guarded writes (`metro api apply`) | 6 endpoints incl. `rateCards.addRates` | **Blocked** |
| Workflow apply (`metro rate-card dimensional apply`) | **Blocked** | **Blocked** |

Check: `metro status --json` and `metro release readiness --json`
