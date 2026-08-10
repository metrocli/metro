# Publish `@metrocli/metro`

Public open-source release path. Prefer **npm Trusted Publishing** (OIDC from
GitHub Actions) over long-lived `NPM_TOKEN` secrets.

Official docs: https://docs.npmjs.com/trusted-publishers/

## One-time setup (human, browser + laptop)

### 1. npm org for the `@metrocli` scope

1. Sign in at https://www.npmjs.com/login (enable 2FA).
2. Create org **metrocli**: https://www.npmjs.com/org/create  
   - Match the GitHub org name if prompted to link.
3. Confirm you are an **owner** of the org.

### 2. First publish (creates the package on the registry)

Trusted Publishing is configured on an existing package. Bootstrap once from a
clean checkout of `main`:

```bash
gh auth status
npm login
cd "$(mktemp -d)"
git clone --depth 1 https://github.com/metrocli/metro.git
cd metro
npm pack --dry-run
npm publish --access public
```

Confirm: https://www.npmjs.com/package/@metrocli/metro

### 3. Attach Trusted Publisher (ongoing releases)

On https://www.npmjs.com/package/@metrocli/metro → **Settings** → **Trusted Publisher**:

| Field | Value |
|-------|-------|
| Provider | GitHub Actions |
| Organization or user | `metrocli` |
| Repository | `metro` |
| Workflow filename | `publish.yml` |
| Environment name | `npm` |
| Allowed actions | `npm publish` |

Then under **Publishing access**, prefer:

- Require two-factor authentication
- Disallow tokens (after the trusted publisher works)

### 4. GitHub environment

In https://github.com/metrocli/metro/settings/environments create environment
**`npm`**. Optional but recommended: required reviewers before publish jobs run.

## Normal releases (after setup)

1. On `main`, bump `version` in `package.json` (semver).
2. Commit + merge.
3. Tag and push:

```bash
git checkout main && git pull
VERSION=$(node -p 'require("./package.json").version')
git tag "v$VERSION"
git push origin "v$VERSION"
```

4. Watch **Actions → Publish**. Provenance is attached automatically via OIDC.

Manual re-run: Actions → Publish → Run workflow → type `publish`.

## Do not

- Commit an `NPM_TOKEN` or put a classic publish token in GitHub secrets for this
  package once Trusted Publishing works.
- Publish from a dirty tree or a fork with a mismatched `repository.url`.
- Ship `metro-workspace-lev`, `docs/ops-log.md`, or Lev customer material.
