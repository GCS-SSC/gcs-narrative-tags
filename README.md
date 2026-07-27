# GCS Narrative Tags

Extension for GCS-SSC that suggests and persists predefined and optional dynamic tags from configured narrative fields such as agreement and proponent descriptions.

## Model

The extension wraps `@browser-tag-extractor/core` and serves that package's bundled `Xenova/all-MiniLM-L12-v2` model through the extension asset pipeline. The worker configures the extractor to load model files from `/extensions/gcs-narrative-tags/models/`.

If the worker cannot initialize, the extension falls back to keyword overlap ranking against each configured tag and alias list.

Stream configuration exposes the extractor scoring controls used by the worker, including predefined thresholds, dynamic tag thresholds, phrase size, semantic and lexical weights, alias boost, negation handling, and browser/embedding cache toggles. These controls are configured per target field, so agreement descriptions and proponent descriptions can be enabled and tuned independently while sharing the same predefined tag vocabulary.

## Host Context

The grouped description slots expect entity-level bilingual description context:

- `kind: 'agreement.descriptions'` with `streamId`, `agreementId`, and `descriptions: { en, fr }`
- `kind: 'proponent.descriptions'` with `agencyId`, `applicantRecipientId`, and `descriptions: { en, fr }`

The extension combines the English and French text into one extractor input and persists one entity-level tag payload for the configured target.

Proponent tags are source-aware. The extension renders when the lead agency has Narrative Tags enabled or when the proponent is attached to an agreement whose agency and stream have Narrative Tags enabled. Each selected tag stores the agency and, when available, stream that supplied the tag definition so the UI and downstream model inputs can show where the tag came from.

The proponent availability rule is implemented by the extension runtime resolver at `server/runtime.ts`; the host only passes the proponent runtime context to the extension.

## Write authorization

Agreement tag writes use the host's two-phase authorization protocol. The route first resolves enough context to reject malformed requests, then starts a database transaction, locks the global authorization state and the extension agency/stream lifecycle scope, re-authorizes the current entity, and re-resolves the agreement and current extension configuration. Validation and the tag upsert run in that same locked transaction, so an agency, stream, extension configuration, or agreement lifecycle change cannot race a stale authorized write.

Hosts embedding this extension must provide `gcsExtension.writeAuthorization` in the request context. The current-scope callback is preferred; the legacy current-entity callback remains supported for compatible hosts.

## Development

```bash
bun install
bun run build:worker
bun run typecheck
bun run test:unit
```
