<!-- KAAF-GENERATED — do not edit by hand. Regenerate with scripts/architecture/generate.sh. -->

# Component — analytics-data-quality (C4 L3)

`analytics-data-quality` at `packages/data-quality` — confidence `verified`. 2 declared public entry point(s), 1 dependency(ies), 1 dependent(s).

```mermaid
graph TB
  subgraph analytics_data_quality_box["analytics-data-quality"]
    ep_packages_data_quality_package_json["packages/data-quality/package.json"]
    ep_packages_data_quality_src_index_ts["packages/data-quality/src/index.ts"]
  end
  analytics_shared_types["analytics-shared-types<br/>packages/shared-types<br/>verified"]
  analytics_data_quality_box --> analytics_shared_types
  analytics_api["analytics-api<br/>apps/api<br/>verified"]
  analytics_api --> analytics_data_quality_box
```

**Reading this diagram**

- Solid arrow: a dependency declared in a `kaaf.module.json` manifest.
- Dotted arrow: a real import discovered in the source that no manifest declares — see `.ai/drift.json`.
- Node outline reflects confidence: solid = `verified`, dashed = `documented` or `derived`.
<!-- kaaf:bodyDigest=4c6aa18b51cc3e42f8883004f32e8920d5ceb29d8676915862d5dc08de26fc4d -->
