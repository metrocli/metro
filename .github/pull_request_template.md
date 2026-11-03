## Summary

- What changed:
- Why:
- Area: shapes and validators / API coverage / init and install / docs / safety gates / CI and packaging

## Safety

- [ ] This PR does not run live Metronome calls in tests or CI. Network calls in tests use a mocked `fetch`.
- [ ] This PR does not print, log, or commit API keys, `.env` contents, or customer data.
- [ ] No new command can write to Metronome without preview, a typed confirm hash, explicit `--sandbox`/`--prod`, and a read-back.
- [ ] Nothing infers production from a key being present.
- [ ] New or changed endpoints cite their docs.metronome.com source.

## Package boundary

- [ ] `npm run pack:verify` passes (no `logs/`, tests, `.github/`, or `.env` files in the package).
- [ ] No tenant-specific names or ids (`node --test test/no-tenant-leaks.test.js`).

## Proof

- [ ] `npm test`
- [ ] `npm run docs:upstream:check`
- [ ] Real terminal output pasted below for any changed command.

## Docs

- [ ] README, AGENTS.md, llms.txt, or docs/ updated if behavior changed.
