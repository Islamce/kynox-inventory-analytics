<!-- KAAF-GENERATED — do not edit by hand. Regenerate with scripts/architecture/generate.sh. -->

# Flow — Serve an analytics surface from canonical transactions

Serve an analytics surface from canonical transactions — declared by `analytics-api` in `apps/api/kaaf.module.json`.

```mermaid
sequenceDiagram
  autonumber
  participant analytics_web as analytics-web
  participant analytics_api_surface as analytics-api-surface
  participant database as database
  participant analytics_engine as analytics-engine
  analytics_web->>analytics_api_surface: request an analytics surface for a dataset
  analytics_api_surface->>database: load canonical transactions for the dataset
  analytics_api_surface->>analytics_engine: compute the requested analytic as a pure function
  analytics_engine-->>analytics_web: computed result
```
<!-- kaaf:bodyDigest=0eb1e9233519326ab9b3d335c02543d4c38eab9b14b1a69a9f49e2a2c19cac04 -->
