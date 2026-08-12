<!-- KAAF-GENERATED — do not edit by hand. Regenerate with scripts/architecture/generate.sh. -->

# Containers (C4 L2)

Every module and the dependencies between them. 10 module(s).

```mermaid
graph LR
  analytics_ai_engine["analytics-ai-engine<br/>packages/ai-engine<br/>verified"]
  analytics_api["analytics-api<br/>apps/api<br/>verified"]
  analytics_data_quality["analytics-data-quality<br/>packages/data-quality<br/>verified"]
  analytics_deployment["analytics-deployment<br/>scripts/deployment<br/>verified"]
  analytics_engine["analytics-engine<br/>packages/analytics-engine<br/>verified"]
  analytics_fixtures["analytics-fixtures<br/>scripts<br/>verified"]
  analytics_kaaf_tooling["analytics-kaaf-tooling<br/>scripts/architecture<br/>verified"]
  analytics_runtime_entry["analytics-runtime-entry<br/>.<br/>verified"]
  analytics_shared_types["analytics-shared-types<br/>packages/shared-types<br/>verified"]
  analytics_web["analytics-web<br/>apps/web<br/>verified"]
  analytics_ai_engine --> analytics_shared_types
  analytics_api --> analytics_ai_engine
  analytics_api --> analytics_data_quality
  analytics_api --> analytics_engine
  analytics_api --> analytics_shared_types
  analytics_data_quality --> analytics_shared_types
  analytics_engine --> analytics_shared_types
  style analytics_ai_engine stroke-width:2px
  style analytics_api stroke-width:2px
  style analytics_data_quality stroke-width:2px
  style analytics_deployment stroke-width:2px
  style analytics_engine stroke-width:2px
  style analytics_fixtures stroke-width:2px
  style analytics_kaaf_tooling stroke-width:2px
  style analytics_runtime_entry stroke-width:2px
  style analytics_shared_types stroke-width:2px
  style analytics_web stroke-width:2px
```

**Reading this diagram**

- Solid arrow: a dependency declared in a `kaaf.module.json` manifest.
- Dotted arrow: a real import discovered in the source that no manifest declares — see `.ai/drift.json`.
- Node outline reflects confidence: solid = `verified`, dashed = `documented` or `derived`.
<!-- kaaf:bodyDigest=cbea9ecf7d46893832a847f6d7492588f832679faf561fa42d54dc8384dafa83 -->
