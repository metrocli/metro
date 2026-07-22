# metro for agents

This is the **agent index**. Prefer Markdown + `--json` over HTML. Humans can still open `agents.html`.

Official Metronome product docs stay at [docs.metronome.com](https://docs.metronome.com/).

## Always start here

```bash
metro schema --json
metro catalog bind --sandbox --write          # once per tenant: profiles + ~/.metro/snapshots/
metro tenant snapshot show --markdown        # account pattern + next commands
metro tenant snapshot diff --markdown        # catalog drift vs .prev.json
metro ops --json                             # cookbook ordered by accountPattern
metro plan greenfield-credits-product --sandbox --json   # if pattern=greenfield-needed
metro docs explain --list --markdown
metro docs explain output.anatomy --markdown
metro docs explain refusal.troubleshooting --markdown
metro harness run --suite agent-literacy --execute --json
```

See also [`TENANT_SNAPSHOT.md`](../TENANT_SNAPSHOT.md).

Skills:

- Generic / public: [`skills/metro/SKILL.md`](../../../skills/metro/SKILL.md)

Operating rules (human + agent): [`AGENTS.md`](../../../AGENTS.md)

## Response contract (every turn)

1. **Plain English first** — billing goal, what will/will not change, approval needed before live.
2. **Technical second** — exact `metro … --json` (or `--markdown` for context load), `schemaVersion`, hashes, evidence files.
3. Parse **stdout** only for success; **stderr** for refusals (`metro.refusal.v1`).
4. Exit codes: `0` ok · `1` validation · `2` safety refusal → follow `nextCommands[]`.

## Decision trees (load as Markdown)

| Ask | Topic |
|---|---|
| "Add a credits product" / new metric / SUM vs COUNT | `metro docs explain credits.product.decision --markdown` |
| New action / dimension on existing usage product | `metro docs explain rate-cards.dimensional --markdown` |
| Workspace routing / refuse products.create for codes | `metro docs explain workspace.routing --markdown` |
| Customer onboard | `metro docs explain customer.setup --markdown` |
| Stripe attach | `metro docs explain billing-provider.attachment --markdown` |
| First safe dry-run | `metro docs explain first-safe-preview --markdown` |

Recipe table (HTML twin): [`agents.html#recipes`](agents.html#recipes)

## Generated references (Markdown siblings)

Regenerate with `npm run docs:site:refresh` (HTML + MD):

| Page | Command |
|---|---|
| [command-reference.md](command-reference.md) | `metro docs command-reference --markdown` |
| [explain-reference.md](explain-reference.md) | `metro docs explain --list --markdown` |
| [api-reference.md](api-reference.md) | `metro docs api-reference --markdown` |
| [shape-reference.md](shape-reference.md) | `metro docs shape-reference --markdown` |
| [validator-reference.md](validator-reference.md) | `metro docs validator-reference --markdown` |
| [gotcha-reference.md](gotcha-reference.md) | `metro docs gotcha-reference --markdown` |
| [evidence-gate-reference.md](evidence-gate-reference.md) | `metro docs evidence-gate-reference --markdown` |
| [input-reference.md](input-reference.md) | `metro docs input-reference --markdown` |

Hand-authored Markdown (source-of-truth docs, not generated):

- [COOKBOOK.md](../COOKBOOK.md) — 8 copy-paste workflows
- [QUICKSTART.md](../QUICKSTART.md)
- [SHAPE_CATALOG.md](../SHAPE_CATALOG.md)
- [GOTCHAS.md](../GOTCHAS.md)
- [VALIDATION_AND_GUARDRAILS.md](../VALIDATION_AND_GUARDRAILS.md)
- [one-goal.md](../one-goal.md)

## Live ops shortcuts (generic pack)

```bash
metro workspace use generic --write
metro catalog bind --sandbox --write
metro ops who "<paste>" --sandbox
metro package list --sandbox --json
metro customer balances --query="<name>" --sandbox --json
```

## Promote the codebase

If an ask takes many greps/docs hops: say **"this can be faster"** and draft a metro command, shape, validator, or cookbook/decision-topic line. Prefer one lasting shortcut rooted in truth over archaeology. See [agents.html#promote-codebase](agents.html#promote-codebase).

The CLI also emits this when it can detect a slow path automatically:

- `metro route … --json` → `promoteCodebase` (+ `agentHints` with `PROMOTE:`)
- `metro ops --json` → `promoteCodebase` when there is no snapshot / unknown pattern
- Human stdout/stderr prints **This can be faster** + suggested PR title + faster path

Treat `promoteCodebase.signal: true` as: stop thrashing, offer a PR, do not invent a one-off script.
