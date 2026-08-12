<!-- KAAF-GENERATED — do not edit by hand. Regenerate with scripts/architecture/generate.sh. -->

# Component — analytics-api (C4 L3)

`analytics-api` at `apps/api` — confidence `verified`. 3 declared public entry point(s), 4 dependency(ies), 0 dependent(s).

```mermaid
graph TB
  subgraph analytics_api_box["analytics-api"]
    ep_apps_api_package_json["apps/api/package.json"]
    ep_apps_api_src_app_ts["apps/api/src/app.ts"]
    ep_apps_api_src_server_ts["apps/api/src/server.ts"]
  end
  analytics_ai_engine["analytics-ai-engine<br/>packages/ai-engine<br/>verified"]
  analytics_api_box --> analytics_ai_engine
  analytics_data_quality["analytics-data-quality<br/>packages/data-quality<br/>verified"]
  analytics_api_box --> analytics_data_quality
  analytics_engine["analytics-engine<br/>packages/analytics-engine<br/>verified"]
  analytics_api_box --> analytics_engine
  analytics_shared_types["analytics-shared-types<br/>packages/shared-types<br/>verified"]
  analytics_api_box --> analytics_shared_types
```

**Reading this diagram**

- Solid arrow: a dependency declared in a `kaaf.module.json` manifest.
- Dotted arrow: a real import discovered in the source that no manifest declares — see `.ai/drift.json`.
- Node outline reflects confidence: solid = `verified`, dashed = `documented` or `derived`.
<!-- kaaf:bodyDigest=302aa9265b6d14cc1f6bc0d166718bcd3b6b00dd2430b8939bd7e0cfabf2f412 -->
