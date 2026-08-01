<!-- KAAF-GENERATED — do not edit by hand. Regenerate with scripts/architecture/generate.sh. -->

# Flow — Ingest a customer export into the canonical model

Ingest a customer export into the canonical model — declared by `analytics-api` in `apps/api/kaaf.module.json`.

```mermaid
sequenceDiagram
  autonumber
  participant analytics_web as analytics-web
  participant uploads_api as uploads-api
  participant analytics_data_quality as analytics-data-quality
  participant datasets_api as datasets-api
  participant analytics_shared_types as analytics-shared-types
  participant database as database
  analytics_web->>uploads_api: upload a customer export
  uploads_api->>analytics_data_quality: detect file type and propose a column mapping
  analytics_data_quality-->>analytics_web: score quality and propose cleansing
  analytics_web->>datasets_api: create the dataset with approved mapping and cleansing
  datasets_api->>analytics_shared_types: normalize rows into the canonical transaction model and pair transfers and reversals
  datasets_api->>database: persist canonical rows and findings in one transaction
  datasets_api-->>analytics_web: dataset version with normalization findings
```
<!-- kaaf:bodyDigest=bda66cb172561be334568d63e6a29c4b4a3a3df657bae7ba9824ec8a2eca9cc2 -->
