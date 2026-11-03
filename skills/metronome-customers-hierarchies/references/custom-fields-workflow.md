# Custom Fields - Full Whitelist Workflow

> Companion to `metronome-customers-hierarchies/SKILL.md`. Covers the
> step-by-step flow for adding a **new** custom-field key and writing
> values on an entity without hitting
> `400 Invalid custom field keys: <key>`.

## The two-step rule

Custom-field writes in Metronome **fail closed** on unknown keys. The
workflow is always:

1. **`addKey`** once per `(entity, key)` pair - whitelists the key.
2. **`setValues`** per entity instance you want to tag.

Skipping step 1 → `400 BadRequest: Invalid custom field keys: <key>`. The
whole write fails, including all other keys in the same batch.

---

## Step-by-step - adding a brand new key

Scenario: you want to tag each commit with `incident_ref` (an internal
Ops ticket ID) so later audits can reconstruct why a grant was issued.

### 1. Pick the entity type

Metronome scopes the whitelist per entity. Valid values of `entity`:

- `customer`
- `contract`
- `commit`
- `credit`
- `invoice`
- (plus `billable_metric`, `product`, `rate_card`, `subscription` -
  verify in the docs before using; the ones above are all we've
  exercised.)

A key valid for `commit` is **not** auto-valid for `customer`/`contract`/
`credit`/`invoice`. If you need the same key on two entity types, call
`addKey` twice.

### 2. Call `addKey` (idempotent)

```js
await metronome.post('/v1/customFields/addKey', {
  entity: 'commit',
  key: 'incident_ref',
  enforce_uniqueness: false,
});
```

- `enforce_uniqueness: true` means "no two entities of this type may share
  the same value for this key". We usually pass `false`; only use `true`
  when the key is an external primary-key equivalent (e.g., `external_id` on
  customers).
- Already exists? Metronome returns `400` with `already exists` or `409`;
  treat both as success. See the idempotent helper below.

### 3. Confirm with `listKeys`

```js
const { data } = await metronome.post('/v1/customFields/listKeys', {
  entity: 'commit',
});
// data.data = [{ entity: 'commit', key: 'grant_reason', ... }, ...]
```

### 4. Write the value onto one or many entity instances

```js
await metronome.post('/v1/customFields/setValues', {
  entity: 'commit',
  entity_id: commitId,
  custom_fields: {
    grant_reason: 'Incident remediation (INC-0001)',
    granted_by: 'Jane Doe',
    granted_by_email: 'jane@acme.example',
    granted_at: '2026-01-15T14:30:00Z',
    incident_ref: 'INC-0001',
  },
});
```

- `custom_fields` is an object, not an array. Keys map to values.
- **200-char limit per value.** Anything longer → 400 for the whole
  request. Truncate on the client.
- Existing keys on the entity **not listed** in this call are preserved;
  `setValues` is an upsert by key.

### 5. Remove keys selectively

```js
await metronome.post('/v1/customFields/deleteValues', {
  entity: 'commit',
  entity_id: commitId,
  keys: ['incident_ref'],
});
```

Preserves the other keys' values.

### 6. Remove a key from the allowlist entirely

```js
await metronome.post('/v1/customFields/removeKey', {
  entity: 'commit',
  key: 'incident_ref',
});
```

Existing instance values are NOT deleted automatically (verify in the
docs for your case); new writes just fail as unknown-key.

---

## Example key set (recommended practice)

Metronome ships no custom-field keys; every tenant registers its own. A
small, documented set like this works well. Always confirm with `listKeys`
on your tenant before writing.

### `customer`
- `customer_type` - `'standalone'` | `'parent'` | `'child'`
- `external_id` - your app's primary key for the account
- `crm_id` - the record id in your CRM
- `billing_email`
- `org_id`
- `org_name`

### `commit`
- `grant_reason`
- `granted_by`
- `granted_by_email`
- `granted_at`

### `contract` / `credit` / `invoice`
- Register only what you need. If you need one, `addKey` first.

---

## Creation-time shortcut for customers

On `POST /v1/customers`, you can pass `custom_fields: {...}` directly in the
create body - Metronome writes the values as part of creation. The keys
still need to be whitelisted beforehand (step 2 above):

```js
await metronome.post('/v1/customers', {
  name: 'Acme Corp',
  ingest_aliases: ['acme_corp'],
  custom_fields: {
    customer_type: 'standalone',
    external_id: 'acme_corp',
    crm_id: '<CRM_ID>',
  },
});
```

No equivalent shortcut exists for `commit` / `contract` / `credit` /
`invoice` - for those, you `setValues` after the entity is created.
`/v2/contracts/edit` does accept `custom_fields` inside `add_commits[]`
entries during commit creation - but keys there are still subject to the
`commit` whitelist, and failures surface as `400 Invalid custom field
keys: <key>` on the edit call.

---

## Idempotent `addKey` helper

```js
async function registerKey(entity, key) {
  try {
    await metronome.post('/v1/customFields/addKey', {
      entity, key, enforce_uniqueness: false,
    });
    return { status: 'created' };
  } catch (err) {
    const status = err.response?.status;
    const msg = err.response?.data?.message || '';
    if (status === 400 && /already exists/i.test(msg)) return { status: 'exists' };
    if (status === 409) return { status: 'exists' };
    throw err;
  }
}
```

Safe to run on every deploy; registration is one-way.

---

## Common failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `400 Invalid custom field keys: <key>` on `setValues` | Key not whitelisted for that entity | `addKey` first with the right `entity` |
| `400 Invalid custom field keys: <key>` on `POST /v1/customers` with `custom_fields` | Same - whitelist against `entity: 'customer'` | `addKey` before the create call |
| `400 Invalid custom field keys: <key>` on `/v2/contracts/edit add_commits` | Whitelist is for `entity: 'commit'`, not `contract` | Register with `entity: 'commit'` |
| `400` complaining about value length | >200 chars | Truncate client-side |
| Partial write (one key succeeded, others didn't) | Not possible - Metronome fails the whole batch | Split your write, or whitelist all keys first |
| `409` on `addKey` | Already whitelisted | Treat as success |
| Value appears to "disappear" | `setValues` does NOT preserve keys outside the call? **It does** - verify your client didn't pass an object missing those keys | Always read-modify-write if unsure |

---

## Anti-patterns

1. **Retrying `setValues` with the same failing key.** Won't start working,
   whitelist first.
2. **Using a single shared whitelist for customer + commit.** Add per
   entity type.
3. **Embedding long strings.** 200-char limit is hard; store externally
   and reference an ID.
4. **Trusting Metronome to `addKey` implicitly on first write.** It
   doesn't. Keys only appear via explicit `addKey`.
5. **Using `custom_fields` on create for a commit when the key isn't
   whitelisted against `entity: 'commit'`.** The contract `edit` call will
   fail; you'll think you need to edit the contract when the real fix is
   `addKey`.

---

## See also

- `metronome-danger-zone/references/endpoint-matrix.md` §8 - authoritative
  path list.
- `metronome-danger-zone/SKILL.md` §1.6 - custom-field writes on
  commits/contracts.
- `metronome-packages-contracts` - the commit payload shape; custom fields
  are passed inside `add_commits[].custom_fields`, bound to the `commit`
  whitelist.
