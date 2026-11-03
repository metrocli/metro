# Provisioning a customer end to end

This walkthrough takes one customer from nothing to a billed subscription:

customer → rate card → package → contract → subscription → quantity change

Every step works the same way:

1. **Preflight.** Only reads from Metronome. It writes a plan file with the exact request bodies and prints a `sha256:` payload hash.
2. **Dry run.** Runs `apply --file <plan> --confirm-hash <hash>` without `--apply`. It prints the requests and writes nothing.
3. **Apply.** Adds `--apply` and the typed token for the tenant. metro sends exactly the planned requests.
4. **Read-back.** metro reads each object back and prints expected vs actual. Any mismatch exits `3`.

Exit codes are `0` ok, `1` usage error, blocked plan or API error, `2` safety refusal, and `3` read-back mismatch.

The output below comes from the test suite's in-memory Metronome, so the IDs are placeholders.

## Before you start

```bash
metro mode set read-write          # writes are opt-in; the default ceiling is read-only
export METRONOME_SANDBOX_KEY=...    # or put it in ~/.metro/.env
```

Safety rules for every command on this page:

- **The tenant is always explicit.** Pass `--sandbox` or `--prod` on both preflight and apply. Without one, metro refuses with `MTR-TENANT-001`. Apply also refuses a tenant that differs from the plan's (`MTR-TENANT-003`). The hash covers the tenant, so a sandbox plan can never be applied to production.
- **The sandbox key must differ from the production key.** If `METRONOME_SANDBOX_KEY` or `METRONOME_API_KEY` equals `METRONOME_PROD_KEY`, metro refuses (`MTR-TENANT-KEY-003`).
- **The key cannot change between preflight and apply.** Apply refuses if the key fingerprint changed since preflight (`MTR-TENANT-004`).
- **Edited plans are refused.** Apply recomputes the hash and refuses a plan file edited after preflight (`MTR-PLAN-002`).
- **Each tenant has its own typed token:**
  - sandbox: `--confirm-live-apply=I_UNDERSTAND_THIS_WILL_WRITE_LIVE_METRONOME_SANDBOX`
  - production: `--prod --confirm-prod-apply=I_UNDERSTAND_BILLING_SIDE_EFFECTS`
- **Writes are retried only on 429.** A timed-out create is never sent twice.
- **Logs.** Every apply writes a log to `~/.metro/logs/<op>/`, or to `METRO_LOG_DIR` if set.

Run the whole flow in sandbox first. Repeat it with `--prod` only after the sandbox read-back passes.

## 1. Customer

```bash
metro customer create preflight --name="Acme Corp" --ingest-alias=acme-corp \
  --external-id=acme-001 \
  --stripe-customer-id=cus_ACME123 --stripe-collection-method=charge_automatically \
  --sandbox --out=plans/customer.json
```

```text
metro customer create preflight (sandbox, key sha256:80f0714120b8) - read-only, nothing written to Metronome.
  customer: null -> {"name":"Acme Corp","ingest_aliases":["acme-corp"],"custom_fields":{"external_id":"acme-001"},"customer_billing_provider_configurations":[{"billing_provider":"stripe","delivery_method":"direct_to_billing_provider","configuration":{"stripe_customer_id":"cus_ACME123","stripe_collection_method":"charge_automatically"}}]}
Steps: POST /v1/customers
Payload hash: sha256:4c30b21c141f845e307c9eb8c89070b92e06342406d2819a678c649621bf55f8
Wrote plan: ./plans/customer.json
```

`POST /v1/customers` takes no `uniqueness_key`, so metro makes the ingest aliases the idempotency anchor:

- At least one alias is required.
- Preflight refuses if any alias belongs to an active or archived customer. It also refuses a custom-field key that doesn't exist in the tenant.
- Apply checks the aliases again just before writing, so running the same plan twice fails instead of creating a duplicate customer.

The external id goes into the custom field named by `--external-id-field`. The default is the first key in `METRO_EXTERNAL_ID_FIELDS`, or `external_id` if that isn't set.

```bash
metro customer create apply --file plans/customer.json --sandbox \
  --confirm-hash sha256:4c30b21c141f845e307c9eb8c89070b92e06342406d2819a678c649621bf55f8            # dry run
metro customer create apply --file plans/customer.json --sandbox \
  --confirm-hash sha256:4c30b21c141f845e307c9eb8c89070b92e06342406d2819a678c649621bf55f8 \
  --apply --confirm-live-apply=I_UNDERSTAND_THIS_WILL_WRITE_LIVE_METRONOME_SANDBOX
```

```text
Applied (sandbox).
Read-back (expected vs actual):
  ok   customer.id: expected "present" actual "present"
  ok   customer.name: expected "Acme Corp" actual "Acme Corp"
  ok   customer.ingest_aliases: expected ["acme-corp"] actual ["acme-corp"]
  ok   customer.custom_fields: expected {"external_id":"acme-001"} actual {"external_id":"acme-001"}
  ok   billing provider stripe: expected {"stripe_customer_id":"cus_ACME123","stripe_collection_method":"charge_automatically"} actual {...same...}
Log: ~/.metro/logs/customer-create/apply-2026-11-03T19-21-34-560Z.json
```

## 2. Rate card

Write the spec. Every rate needs `product_id`, `starting_at`, `entitled` and `rate_type`. metro also requires each `starting_at` to fall on a UTC hour. A `SUBSCRIPTION` rate needs a `billing_frequency` that matches the subscriptions that will use it.

```yaml
# ratecard.yaml
name: Acme Standard
aliases:
  - name: acme_standard
rates:
  - product_id: 00000000-0000-4000-8000-000000000010   # SUBSCRIPTION product
    starting_at: 2026-12-01T00:00:00.000Z
    entitled: true
    rate_type: SUBSCRIPTION
    price: 4900
    billing_frequency: MONTHLY
  - product_id: 00000000-0000-4000-8000-000000000011   # USAGE product
    starting_at: 2026-12-01T00:00:00.000Z
    entitled: true
    rate_type: FLAT
    price: 2
```

```bash
metro ratecard create preflight --file=ratecard.yaml --sandbox --out=plans/ratecard.json
```

```text
  rate card: null -> {"name":"Acme Standard","aliases":[{"name":"acme_standard"}],"rates":"2 rates"}
Steps: POST /v1/contract-pricing/rate-cards/create ; POST /v1/contract-pricing/rate-cards/addRates
Payload hash: sha256:98ebc15e78183261ab2d2405a404baeb4648ff08a9178473dfe05543f182d868
```

The dry run shows `"rate_card_id":"$step:create.data.id"`. metro fills in that placeholder with the ID returned by the create step.

How metro handles rates and rate cards:

- **It uses `addRates` only**, at most 100 rates per call. The docs say the single-rate `addRate` endpoint is heavily rate-limited.
- **The card name is the idempotency anchor.** Rate-card create has no uniqueness key, so metro refuses a name that already exists, both at preflight and again just before writing.
- **Taking an alias from another card is refused.** In Metronome, a new card silently takes an alias from the card that holds it. metro refuses this unless you pass `--allow-alias-move`.
- **Every product is checked.** Each product must exist and must not be archived. A `SUBSCRIPTION` rate must point to a `SUBSCRIPTION` product.

Apply it the same way as step 1. The read-back checks the card's name and aliases, then finds every rate through `getRates`:

```text
  ok   rate_card.name: expected "Acme Standard" actual "Acme Standard"
  ok   rate_card.aliases: expected ["acme_standard"] actual ["acme_standard"]
  ok   rate 00000000-0000-4000-8000-000000000010@2026-12-01T00:00:00.000Z: expected {"entitled":true,"rate_type":"SUBSCRIPTION","price":4900} actual {...same...}
  ok   rate 00000000-0000-4000-8000-000000000011@2026-12-01T00:00:00.000Z: expected {"entitled":true,"rate_type":"FLAT","price":2} actual {...same...}
```

To add rates to an existing card later, run `metro ratecard add-rates preflight --rate-card-id=<id> --file=rates.yaml --sandbox`. It refuses any rate that already exists.

## 3. Package

The spec is the `POST /v1/packages/create` body. `usage_statement_schedule` sits at the top level. `day` accepts `CONTRACT_START` (usage windows on the contract anniversary) or `FIRST_OF_MONTH`. When you leave it out, Metronome uses `FIRST_OF_MONTH`.

```yaml
# package.yaml
name: Acme Growth
rate_card_id: 00000000-0000-4000-8000-000000000103
aliases:
  - name: growth
billing_provider: stripe
delivery_method: direct_to_billing_provider
usage_statement_schedule:
  frequency: MONTHLY
  day: CONTRACT_START
```

```bash
metro package create preflight --file=package.yaml --sandbox --out=plans/package.json
```

```text
  package: null -> {"name":"Acme Growth",...,"uniqueness_key":"metro-package-ec3d42f870c9802d24271817"}
Steps: POST /v1/packages/create
Payload hash: sha256:d7d5e302bc0d944254b774d65cdc122feed8befba2092e5b48a98064f36462b6
```

What preflight does with the spec:

- **`uniqueness_key`.** If the spec has none, metro derives one from the spec, at most 128 characters. Metronome returns a 409 if a key is reused. Preflight checks the key against every package, including archived ones.
- **Offsets.** Offset values given as strings, such as `"0"`, become integers.
- **Live aliases.** If another package already holds a live alias, preflight refuses. To publish a new version behind an existing alias, use `metro package clone-version`, described below.
- **Subscriptions.** Each subscription needs `subscription_rate`, `collection_schedule` and `proration`. `QUANTITY_ONLY` needs `initial_quantity`, and `SEAT_BASED` needs `seat_config`.

## 4. Contract from the package

```bash
metro contract create preflight --ingest-alias=acme-corp --package-alias=growth \
  --starting-at=2026-12-01T00:00:00.000Z --sandbox --out=plans/contract.json
```

```text
  contract: null -> {"customer_id":"00000000-0000-4000-8000-000000000101","starting_at":"2026-12-01T00:00:00.000Z","package_id":"00000000-0000-4000-8000-000000000104","uniqueness_key":"metro-contract-33ff039a22b5b61ae9e1c3fc"}
Steps: POST /v1/contracts/create
WARNING [MTR-MOVE-EMPTY-PACKAGE-001]: Package 00000000-0000-4000-8000-000000000104 has no commits, credits, subscriptions or scheduled charges.
```

metro resolves the alias to the package that is live at `starting_at` and pins that `package_id`. Apply then writes the package you previewed, even if the alias moves to another package in the meantime.

With a package, the contract body carries only the fields the docs allow: `customer_id`, `starting_at`, `package_id`, `uniqueness_key`, `transition` and `custom_fields`.

Preflight refuses to create a contract that overlaps an existing one, because two concurrent contracts bill twice. Pass `--allow-concurrent` if that is what you want. To move a customer from one package to another, use `metro contract move-plan`.

A contract without a package is written as a spec: `metro contract create preflight --file=contract.yaml --customer-id=<id> --sandbox`. The spec takes `rate_card_id` or `rate_card_alias`, plus `subscriptions[]`, `commits`, `billing_provider_configuration` and the other create fields. Every subscription in it is checked the same way as in step 3.

Read-back:

```text
  ok   contract.customer_id: expected "00000000-0000-4000-8000-000000000101" actual "00000000-0000-4000-8000-000000000101"
  ok   contract.starting_at: expected "2026-12-01T00:00:00.000Z" actual "2026-12-01T00:00:00.000Z"
  ok   contract.uniqueness_key: expected "metro-contract-33ff039a22b5b61ae9e1c3fc" actual "metro-contract-33ff039a22b5b61ae9e1c3fc"
  ok   contract.package_id: expected "00000000-0000-4000-8000-000000000104" actual "00000000-0000-4000-8000-000000000104"
```

## 5. Add a subscription

```bash
metro subscription add preflight --ingest-alias=acme-corp \
  --product-id=00000000-0000-4000-8000-000000000010 --billing-frequency=MONTHLY \
  --quantity=10 --starting-at=2026-12-01T00:00:00.000Z --sandbox --out=plans/sub.json
```

```text
  contract 00000000-0000-4000-8000-000000000105.subscriptions: 0 -> 1
Steps: POST /v2/contracts/edit
```

The dry run shows the `add_subscriptions` body:

```json
{"customer_id":"00000000-0000-4000-8000-000000000101","contract_id":"00000000-0000-4000-8000-000000000105",
 "add_subscriptions":[{"subscription_rate":{"product_id":"00000000-0000-4000-8000-000000000010","billing_frequency":"MONTHLY"},
   "collection_schedule":"ADVANCE","proration":{"is_prorated":true,"invoice_behavior":"BILL_ON_NEXT_COLLECTION_DATE"},
   "quantity_management_mode":"QUANTITY_ONLY","initial_quantity":10,"starting_at":"2026-12-01T00:00:00.000Z"}],
 "uniqueness_key":"metro-edit-9ab86777e09e8ede13fee5e3"}
```

Preflight refuses in three cases:

- The product isn't a `SUBSCRIPTION` product.
- The contract's rate card has no entitled `SUBSCRIPTION` rate for that product at that `billing_frequency`.
- The contract already has that subscription. Pass `--allow-duplicate` to add it anyway.

For a seat-based subscription, or for any `SubscriptionInputV2` field not covered by the flags, pass a full spec with `--file=subscription.yaml`. Your Metronome account must have contract editing enabled.

## 6. Change quantity or seats

```bash
metro subscription set-quantity preflight --ingest-alias=acme-corp \
  --subscription-id=00000000-0000-4000-8000-000000000106 --quantity=12 \
  --starting-at=2027-01-01T00:00:00.000Z --sandbox --out=plans/qty.json
```

```text
  subscription 00000000-0000-4000-8000-000000000106 quantity @ 2027-01-01T00:00:00.000Z: 10 -> 12
Steps: POST /v2/contracts/edit
...
Read-back (expected vs actual):
  ok   quantity at 2027-01-01T00:00:00.000Z: expected 12 actual 12
```

`--delta=<n>` is also accepted. metro always sends an absolute `quantity`, which it computes from the current schedule. Apply then writes exactly the quantity you previewed.

For a `SEAT_BASED` subscription, use `metro subscription seats preflight --subscription-id=<id> --starting-at=<hour> [--add-seat-ids=a,b] [--remove-seat-ids=c] [--add-unassigned=<n>] [--remove-unassigned=<n>]`. Its read-back reads `getSubscriptionSeatsHistory` and checks the assigned seat IDs. It checks the total seat count only when you change unassigned seats alone, because assigned seats fill unassigned ones first.

## When read-back fails

Read-back fails when the write was accepted but the object did not change as expected. That can happen if an edit was ignored, or if something else changed the object at the same time. metro then says so and exits `3`:

```text
Applied, but read-back FAILED (sandbox).
Read-back (expected vs actual):
  FAIL quantity at 2027-02-01T00:00:00.000Z: expected 15 actual 12
Log: ~/.metro/logs/subscription-set-quantity/apply-2026-11-03T19-21-34-571Z.json
```

Before writing anything else, use the log and a fresh read to find where expected and actual diverge, for example with `metro ops who --customer-id=<id> --sandbox`. Don't re-run the same plan. Fix the cause, then preflight again.

## Related ops on the same contract

| Command | Writes |
|---|---|
| `metro package clone-version preflight --aliases=growth --handoff-at=<future hour> [--usage-day=CONTRACT_START]` | A new package version behind the same alias. Read-back proves the alias resolves to the old version before the handoff and to the new one at it. |
| `metro contract move-plan preflight --to=<alias> <customer> [--cutover=<hour>]` | `updateEndDate` on the current contract, then a RENEWAL successor on the pinned package |
| `metro contract expire` / `extend-trial` | `updateEndDate` |
| `metro ledger-adjustment preflight --amount=<n> ...` / `--archive-balance-id=` / `--grant=credit\|commit ...` | A manual ledger entry, an archived grant, or a new credit or commit. Additions are refused while spendable net disagrees with the balance list. |
| `metro billing-provider cutover preflight --collection-method=... [--stripe-customer-id=cus_...]` | Archives the current Stripe configuration and sets the new one. It can also remap the customer to the correct Stripe customer. |
| `metro dimensional new-code preflight --product-id=... --rate-card-ids=... --code=... --price=...` | One `addRates` call per rate card, adding one pricing-dimension value |

The Metronome endpoints each op calls are cited in the source header of `packages/metro-workspace-generic/src/ops/*.js`.
