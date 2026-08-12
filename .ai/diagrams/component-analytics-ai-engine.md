<!-- KAAF-GENERATED — do not edit by hand. Regenerate with scripts/architecture/generate.sh. -->

# Component — analytics-ai-engine (C4 L3)

`analytics-ai-engine` at `packages/ai-engine` — confidence `verified`. 2 declared public entry point(s), 1 dependency(ies), 1 dependent(s).

```mermaid
graph TB
  subgraph analytics_ai_engine_box["analytics-ai-engine"]
    ep_packages_ai_engine_package_json["packages/ai-engine/package.json"]
    ep_packages_ai_engine_src_index_ts["packages/ai-engine/src/index.ts"]
  end
  analytics_shared_types["analytics-shared-types<br/>packages/shared-types<br/>verified"]
  analytics_ai_engine_box --> analytics_shared_types
  analytics_api["analytics-api<br/>apps/api<br/>verified"]
  analytics_api --> analytics_ai_engine_box
```

**Reading this diagram**

- Solid arrow: a dependency declared in a `kaaf.module.json` manifest.
- Dotted arrow: a real import discovered in the source that no manifest declares — see `.ai/drift.json`.
- Node outline reflects confidence: solid = `verified`, dashed = `documented` or `derived`.
<!-- kaaf:bodyDigest=33fc19a9f7528c5856d2405f28a36ffa883a3403b4679472da9a3a07aeef24a3 -->
