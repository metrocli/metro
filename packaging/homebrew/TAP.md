# Homebrew tap for metro

The formula is `packaging/homebrew/metrocli.rb` (formula name `metrocli`, binary `metro`).
Publish it from a separate `metrocli/homebrew-tap` repository.

## Release steps

1. Publish the npm release first (see [`packaging/npm/PUBLISH.md`](../npm/PUBLISH.md)).
2. Set `url` to the new registry tarball and update `sha256`:

   ```bash
   VERSION=$(node -p 'require("./package.json").version')
   URL="https://registry.npmjs.org/@metrocli/metro/-/metro-$VERSION.tgz"
   curl -sL "$URL" | shasum -a 256
   ```

3. Copy the formula to `homebrew-tap/Formula/metrocli.rb`, then check it:

   ```bash
   brew install --build-from-source ./Formula/metrocli.rb
   brew test metrocli
   brew audit --strict metrocli
   ```

## Install (users)

```bash
brew tap metrocli/tap https://github.com/metrocli/homebrew-tap
brew install metrocli
metro init
```

Until the tap exists, use `npm install -g @metrocli/metro` or `scripts/install-global.sh`.
