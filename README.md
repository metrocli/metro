# metro

**Metronome in your terminal.** An open-source CLI for Metronome billing, for any
Metronome tenant.

metro reads your billing setup, previews every change as a local file, checks it
against known Metronome traps, and applies it only after a typed confirmation.
Then it reads the object back and shows you expected vs actual. It is read-only
until you say otherwise, and it works on sandbox before production.

Built for people and for their agents.

## Give this to your agent

```text
set up metro - https://metrocli.com/llms.txt
```

Your agent installs metro, runs `metro init --agent`, and asks you to paste your
sandbox key into `~/.metro/.env` yourself. Keys never go through chat. The agent's
full manual ships as [AGENTS.md](./AGENTS.md) and is copied to `~/.metro/AGENTS.md`.

## Install it yourself

```bash
git clone --depth 1 https://github.com/metrocli/metro.git ~/.metro/src
bash ~/.metro/src/scripts/install-global.sh
metro init
```

`metro init` creates `~/.metro/.env` (private, mode 600), asks for your sandbox key
with hidden input, checks it with one read-only call, and leaves metro read-only.
Check your keys any time with `metro init --check`.

Once the npm release is out, `npm install -g @metrocli/metro` replaces the first two
lines. Do not use `npm install -g git+...`: on current npm it often leaves a broken
`metro` symlink. If anything looks wrong, run `metro doctor`.

## The safety ladder

Every change climbs the same six steps. metro enforces them in code.

1. **Read-only by default.** After `metro init`, metro can look, preview and
   validate. Writes need `metro mode write`.
2. **Sandbox first.** You name the tenant with `--sandbox` or `--prod` on every
   live command. metro never picks production on its own.
3. **Preview.** The change is written to a local file with a `sha256:` payload hash.
   Nothing has been sent.
4. **Confirm.** You apply with `--confirm-hash <hash>`. Production also needs a
   typed confirmation token.
5. **Apply.** One write, to the tenant you named.
6. **Read back.** metro re-reads the object and fails loudly if expected and actual
   differ.

A green preview is not authorization. Read the full policy in
[docs/SAFETY.md](./docs/SAFETY.md).

## First commands

```bash
metro status                        # what metro can see
metro catalog bind --sandbox        # learn your products and rate cards
metro ops who "Acme" --sandbox      # find a customer
```

## Docs

- [AGENTS.md](./AGENTS.md): the operating manual for agents
- [llms.txt](./llms.txt): the same essentials, compact
- [Safety policy](./docs/SAFETY.md)
- [Quickstart](./docs/metronome-cli/QUICKSTART.md) and [Cookbook](./docs/metronome-cli/COOKBOOK.md)
- [Metronome gotchas](./docs/metronome-cli/GOTCHAS.md)
- [Publishing](./packaging/npm/PUBLISH.md)
- Metronome's own docs: https://docs.metronome.com/

## License

Apache-2.0. See [LICENSE](./LICENSE).
