<!-- KAAF-GENERATED — do not edit by hand. Regenerate with scripts/architecture/generate.sh. -->

# Generated diagrams

Generated from the same facts as `../architecture.json`. There is no separate
diagram source to keep in step — a module boundary change appears here in the
same commit that makes it.

| Diagram | Level |
|---|---|
| [component-analytics-ai-engine.md](component-analytics-ai-engine.md) | Component (L3) |
| [component-analytics-api.md](component-analytics-api.md) | Component (L3) |
| [component-analytics-data-quality.md](component-analytics-data-quality.md) | Component (L3) |
| [component-analytics-deployment.md](component-analytics-deployment.md) | Component (L3) |
| [component-analytics-engine.md](component-analytics-engine.md) | Component (L3) |
| [component-analytics-fixtures.md](component-analytics-fixtures.md) | Component (L3) |
| [component-analytics-kaaf-tooling.md](component-analytics-kaaf-tooling.md) | Component (L3) |
| [component-analytics-runtime-entry.md](component-analytics-runtime-entry.md) | Component (L3) |
| [component-analytics-shared-types.md](component-analytics-shared-types.md) | Component (L3) |
| [component-analytics-web.md](component-analytics-web.md) | Component (L3) |
| [container.md](container.md) | Container (L2) |
| [context.md](context.md) | Context (L1) |
| [flow-analytics-api-ingest-dataset.md](flow-analytics-api-ingest-dataset.md) | Flow (sequence) |
| [flow-analytics-api-serve-analytics.md](flow-analytics-api-serve-analytics.md) | Flow (sequence) |

Diagrams are split above 20 nodes rather than shrunk
(docs/kaaf/STANDARDS.md §5). Code-level (L4) diagrams are generated on demand and
never committed.

**Reading this diagram**

- Solid arrow: a dependency declared in a `kaaf.module.json` manifest.
- Dotted arrow: a real import discovered in the source that no manifest declares — see `.ai/drift.json`.
- Node outline reflects confidence: solid = `verified`, dashed = `documented` or `derived`.
<!-- kaaf:bodyDigest=0804f1908bc75d12877875a179a706a6c4fb8966bba25f46ad1a23d6fc05bd9b -->
