# Metronome Hierarchies - Cookbook

> Companion to `metronome-customers-hierarchies/SKILL.md`. Covers the full
> parent-child flow: parent shell, shared commit, child contract, balance
> query matrix, 10-node limit, and the ingest-alias fallback.

## Mental model

A hierarchy in Metronome is a DAG **between contracts**, not between
customers. Each child contract carries a `hierarchy_configuration.parent`
block pointing at a specific `{customer_id, contract_id}` tuple on the
parent side. The parent contract doesn't need to declare the relationship
explicitly - Metronome populates `hierarchy_configuration.children[]` on
the parent as children are linked.

```
Parent customer                       Child customer
─────────────                         ─────────────
  customer_type: 'parent'               customer_type: 'child'
  ingest_aliases: [<org_id>]            ingest_aliases: [<child_ext_id>]
    │                                     │
    └─ Parent Contract  ─────── linked via ──── Child Contract
         rate_card                                   rate_card (usually same)
         Shared Commit (999M)                       hierarchy_configuration:
           child_access:                               parent: { customer_id, contract_id }
             type: 'all'                               payer:  'SELF' | 'PARENT'
         usage_statement_schedule:                     usage_statement_behavior:
           MONTHLY                                       'SEPARATE' | 'CONSOLIDATE'
                                                      child_access: 'INDEPENDENT'
```

The parent contract **owns the shared commit**; the child contract
**owns its own rate card and usage**. Usage on the child burns the
shared commit (via `child_access: {type: 'all'}` on the commit).

---

## Recipe 1 - Create a fresh hierarchy tree

Canonical flow. Metronome documents the limits as one level deep (parent
and children, no grandchildren) and a maximum of 10 active nodes per
hierarchy.

### Step 1a. Parent shell customer (billing-only)

```js
const parent = await metronome.post('/v1/customers', {
  name: `${org_name} - Billing`,
  custom_fields: {
    customer_type: 'parent',
    org_id: String(orgId),
    org_name,
  },
});
const parentCustomerId = parent.data.id;
```

**Note:** no `ingest_aliases` on the parent shell. Children send events
with their own external ID as the `customer_id`; the parent shell only
exists to hold billing and the shared commit.

### Step 1b. Parent contract (direct, not package)

```js
const parentContract = await metronome.post('/v1/contracts/create', {
  customer_id: parentCustomerId,
  starting_at: CUTOVER_DATE,
  rate_card_id: RATE_CARD_ID,
  uniqueness_key: `parent-${orgId}-v1`,
  usage_statement_schedule: { frequency: 'MONTHLY' },
  scheduled_charges_on_usage_invoices: 'ALL',
});
const parentContractId = parentContract.data.id;
```

Direct contract - **package contracts reject everything but the narrow
package payload**, so anchor with a direct contract.

### Step 1c. Shared commit with `child_access: all`

```js
await metronome.post('/v2/contracts/edit', {
  customer_id: parentCustomerId,
  contract_id: parentContractId,
  add_commits: [{
    type: 'prepaid',
    name: 'Shared Credits',
    product_id: FIXED_PRODUCT_ID,
    applicable_product_tags: ['usage'],
    priority: 2,
    access_schedule: {
      schedule_items: [{
        amount: 999_999_999,
        starting_at: CUTOVER_DATE,
        ending_before: LEGACY_END_DATE,
      }],
    },
    invoice_schedule: {
      schedule_items: [
        { unit_price: 0, quantity: 1, timestamp: CUTOVER_DATE },
      ],
    },
    hierarchy_configuration: {
      child_access: { type: 'all' },
    },
  }],
});
```

**Notes (commit shape belongs to `metronome-packages-contracts`; shown here
only for context):**
- The `$0` `invoice_schedule` line is optional; it leaves a $0 audit line
  on the invoice. Omit `invoice_schedule` entirely for a pure access grant.
- `hierarchy_configuration.child_access.type` accepts `'all'` (case-insensitive
  per our probes; the API also accepts `'ALL'`).
- Use `add_commits` (new commit). `update_recurring_commits` silently
  drops `hierarchy_configuration` - don't try to backfill hierarchy that way.

### Step 2. Child customer + child contract

```js
const child = await metronome.post('/v1/customers', {
  name: childName,
  ingest_aliases: [accountExtId],           // REQUIRED - events use this
  custom_fields: {
    customer_type: 'child',
    external_id: accountExtId,
    org_id: String(orgId),
    org_name,
    crm_id: String(crmRecord?.id || ''),
    billing_email: crmRecord?.billing_email || '',
  },
});
const childCustomerId = child.data.id;

const childContract = await metronome.post('/v1/contracts/create', {
  customer_id: childCustomerId,
  name: `${org_name} (${accountExtId}) - Child Contract`,
  rate_card_id: RATE_CARD_ID,
  starting_at: CUTOVER_DATE,
  ending_before: LEGACY_END_DATE,         // MUST be ≤ parent end
  uniqueness_key: `child-${orgId}-${accountExtId}-v1`,
  usage_statement_schedule: { frequency: 'MONTHLY' },
  scheduled_charges_on_usage_invoices: 'ALL',
  hierarchy_configuration: {
    parent: {
      customer_id: parentCustomerId,       // both required
      contract_id: parentContractId,
    },
    payer: 'PARENT',                        // consolidate billing on parent
    usage_statement_behavior: 'SEPARATE',   // each child has its own invoice
    child_access: 'INDEPENDENT',
  },
});
```

**Semantics of the three knobs:**

| Field | Values | Meaning |
|---|---|---|
| `payer` | `'SELF'` / `'PARENT'` | Which customer gets the Stripe invoice |
| `usage_statement_behavior` | `'SEPARATE'` / `'CONSOLIDATE'` | One invoice per child or one invoice for all |
| `child_access` | `'INDEPENDENT'` (only value we've used) | Child sees its own balances; doesn't see sibling balances |

Sanity: `payer: 'PARENT' + usage_statement_behavior: 'SEPARATE'` is the
mode "each child has its own invoice, parent pays all". Recommended
practice for orgs that share credits.

### Step 3. Verify

```js
// a) Parent should now see the child populated:
const parentAfter = await metronome.post('/v2/contracts/get', {
  customer_id: parentCustomerId,
  contract_id: parentContractId,
});
// parentAfter.data.data.hierarchy_configuration.children  → array of children

// b) Parent balance query returns the shared 999M commit:
const parentBal = await metronome.post('/v1/contracts/customerBalances/list', {
  customer_id: parentCustomerId,
  include_balance: true,
  include_contract_balances: true,
});
// parentBal.data.data.length === 1 (shared commit)

// c) Child balance query returns [] - see Recipe 4.
```

---

## Recipe 2 - Dissolve a hierarchy (flatten to standalones)

Useful when migrating an org off a shared-credit setup.

1. List every child and parent contract's invoices first. `void_invoices:
   true` also voids FINALIZED (possibly already paid) invoices - see
   `metronome-danger-zone` before archiving.
2. Archive every child contract (with `void_invoices: true` only if that
   is really what you want).
3. Archive the parent contract the same way.
4. Create a fresh package contract on parent + each child (individually
   billable, no hierarchy).
5. Update `custom_fields.customer_type` to `'standalone'` on all of them
   (`/v1/customFields/setValues`).

Use a stable `uniqueness_key` (`legacy-cutover-<customer_id>-v1`) so
re-running is idempotent. Already-archived contracts return 404 - treat
as success.

---

## Recipe 3 - Ingest-alias fallback (>10-node orgs)

Metronome enforces a **10-node limit** per hierarchy tree (1 parent + 9
children). Orgs larger than that can't use native hierarchy. A common
workaround (Metronome's own docs suggest ingest aliases for
sub-organizations):

1. Create a single Metronome customer for the org (acts as billing entity).
2. Attach **all** child external IDs as ingest aliases on that one customer:

   ```js
   const allAliases = [String(orgId), ...accountExtIds];
   await metronome.post(
     `/v1/customers/${parentCustomerId}/setIngestAliases`,
     { ingest_aliases: allAliases },
   );
   ```

3. Events sent with any of those `customer_id`s (aliases) route to the
   single customer. All usage aggregates and bills to that one customer.
   Per-child usage attribution is lost inside Metronome but preserved on
   the event `properties` if you set `properties.account_id` (a billable
   metric with `group_keys: [['account_id']]` can split it back out at
   report time).

**Tradeoffs vs native hierarchy:**

| Capability | Native hierarchy | Ingest-alias fallback |
|---|---|---|
| Per-child invoice (`SEPARATE`) | Yes | No - all billed to parent |
| Independent child credit pools | Yes | No - one pool per org |
| Shared commits (`child_access: all`) | Yes | N/A - it's one customer |
| Works with >10 children | No | Yes |
| Requires child Metronome customers | Yes | No - one customer per org |

---

## Recipe 4 - Balance-query matrix (the probe)

This is the question most people get wrong: "Can I see a parent's shared
commit by querying the child's balance?" **No.** Verified empirically with
a sandbox probe.

Setup used in the probe:

- Child customer:  `00000000-0000-4000-8000-000000000001`
- Parent customer: `00000000-0000-4000-8000-000000000002`
- Parent contract holds a 999M shared commit with `child_access: {type: 'all'}`
- Child contract links to parent via `hierarchy_configuration.parent`

### Query matrix results

| Query body | customer_id | Result |
|---|---|---|
| `{ customer_id: CHILD }` | child | `[]` (0 rows) |
| `+ include_balance: true` | child | `[]` |
| `+ include_contract_balances: true` | child | `[]` |
| `+ include_ledgers: true` | child | `[]` |
| All three flags together | child | `[]` |
| Speculative: `include_balances_from_parent_contracts: true` | child | `[]` (flag ignored) |
| Speculative: `include_parent_balances`, `include_hierarchy_balances`, `include_shared_commits`, `include_inherited`, `include_parent`, `traverse_hierarchy`, `hierarchy`, `include_hierarchy`, `include_from_parent` | child | `[]` (all flags ignored; no 400) |
| Scoped to child contract | child | `[]` |
| Scoped to **parent** contract via child customer | child | `[]` (you cannot cross customer boundary this way) |
| `{ customer_id: PARENT, include_balance: true, include_contract_balances: true }` | parent | **1 row - the 999M shared commit** |
| `POST /v1/contracts/customerBalances/getNetBalance` on child | child | 0 |
| `POST /v1/contracts/customerBalances/getNetBalance` on parent | parent | **999M** |
| `POST /v2/contracts/get` on child contract | child | Returns child contract, no shared commit surfaced in `commits[]` |

### Takeaways

1. **Shared commits are only visible via the parent customer.** There is
   no flag on `customerBalances/list` or `getNetBalance` that traverses
   hierarchy - we tested every obvious name.
2. **`include_contract_balances` doesn't help.** That flag controls
   whether per-contract rollups are included in the list response; it
   doesn't expand visibility across customers.
3. **If you need "how much shared commit is left?" from a child-centric
   view, query the parent.** The child customer doesn't have the answer.
4. **Product usage still burns the shared commit correctly** - it's only
   the *read* view that's parent-scoped. Ingest child usage as usual; it
   applies against the parent's commit at invoice time.

### Code pattern

```js
// Given a child customer ID, find the shared commits available to it:
const child = await metronome.get(`/v1/customers/${childCustomerId}`);
const childContracts = await metronome.post('/v2/contracts/list', {
  customer_id: childCustomerId,
});

// Find the parent ref(s)
const parents = new Set();
for (const k of childContracts.data.data) {
  const p = k.hierarchy_configuration && k.hierarchy_configuration.parent;
  if (p) parents.add(`${p.customer_id}:${p.contract_id}`);
}

// Query each parent for shared commits
const sharedCommits = [];
for (const key of parents) {
  const [parentCustomerId, parentContractId] = key.split(':');
  const bal = await metronome.post('/v1/contracts/customerBalances/list', {
    customer_id: parentCustomerId,
    include_balance: true,
    include_contract_balances: true,
  });
  for (const row of bal.data.data || []) {
    // Filter to commits with child_access: {type: 'all'}
    const ca = row.hierarchy_configuration && row.hierarchy_configuration.child_access;
    if (ca && (ca.type || '').toUpperCase() === 'ALL') {
      sharedCommits.push({ parentCustomerId, parentContractId, row });
    }
  }
}
```

---

## Recipe 5 - Diagnose a broken link

Symptom: created a child contract with `hierarchy_configuration.parent`,
but parent's `hierarchy_configuration.children[]` is still empty.

Checks:

1. **Both IDs present?** `hierarchy_configuration.parent` needs both
   `customer_id` AND `contract_id`. Missing either → 400 schema but some
   shapes return 200 with the link silently not established.
2. **Parent contract is direct (not package)?** Package contracts reject
   `hierarchy_configuration` entirely, so if the *child* is a package it
   also fails.
3. **Child `ending_before ≤ parent ending_before`?** A child contract that
   outlives its parent is rejected.
4. **Hit the 10-node ceiling?** Parent contract response errors with
   `hierarchy size exceeds limit` - switch to ingest-alias fallback
   (Recipe 3).
5. **Both customers in the same Metronome tenant?** Cross-tenant
   hierarchies don't exist.

---

## Cross-references

- `metronome-packages-contracts` - `/v1/contracts/create` accepts the
  `hierarchy_configuration` block; the skill over there covers other
  create-time fields.
- `metronome-packages-contracts` - `add_commits[].hierarchy_configuration.child_access`
  shape, `rollover_fraction`, `priority`.
- `metronome-danger-zone §1.6` - custom-field whitelist gotcha
  (`customer_type` keys used on parents/children).
