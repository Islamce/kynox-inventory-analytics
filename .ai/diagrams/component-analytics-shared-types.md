<!-- KAAF-GENERATED — do not edit by hand. Regenerate with scripts/architecture/generate.sh. -->

# Component — analytics-shared-types (C4 L3)

`analytics-shared-types` at `packages/shared-types` — confidence `verified`. 2 declared public entry point(s), 0 dependency(ies), 4 dependent(s).

```mermaid
graph TB
  subgraph analytics_shared_types_box["analytics-shared-types"]
    ep_packages_shared_types_package_json["packages/shared-types/package.json"]
    ep_packages_shared_types_src_index_ts["packages/shared-types/src/index.ts"]
  end
  analytics_ai_engine["analytics-ai-engine<br/>packages/ai-engine<br/>verified"]
  analytics_ai_engine --> analytics_shared_types_box
  analytics_api["analytics-api<br/>apps/api<br/>verified"]
  analytics_api --> analytics_shared_types_box
  analytics_data_quality["analytics-data-quality<br/>packages/data-quality<br/>verified"]
  analytics_data_quality --> analytics_shared_types_box
  analytics_engine["analytics-engine<br/>packages/analytics-engine<br/>verified"]
  analytics_engine --> analytics_shared_types_box
```

**Reading this diagram**

- Solid arrow: a dependency declared in a `kaaf.module.json` manifest.
- Dotted arrow: a real import discovered in the source that no manifest declares — see `.ai/drift.json`.
- Node outline reflects confidence: solid = `verified`, dashed = `documented` or `derived`.
<!-- kaaf:bodyDigest=572a65378a3056d7d222e5176c307ea5be80c12c1c46155835ed0c3ce3d291ca -->
