# @metrocli/metro

**Metronome in your terminal** - shapes, validators, evidence gates, and proof for any Metronome tenant.

Apache-2.0. Generic workspace pack by default; extend with your own workspace pack for billing-opinion intents.

## Install

```bash
npm install -g @metrocli/metro
metro workspace use generic --write
metro setup init --workspace generic --write
metro harness run --suite onboard --execute --json
```

## First live sandbox steps

```bash
export METRONOME_SANDBOX_KEY=...
metro catalog bind --sandbox --write
metro ops who "Customer Name" --sandbox
metro plan add-pricing-dimension-value --dimension-key=FEATURE_X --price=100 --sandbox --json
```

## Docs

- [Quickstart](../../docs/metronome-cli/QUICKSTART.md)
- [Cookbook](../../docs/metronome-cli/COOKBOOK.md)
- [Site](../../docs/metronome-cli/site/cookbook.html)
- Official Metronome: https://docs.metronome.com/

## Safety

Live reads and writes require typed confirm tokens, sandbox vs production gates, and expected-vs-actual proof after writes. A green preview is not authorization.

## License

Apache-2.0
