# metro cookbook (anyone)

Copy-paste workflows for the **generic** workspace pack. Bind your catalog once. Local work stays on validate → preview. Live writes follow preflight → dry run → apply → read-back. Every command below runs on a clean install. Live steps also need a sandbox key.

Official product docs stay on [docs.metronome.com](https://docs.metronome.com/). This page is “how to do it safely in the terminal.”

## 0. Install and sticky pack

```bash
metro workspace use generic --write
metro harness run --suite onboard --execute --json
metro mode show                    # default ceiling is read-only; writes need: metro mode set read-write
export METRONOME_SANDBOX_KEY=...    # live steps below; or put it in ~/.metro/.env
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
metro ops who "Acme Corp" --sandbox
# or
metro ops who --customer-id=<uuid> --sandbox --json
```

## 3. List packages

```bash
metro package list --sandbox --json
metro package customers --alias=<package-alias> --sandbox --json
```

## 4. Balances / credits

```bash
metro customer balances --query="Acme" --sandbox --json
```

The output includes `spendableNet`, which compares `getNetBalance` with the sum of the balance list for each credit type. A `MTR-CREDIT-NET-001` warning means the two disagree. When they do, trust the net, and don't add credits based on the list.

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
cat > trial.json <<'JSON'
{
  "packageAlias": "acme_trial",
  "uniquenessKey": "acme-trial-v1",
  "aliasStartingAt": "2030-01-01T00:00:00.000Z",
  "creditAmount": 100,
  "accessCreditTypeId": "<your-credit-type-id>",
  "trialDurationDays": 14,
  "rolloverFraction": 0,
  "noStripeConfirmed": true,
  "aliasHandoffReviewed": true,
  "verificationPlan": { "packageReadback": true }
}
JSON
metro validate --shape free-credit-trial --file trial.json --json
metro plan template annual-subscription-package --sandbox --out annual.json --json   # fill the <placeholders>, then:
metro validate --shape pro-annual-self-serve-v2 --file annual.json --json
```

To create a real package, write a `packages/create` spec and run `metro package create preflight --file=<spec> --sandbox` (see [PROVISIONING.md](PROVISIONING.md)).

## 8. Credits and billing provider (preview)

```bash
metro plan complimentary-credits --sandbox --json
metro plan billing-provider-setup --sandbox --json
```

## 9. Provision end to end (live, sandbox first)

```bash
metro mode set read-write
metro customer create preflight --name="Acme Corp" --ingest-alias=acme-corp --sandbox
metro ratecard create preflight --file=ratecard.yaml --sandbox
metro package create preflight --file=package.yaml --sandbox
metro contract create preflight --ingest-alias=acme-corp --package-alias=growth --starting-at=<UTC hour> --sandbox
metro subscription add preflight --ingest-alias=acme-corp --product-id=<id> --billing-frequency=MONTHLY --quantity=10 --sandbox
metro subscription set-quantity preflight --ingest-alias=acme-corp --subscription-id=<id> --quantity=12 --starting-at=<UTC hour> --sandbox
```

Each preflight prints a dry-run line and an apply line, with the payload hash and the sandbox token. Read-back exits `3` on any mismatch. The full walkthrough is in [PROVISIONING.md](PROVISIONING.md).

## Ops cookbook in the CLI

```bash
metro ops --json          # pack-aware one-liners
metro ops log --ask="..." # optional ask log (~/.metro/ops-log.md by default)
metro ops top
```

