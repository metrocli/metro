# @metro/core

Generic Metronome CLI engine (API catalog, read/apply gates, validators, harness framework, preview).

Workspace opinions live in workspace packs:

- `@metronome/metro-workspace-generic` - public generic intents

Root `src/workspace/` shims delegate to the active workspace pack via `METRO_WORKSPACE_PACK`.
