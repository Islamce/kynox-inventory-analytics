<!-- KAAF-GENERATED — do not edit by hand. Regenerate with scripts/architecture/generate.sh. -->

# Component — analytics-shared-types (C4 L3)

`analytics-shared-types` at `packages/shared-types` — confidence `verified`. 3 declared public entry point(s), 0 dependency(ies), 5 dependent(s).

```mermaid
graph TB
  subgraph analytics_shared_types_box["analytics-shared-types"]
    ep_packages_shared_types_package_json["packages/shared-types/package.json"]
    ep_packages_shared_types_src_index_ts["packages/shared-types/src/index.ts"]
    ep_packages_shared_types_src_logistics_ts["packages/shared-types/src/logistics.ts"]
  end
  analytics_ai_engine["analytics-ai-engine<br/>packages/ai-engine<br/>verified"]
  analytics_ai_engine --> analytics_shared_types_box
  analytics_api["analytics-api<br/>apps/api<br/>verified"]
  analytics_api --> analytics_shared_types_box
  analytics_data_quality["analytics-data-quality<br/>packages/data-quality<br/>verified"]
  analytics_data_quality --> analytics_shared_types_box
  analytics_engine["analytics-engine<br/>packages/analytics-engine<br/>verified"]
  analytics_engine --> analytics_shared_types_box
  analytics_logistics_engine["analytics-logistics-engine<br/>packages/logistics-engine<br/>verified"]
  analytics_logistics_engine --> analytics_shared_types_box
```

**Reading this diagram**

- Solid arrow: a dependency declared in a `kaaf.module.json` manifest.
- Dotted arrow: a real import discovered in the source that no manifest declares — see `.ai/drift.json`.
- Node outline reflects confidence: solid = `verified`, dashed = `documented` or `derived`.
<!-- kaaf:bodyDigest=ec2abfa9e987413061ea3ef33b0c97426c640a15712e7b99dd0ddb0826805f4b -->
