# metro quickstart (generic)

Quickstart for `@metrocli/metro` / generic workspace pack users.

## Install

```bash
git clone --depth 1 https://github.com/metrocli/metro.git ~/.metro/src
bash ~/.metro/src/scripts/install-global.sh
# npm install -g @metrocli/metro also works once the package is published
metro workspace use generic --write
```

## First 5 minutes (no API key)

```bash
metro workspace use generic --write
metro setup init --workspace generic --write   # also writes ~/.metro/config.json sticky pack
metro workspace current --json
metro status --json
metro schema --json
metro setup quickstart --workspace generic --shell | zsh
metro harness run --suite onboard --execute --json
```

The generic quickstart writes `annual-package.json` (pro-annual-self-serve-v2 shape) and uses profile `metro-sandbox`. Sticky pack means you do **not** need `METRO_WORKSPACE_PACK=generic` on every command.

## Bind catalog (first live sandbox read)

```bash
metro catalog bind --sandbox --write
metro catalog bind --show --json
```

## Workspace intents

```bash
metro plan list --json
metro plan add-pricing-dimension-value --dimension-key FEATURE_X --price 100 --sandbox --json
metro plan template annual-subscription-package --sandbox --out annual-input.json --json
metro ops who "Customer Name" --sandbox
metro package list --sandbox --json
```

See [COOKBOOK.md](./COOKBOOK.md) for the eight copy-paste workflows.

## Agents

Load the following skill:

- `skills/metro/SKILL.md` - install, gates, refusal shape

## Live operations

Same evidence ladder as core metro: read-plan → read-gate → read; preview → apply-gate → approval-record → apply (sandbox only).

Official Metronome docs: https://docs.metronome.com/

