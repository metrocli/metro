# metro one goal (generic)

`metro` is **Metronome in your terminal** - the command center for safe billing work. One goal: **every billing change has a reviewed local path before any API client loads.**

## How to work

1. **State the billing goal in plain English.**
2. **Route it:** `metro route --goal "…" (--sandbox|--prod) --json`
3. **Get a plan:** `metro plan <intent> … --json`
4. **Validate locally:** `metro validate --shape <shape> --file <input> --json`
5. **Preview:** `metro <family> preview … --json`
6. **Live reads:** read-plan → read-gate → `metro api read … --confirm-live-read …`
7. **Live sandbox writes:** preview → apply-gate → approval-record → `metro api apply … --sandbox`
8. **Production writes:** blocked in current CLI - capture evidence with metro templates; apply through your ops process.

## Topic runbooks

| Goal | Start here |
|------|------------|
| New pricing dimension / addRates | `metro docs explain rate-cards.dimensional --markdown` · `metro plan add-pricing-dimension-value` |
| Vague “credits product” / BM / aggregation | `metro docs explain credits.product.decision --markdown` · `metro route --goal "…"` |
| Agent-facing docs (Markdown) | `docs/metronome-cli/site/agents.md` · `metro docs * --markdown` · `metro harness run --suite agent-literacy` |
| Pick shape vs API path | `metro docs explain workspace.routing --json` |
| First commands without a key | `metro docs explain first-safe-preview --json` |
| Customer onboarding | `metro docs explain customer.setup --json` |
| Contract price overrides | `metro docs explain contract-overrides.inspection --json` |

## Do not

- Infer tenant from env key names - always pass `--sandbox` or `--prod`.
- Run production apply through `metro api apply` - sandbox only in this release.

Official Metronome docs: https://docs.metronome.com/
