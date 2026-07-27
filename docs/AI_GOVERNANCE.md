# AI Governance Guide

## Principles enforced in code

1. **Deterministic first.** All metrics come from `packages/analytics-engine`
   via the API's analytics services. The AI layer receives a read-only
   **evidence package** (metrics + structured findings + stated limitations)
   and cannot query the database or filesystem.
2. **No unrestricted SQL.** There is no text-to-SQL path anywhere. Questions
   are answered from pre-computed, validated metrics only.
3. **Structured output.** The orchestrator demands strict JSON matching the
   insight schema (finding, evidence, likely cause, impact, risk, action,
   priority, owner, timeframe, confidence, assumptions, limitations).
4. **Governance checks before display** (`packages/ai-engine/src/orchestrator.ts`):
   - `evidence_present` — every insight cites at least one evidence item
   - `confidence_stated` — high/medium/low present on every insight
   - `assumptions_marked` — assumptions array present
   - `evidence_traceable` — cited values must exist in the evidence package
   Failing responses have their **insights withheld**; the UI shows which check
   failed. The plain-language answer is still shown so the user sees what
   happened, but no ungoverned recommendation is presented as an insight.
5. **Honest unavailability.** With `AI_PROVIDER=none` or a missing key, AI
   endpoints return HTTP 503 with a clear message. The platform never
   substitutes fabricated analysis.
6. **Permissioned.** `use_ai` permission required; administrators can disable
   the feature globally (`ai_feature_enabled` config, audited).
7. **Logged.** Every question logs user, dataset, provider, model, governance
   outcome and insight count to `ai_logs`, plus an `ai_query` audit entry.
   Prompts never include secrets; responses never include other users' data
   because the evidence package is built from the caller's selected datasets
   under their own permissions.

## Agent responsibilities

| Agent | Scope |
|---|---|
| Data Intake | detection results, mappings, upload quality |
| Data Quality | issue interpretation, cleansing advice, affected analyses |
| Inventory Analyst | position, aging, excess, shortage, movement categories, health |
| Materials Master | master-data completeness, duplicate candidates, governance actions |
| Demand Analyst | consumption trends, seasonality, intermittency, anomalies |
| Planning | forecast method trade-offs, safety stock / ROP proposals |
| Warehouse Performance | transaction volumes, count variances, accuracy |
| Financial Impact | working-capital exposure — always labelled estimates |
| Root Cause | ranked hypotheses with supporting AND contradicting evidence |
| Executive Advisor | summaries and prioritised action plans (immediate/medium/strategic) |

All agents share hard guardrails embedded in their system prompts: never invent
data; distinguish correlation from causation; mark assumptions; name missing
data instead of filling gaps.

## Data exposure to AI providers

When (and only when) a provider is configured and a user with the `use_ai`
permission asks a question, the outbound request contains: the question, the
aggregated metrics, top-N structured findings (which include material codes,
descriptions and aggregated quantities/values from the selected datasets), the
dataset name and period. It never contains: credentials, user lists, audit
records, raw file contents, or rows beyond the capped top-N findings.
Administrators who must not share business data externally should keep
`AI_PROVIDER=none` or `ai_feature_enabled=false` (both are honoured with an
honest 503).

## Residual prompt-injection risk

Uploaded files can contain adversarial text (e.g. in material descriptions)
that reaches the evidence package. Mitigations: an explicit data-vs-instruction
guardrail in the orchestrator system prompt, governance checks that withhold
insights citing untraceable values, and the structural fact that the AI cannot
execute any action — it only produces text that a human reads. Residual risk:
a manipulated narrative could still mislead a reader; this is why every insight
displays its evidence chain for verification.

## Provider configuration

```
AI_PROVIDER=anthropic|openai|none   # abstraction layer; no provider is hardcoded
AI_MODEL=<optional override>
ANTHROPIC_API_KEY / OPENAI_API_KEY  # environment only, never in code or DB
AI_BASE_URL=<optional gateway>      # Azure-hosted or local models
```

Adding a provider = one class implementing `AiProvider` in
`packages/ai-engine/src/providers.ts`.
