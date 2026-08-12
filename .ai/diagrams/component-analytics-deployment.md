<!-- KAAF-GENERATED — do not edit by hand. Regenerate with scripts/architecture/generate.sh. -->

# Component — analytics-deployment (C4 L3)

`analytics-deployment` at `scripts/deployment` — confidence `verified`. 3 declared public entry point(s), 0 dependency(ies), 0 dependent(s).

```mermaid
graph TB
  subgraph analytics_deployment_box["analytics-deployment"]
    ep_scripts_deployment_deploy_staging_sh["scripts/deployment/deploy-staging.sh"]
    ep_scripts_deployment_preflight_sh["scripts/deployment/preflight.sh"]
    ep_scripts_deployment_rollback_sh["scripts/deployment/rollback.sh"]
  end
```

**Reading this diagram**

- Solid arrow: a dependency declared in a `kaaf.module.json` manifest.
- Dotted arrow: a real import discovered in the source that no manifest declares — see `.ai/drift.json`.
- Node outline reflects confidence: solid = `verified`, dashed = `documented` or `derived`.
<!-- kaaf:bodyDigest=cb897f646a8f7b36996f992a41d57eaac2205cda1c9d238fbf3fbbc1c7730da6 -->
