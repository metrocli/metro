# metro cookbook (anyone)

Eight copy-paste workflows for the **generic** workspace pack. Bind your catalog once, then stay on validate → preview → evidence → apply.

Official product docs stay on [docs.metronome.com](https://docs.metronome.com/). This page is “how to do it safely in the terminal.”

## 0. Install and sticky pack

```bash
metro workspace use generic --write
metro setup init --workspace generic --write
metro harness run --suite onboard --execute --json
```

## 0a. Learn their Metronome account (snapshot)

```bash
metro catalog bind --sandbox --write
metro tenant snapshot show --markdown
metro tenant snapshot diff --sandbox --markdown   # after a later bind
metro ops --json                                 # one-liners reorder by accountPattern
```

Saves bound IDs to `~/.metro/profiles.json` and a versioned model to `~/.metro/snapshots/sandbox.json` (patterns: dimensional-shared-usage / package-template / commit-grant-heavy / package-and-credits / greenfield-needed). Agents should load the snapshot Markdown before freestyle API work. See [`TENANT_SNAPSHOT.md`](TENANT_SNAPSHOT.md).

Greenfield (missing USAGE product or BM):

```bash
metro plan greenfield-credits-product --name="Usage Credits" --aggregation=COUNT --sandbox --json
# → write inputTemplate.*Request files → metro api validate/preview …
# sandbox apply only with apply-gate + approval + both confirm tokens (see TENANT_SNAPSHOT.md)
```

## 0b. Ambiguous “credits product” (agents: load this first)

```bash
metro docs explain credits.product.decision --markdown
metro route --goal "add a credits product" --sandbox --json
```

Forks: dimensional value on shared USAGE product · grant on contract · package commit schedule · rare greenfield BM+product (COUNT vs SUM interview). Do not call `products.create` until the decision topic says so.

## 1. Bind your catalog

```bash
metro catalog bind --sandbox --write
metro catalog bind --show --json
```

Writes `workspaceCatalog` (rate cards, usage product, credit type, billable metric) into `~/.metro/profiles.json`.

## 2. Who is this customer?

```bash
metro ops who "Acme Lending" --sandbox
# or
metro ops who --customer-id=<uuid> --prod --json
```

## 3. List packages

```bash
metro package list --sandbox --json
metro package list --search=annual --prod
```

## 4. Balances / credits

```bash
metro customer balances --query="Acme" --sandbox --json
```

## 5. Add a pricing dimension

```bash
metro plan add-pricing-dimension-value --dimension-key=FEATURE_X --price=100 --sandbox --json
# follow printed validate → rate-card dimensional preview → apply-gate path
```

## 6. Roll a dimension across cards

```bash
metro plan rollout-dimension-across-cards --dimension-key=FEATURE_X --sandbox --json
```

Requires non-empty `workspaceCatalog.rateCardIds` from catalog bind.

## 7. Trial / annual package (local first)

```bash
metro plan template free-trial-package --sandbox --out trial.json --json
metro validate --shape free-trial --file trial.json --json
metro plan template annual-subscription-package --sandbox --out annual.json --json
```

## 8. Credits and billing provider (preview)

```bash
metro plan complimentary-credits --sandbox --json
metro plan billing-provider-setup --sandbox --json
```

## Ops cookbook in the CLI

```bash
metro ops --json          # pack-aware one-liners
metro ops log --ask="..." # optional ask log (~/.metro/ops-log.md by default)
metro ops top
```

