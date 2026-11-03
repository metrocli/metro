# @metrocli/metro

**Metronome in your terminal** - shapes, validators, evidence gates, and proof for any Metronome tenant.

Apache-2.0. Generic workspace pack by default; extend with your own workspace pack for billing-opinion intents.

## Install

Do **not** use `npm install -g git+…`. On current npm that often leaves a broken symlink and `metro: command not found`.

```bash
git clone --depth 1 https://github.com/metrocli/metro.git ~/.metro/src
bash ~/.metro/src/scripts/install-global.sh
metro doctor
metro --help
metro workspace use generic --write
metro setup init --workspace generic --write
metro harness run --suite onboard --execute --json
```

Later updates (from any directory except inside a nested clone):

```bash
bash ~/.metro/src/scripts/install-global.sh
```

If anything looks wrong: `metro doctor` (or `metro doctor --json`).

Registry install (`npm install -g @metrocli/metro`) is planned once publish is configured.

## First live sandbox steps

```bash
export METRONOME_SANDBOX_KEY=...
metro catalog bind --sandbox --write
metro ops who "Customer Name" --sandbox
metro plan add-pricing-dimension-value --dimension-key=FEATURE_X --price=100 --sandbox --json
```

## Configuration

- **Operator mode** defaults to `read-only`: live lookups work, live writes are refused. Opt in per machine with `metro mode set read-write`, and drop back with `metro mode set read-only` (or `metro mode reset`).
- **API keys** come from the environment, or from the first of `METRO_ENV_FILE`, `./.env`, `~/.metro/.env`.
- **Tenant ids** (access credit type, products, rate cards) live in `~/.metro/profiles.json` under `profiles.<name>.workspaceCatalog`, written by `metro catalog bind --write`. Nothing tenant-specific is hardcoded.
- **External customer ids**: `--external-id=<id>` matches an ingest alias, the customer `external_id`, or the `external_id` custom field. Set `METRO_EXTERNAL_ID_FIELDS=crm_id,...` to match other custom field keys.
- **Workspace packs** may export an `ops` map (`ops["contract-expire"]`, ...) to provide live write operations. The generic pack ships none yet, so those commands refuse with a clear message.

## Docs

- [Quickstart](./docs/metronome-cli/QUICKSTART.md)
- [Cookbook](./docs/metronome-cli/COOKBOOK.md)
- [Install site](./docs/metronome-cli/site/install.html)
- Official Metronome: https://docs.metronome.com/

## Safety

Live reads and writes require typed confirm tokens, sandbox vs production gates, and expected-vs-actual proof after writes. A green preview is not authorization. Production keys are opaque Metronome tokens: any non-empty `METRONOME_PROD_KEY` is accepted, and it must not equal `METRONOME_SANDBOX_KEY`.

## License

Apache-2.0
