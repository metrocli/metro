# input-reference
- schemaVersion: `metro.docs.input-reference.v1`
- apiAccess: `none`
## Summary

```json
{
  "structuredInputFormatLabel": "JSON/YAML",
  "supportedExtensionCount": 3,
  "normalizationModes": [
    "shape",
    "api-request"
  ],
  "outputSchemaVersion": "metro.input.normalize.v1",
  "liveApiAccess": "none"
}
```

## supportedFormats

| id | extensions | parser | status | roundTripOutput | notes |
| --- | --- | --- | --- | --- | --- |
| json | .json | JSON.parse | supported | stable-json | JSON is the canonical machine output contract., Input object keys are sorted during canonicalization before hashing. |
| yaml | .yaml, .yml | metronome-cli/src/input/files.js parseSimpleYaml | supported-subset | stable-json | The local YAML adapter supports the reviewed fixture subset: mappings, sequences, scalars, and JSON-style inline flow values., Advanced YAML features such as anchors, tags, and multi-document streams are intentionally unsupported until a reviewed input contract needs them. |


## normalizationModes

| id | command | targetType | validator | normalizedValue | nextLocalEvidence | sources |
| --- | --- | --- | --- | --- | --- | --- |
| shape | metro input normalize --shape <shape> --file <input.json\|yaml> [--json] | Workflow shape | validateShapeInput | The original structured input canonicalized with sorted object keys. | metro validate --shape <shape> --file <input.json\|yaml> --json | docs/metronome-cli/one-goal.md, docs/metronome-cli/SHAPE_CATALOG.md, metronome-cli/src/input/normalize.js, metronome-cli/src/validators/index.js |
| api-request | metro input normalize --api <endpoint-id> --file <input.json\|yaml> [--json] | Reviewed expert API endpoint ID | validateApiEndpointRequest | The endpoint request envelope with body, query, path, evidence, and metadata keys canonicalized. | metro api validate <endpoint-id> --file <request.json\|yaml> --json | docs/metronome-cli/one-goal.md, docs/metronome-cli/CLI_ARCHITECTURE.md, metronome-cli/src/input/normalize.js, metronome-cli/src/api-catalog/validation.js |


## proofCommands

- `node metronome-cli/bin/metro.js input normalize --shape pro-annual --file metronome-cli/test/fixtures/pro-annual-valid.yaml --json`
- `node metronome-cli/bin/metro.js input normalize --api contracts.create --file metronome-cli/test/fixtures/api-contracts-create-valid.yaml --json`
- `npm --prefix metronome-cli run test:golden`
- `node docs/metronome-cli/site/verify-site.js`


## sources

- `docs/metronome-cli/one-goal.md`
- `docs/metronome-cli/CLI_ARCHITECTURE.md`
- `docs/metronome-cli/VALIDATION_AND_GUARDRAILS.md`
- `metronome-cli/src/input/files.js`
- `metronome-cli/src/input/normalize.js`
- `metronome-cli/src/api-catalog/validation.js`
- `metronome-cli/test/golden/input/normalize.pro-annual-yaml.json`
- `metronome-cli/test/golden/input/normalize.api-contracts-create-yaml.json`


## Agent notes

- Prefer `--json` when scripting parsers; use `--markdown` when loading context into an agent.
- Never treat HTML as the source of truth — regenerate from `metro docs <ref> --markdown`.
- Live reads/writes still require tenant flags + confirmation tokens.

