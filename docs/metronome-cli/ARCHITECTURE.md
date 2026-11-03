# metro architecture - as built today

## One sentence

**`metro-core`** is the Metronome API literacy + evidence engine; **workspace packs** add billing-opinion intents; **`@metrocli/metro`** bundles core + the generic pack.

## What you install

| Install | What you get | Default pack |
|---------|--------------|--------------|
| `npm install -g git+https://github.com/metrocli/metro.git` | `@metrocli/metro` | **generic** |
| Source checkout + `node bin/metro.js` | Same | **generic** unless `METRO_WORKSPACE_PACK` set |

## Package map

```
@metrocli/metro (root aggregator)
├── bin/metro.js              → packages/metro-core/src/cli.js
├── packages/metro-core/      CLI engine (Apache-2.0)
├── packages/metro-workspace-generic/ 12 generic intents
└── packages/metro-workspace-stub/    0 intents (CI core-only)
```

## Docs site (self-contained)

The operating manual lives **inside this repo** at `docs/metronome-cli/site/`. Open `index.html` locally or run `npm run docs:site:refresh` to regenerate the reference pages and verify the site (`npm run docs:site:verify` checks without writing).

## Pack selection (runtime)

**Implemented:**

1. `metro --workspace <id>` / `metro workspace use <id> [--write]`
2. `METRO_WORKSPACE_PACK` or `METRO_WORKSPACE`
3. session pack from `workspace use`
4. `profiles.<name>.workspacePack`
5. `~/.metro/config.json` `defaultWorkspacePack` (written by `setup init --workspace … --write` and `workspace use --write`)
6. `METRO_DEFAULT_WORKSPACE_PACK` or built-in default (`generic` for `@metrocli/metro`)

**Commands:** `metro workspace list|use|current|explain|status`

## What's in metro-core (any pack)

These work without any workspace pack:

- `metro docs explain …` - topic runbooks tied to shapes and API catalog
- `metro api catalog|explain|readiness|validate|read-plan|read-gate|…`
- `metro validate` / `metro package preview` / evidence gates
- `metro route` - refuse wrong API paths
- `metro harness run --suite api-literacy|policy|onboard|local`

## What workspace packs add

Workspace packs add billing-opinion intents on top of metro-core. Run `metro plan list --json` to see what your current pack provides. The generic pack ships with this build; see [COOKBOOK.md](./COOKBOOK.md) for copy-paste workflows.

Additional intents are available by building and registering a custom workspace pack.

## Two different "live read" systems - know which one you're using

- `metro <x> inspect --alias/--customer-id/… --plan` (`package.inspect`, `contract.inspect`, `product.inspect`, `billing-provider.inspect`, `invoice.inspect`, `subscription.history.inspect`, `customer.billing-state`) is **plan-only by design**. Without `--plan` it hard-refuses with "Live inspect execution is not implemented in the offline CLI slice." It exists to produce an audited read-plan meant to be fed through `metro api read-gate`/`metro api read` for compliance-logged production reads - it will never just answer your question by itself.
- Workspace-pack ops (`metro customer resolve`, `metro customer balances`, `metro contract move-plan preflight`, `metro contract extend-trial preflight`, `metro ledger-adjustment preflight`, `metro contract repair-accidental preflight`, `metro billing-provider cutover preflight`, `metro package customers`, `metro package list`) call Metronome **directly** via `makeClient()` with no read-gate ceremony. These are the ones that actually answer a live question in one shot. When in doubt, reach for one of these, not the generic `inspect` family.

Generic pack covers catalog-style intents with **user-bound** `workspaceCatalog` (no hardcoded UUIDs).

## Harness suites

| Suite | Proves |
|-------|--------|
| `onboard` | Schema, workspace, plan list, status, setup template, release readiness |
| `local` | onboard + shape validate/preview + API readiness |
| `workspace` | Every active-pack intent produces a `metro plan` |
| `live-allowlist` | Status + catalog explain for allowlisted endpoints |
| **`api-literacy`** | Docs + API catalog + contracts.get.v2 read-plan chain |
| **`policy`** | Safety refusals exit **2** (not validation **1**) |

```bash
metro harness run --suite api-literacy --fixture-root test/fixtures --execute --json
metro harness run --suite policy --fixture-root test/fixtures --execute --json
```

## API documentation model

- **No OpenAPI ingest** - 69 hand-curated endpoints in `packages/metro-core/src/api-catalog/index.js`
- Official `docs.metronome.com` links are manual `sources[]` on each endpoint
- Tests lock CLI JSON output shapes (`test/*.test.js`, `packages/metro-workspace-generic/test/*.test.js`)
- Endpoint matrix skills, safe-run refusal tests, and manifest-hash gates verify catalog coverage

## Start here

| Audience | Doc |
|----------|-----|
| Generic / public path | [QUICKSTART.md](./QUICKSTART.md) + `METRO_WORKSPACE_PACK=generic` |
| Agents | `skills/metro/SKILL.md` |
