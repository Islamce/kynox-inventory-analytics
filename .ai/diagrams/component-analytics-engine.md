<!-- KAAF-GENERATED — do not edit by hand. Regenerate with scripts/architecture/generate.sh. -->

# Component — analytics-engine (C4 L3)

`analytics-engine` at `packages/analytics-engine` — confidence `verified`. 2 declared public entry point(s), 1 dependency(ies), 1 dependent(s).

```mermaid
graph TB
  subgraph analytics_engine_box["analytics-engine"]
    ep_packages_analytics_engine_package_json["packages/analytics-engine/package.json"]
    ep_packages_analytics_engine_src_index_ts["packages/analytics-engine/src/index.ts"]
  end
  analytics_shared_types["analytics-shared-types<br/>packages/shared-types<br/>verified"]
  analytics_engine_box --> analytics_shared_types
  analytics_api["analytics-api<br/>apps/api<br/>verified"]
  analytics_api --> analytics_engine_box
```

**Reading this diagram**

- Solid arrow: a dependency declared in a `kaaf.module.json` manifest.
- Dotted arrow: a real import discovered in the source that no manifest declares — see `.ai/drift.json`.
- Node outline reflects confidence: solid = `verified`, dashed = `documented` or `derived`.
<!-- kaaf:bodyDigest=b972a9be075a67d0750aeaad6950ab21d04af59dae33fb31503eff3d7d00aa4b -->
