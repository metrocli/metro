# Specialist SKILL.md Template

Every Metronome specialist SKILL.md MUST follow this structure.

---

## Frontmatter

```yaml
---
name: metronome-<domain>
description: >-
  <One concise sentence on capability.> Use when the user says "<phrase1>",
  "<phrase2>", "<phrase3>", or asks about <concept1>, <concept2>, <concept3>.
  Also use when <scenario>. Do NOT use for <anti-trigger> - that's
  metronome-<other-specialist>.
---
```

**Description authoring rules (critical for router quality):**
- Must contain **at least 5 concrete trigger phrases** in quotes
- Must list **3+ concept keywords** the user is likely to say
- Must include at least one **anti-trigger** pointing at a sibling specialist
- Under 500 chars if possible; description length affects routing weight

---

## Required sections, in this order

```markdown
# Metronome <Domain>

> Before calling any Metronome endpoint, verify paths against
> `metronome-danger-zone/references/endpoint-matrix.md`. If this skill and
> the endpoint-matrix disagree, the endpoint-matrix wins.

## Purpose

<Two sentences explaining when this skill fires.>

## Prerequisites

See `skills/_metronome-shared/conventions.md` for base URL, auth,
credit types, timestamp rules, and error-shape quick reference.
For **which key** (sandbox vs production) and the CLI safety model, point
readers to the `metro` skill.

## Mental model

<One-paragraph + optional ASCII diagram showing how this capability fits
in the Metronome object graph. Should answer: "where does this sit
relative to customers / contracts / invoices?"

## Endpoint inventory

| Method + Path | Purpose | Official docs | metro |
|---|---|---|---|
| `POST /v1/...` | ... | [slug](https://docs.metronome.com/api-reference/.../....md) | `metro api explain <endpoint-id>` or `-` |

## Working payloads

### <Operation name>

<2-sentence intro about when to use this.>

\`\`\`js
// copy-pasteable; placeholders in <UPPERCASE>
await m.post('/v1/...', {
  // ...
});
\`\`\`

**Notes:**
- <Gotcha 1>
- <Gotcha 2>

## Decision trees

<"When to use X vs Y" tables or bulleted trees for non-obvious choices.>

## Edge cases & gotchas

<Bulleted list, each entry citing the symptom (error message) where possible. Anonymize: never name a customer, person, or real ID.>

## Cross-references

- `metronome-danger-zone` - endpoint-matrix is source of truth
- `metronome-<sibling-1>` - <why you'd also need it>
- `metronome-<sibling-2>` - <why you'd also need it>

## When NOT to use this skill

- <Anti-trigger 1> → use `metronome-<other>` instead
- <Anti-trigger 2> → use `metronome-<other>` instead
```

---

## Style rules

1. **Endpoint paths in `code blocks`** - never plain text, so they're greppable
2. **Cite the official doc page** next to each endpoint, and the `metro` endpoint id where one exists
3. **Doc links as full URLs** - so users can click; don't use relative links
4. **Payloads copy-pasteable** - real code, not pseudocode; where values are placeholders, use `<UPPERCASE_WITH_UNDERSCORES>` so a reader knows what to fill in
5. **No duplication of `conventions.md`** - link, don't copy
6. **No duplication of `endpoint-matrix.md`** - cite, don't copy
7. **Fake examples only** - customers like Acme Corp, IDs like `00000000-0000-4000-8000-000000000001`. Never a real customer, person, email, or tenant ID.
8. **Fact vs advice** - API behavior is stated plainly with a doc link; operating advice is labelled "Recommended practice".
9. **Plain punctuation** - hyphens and commas, no em dashes.

---

## Size targets

- **SKILL.md body**: ~200-600 lines is the sweet spot. More than 800 means you probably need to split into a `references/` companion file.
- **references/\*.md companions**: unlimited, but each one must cover a single concept (a payload catalog, a decision tree, a cookbook, etc.)

---

## What goes in `references/` vs the main SKILL.md

| Lives in SKILL.md | Lives in references/ |
|---|---|
| When to use this capability | Full schema tables per endpoint |
| Common payloads (1-3) | Exhaustive payload catalogs |
| Decision trees | Large cookbook recipes |
| Top gotchas | Anonymized incident write-ups |
| Cross-references to siblings | |

The router evaluates the description against the user's prompt - it does
not read `references/`. Content that helps routing stays in SKILL.md;
content that helps execution once a skill is loaded can live in references.
