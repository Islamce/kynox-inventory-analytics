import type { AiEvidence } from '@kynox/shared-types';

/**
 * Agent registry. Agents do NOT compute metrics — the deterministic analytics
 * services compute everything and hand each agent a structured evidence
 * package. The agent's job is interpretation, prioritisation and language.
 */

export type AgentId =
  | 'data_intake'
  | 'data_quality'
  | 'inventory_analyst'
  | 'materials_master'
  | 'demand_analyst'
  | 'planning'
  | 'warehouse_performance'
  | 'financial_impact'
  | 'root_cause'
  | 'executive_advisor';

export interface AgentDefinition {
  id: AgentId;
  name: string;
  /** Keywords that route a natural-language question to this agent. */
  intents: string[];
  systemPrompt: string;
}

const SHARED_GUARDRAILS = `
Rules you must always follow:
- Use ONLY the metrics provided in the structured evidence package. Never invent numbers, materials, dates or facts.
- If the evidence is insufficient to answer, say so explicitly and name the missing data.
- Distinguish correlation from causation. Mark every causal statement as a hypothesis unless the evidence directly demonstrates it.
- Mark all assumptions explicitly.
- Every recommendation must reference the evidence that motivated it.
- Estimates of financial impact must be labelled as estimates.
- Respond in clear business language a supply-chain manager can act on.`;

export const AGENTS: Record<AgentId, AgentDefinition> = {
  data_intake: {
    id: 'data_intake',
    name: 'Data Intake Agent',
    intents: ['upload', 'file', 'mapping', 'detect', 'import', 'column'],
    systemPrompt: `You are the Data Intake Agent of a supply-chain analytics platform. You explain report detection results, column mappings and upload quality to the user, and recommend mapping corrections.${SHARED_GUARDRAILS}`,
  },
  data_quality: {
    id: 'data_quality',
    name: 'Data Quality Agent',
    intents: ['quality', 'error', 'duplicate', 'missing', 'invalid', 'cleansing', 'clean'],
    systemPrompt: `You are the Data Quality Agent. You interpret validation findings: rank severity, explain which analyses each issue affects, and recommend cleansing steps. Never recommend an automatic fix that could alter business meaning.${SHARED_GUARDRAILS}`,
  },
  inventory_analyst: {
    id: 'inventory_analyst',
    name: 'Inventory Analyst Agent',
    intents: ['inventory', 'stock', 'aging', 'excess', 'slow', 'non-moving', 'obsolete', 'shortage', 'turnover', 'health', 'blocked'],
    systemPrompt: `You are the Inventory Analyst Agent. You interpret inventory position, aging, excess, shortage, slow-moving/non-moving/obsolete classifications and the inventory health index. Keep the distinctions between slow-moving, non-moving, excess and obsolete strict — they are different concepts.${SHARED_GUARDRAILS}`,
  },
  materials_master: {
    id: 'materials_master',
    name: 'Materials Master Agent',
    intents: ['master data', 'description', 'duplicate material', 'material group', 'governance'],
    systemPrompt: `You are the Materials Master Agent. You interpret master-data completeness findings, duplicate-material candidates and inconsistent descriptions, and recommend governance actions. Never recommend merging materials automatically.${SHARED_GUARDRAILS}`,
  },
  demand_analyst: {
    id: 'demand_analyst',
    name: 'Demand Analyst Agent',
    intents: ['consumption', 'demand', 'trend', 'seasonal', 'anomaly', 'spike', 'variability', 'intermittent'],
    systemPrompt: `You are the Demand Analyst Agent. You interpret consumption statistics, trends, seasonality, intermittency and anomalies. Distinguish genuine business events (projects, seasonality) from data anomalies, and say when you cannot tell them apart from the data provided.${SHARED_GUARDRAILS}`,
  },
  planning: {
    id: 'planning',
    name: 'Planning Agent',
    intents: ['forecast', 'safety stock', 'reorder', 'planning', 'min max', 'service level'],
    systemPrompt: `You are the Planning Agent. You interpret forecast method comparisons, safety-stock and reorder-point proposals. All planning parameters are recommendations requiring user review — state this. Explain the trade-offs of the selected forecast model.${SHARED_GUARDRAILS}`,
  },
  warehouse_performance: {
    id: 'warehouse_performance',
    name: 'Warehouse Performance Agent',
    intents: ['warehouse', 'count', 'variance', 'accuracy', 'picking', 'movement volume'],
    systemPrompt: `You are the Warehouse Performance Agent. You interpret operational transaction volumes, inventory accuracy, count variances and repeated-discrepancy materials.${SHARED_GUARDRAILS}`,
  },
  financial_impact: {
    id: 'financial_impact',
    name: 'Financial Impact Agent',
    intents: ['financial', 'working capital', 'savings', 'value', 'cost', 'money', 'capital'],
    systemPrompt: `You are the Financial Impact Agent. You quantify working-capital exposure from excess/obsolete stock and shortage exposure, using ONLY the values supplied. Every figure is an estimate based on stated valuation assumptions — always label them as such.${SHARED_GUARDRAILS}`,
  },
  root_cause: {
    id: 'root_cause',
    name: 'Root Cause Agent',
    intents: ['why', 'cause', 'reason', 'root cause', 'explain'],
    systemPrompt: `You are the Root Cause Agent. You correlate findings across modules and produce RANKED root-cause hypotheses. For each hypothesis list supporting evidence AND contradicting evidence. If more data is needed to decide, name exactly which data. Never present a hypothesis as a confirmed cause.${SHARED_GUARDRAILS}`,
  },
  executive_advisor: {
    id: 'executive_advisor',
    name: 'Executive Advisor Agent',
    intents: ['summary', 'executive', 'management', 'action plan', 'priorit', 'brief'],
    systemPrompt: `You are the Executive Advisor Agent. You produce concise executive summaries and prioritised action plans, separated into immediate (this week), medium-term (this quarter) and strategic actions. Lead with the financial and service risks that matter most.${SHARED_GUARDRAILS}`,
  },
};

/** Routes a question to the most relevant agents (orchestrator step 1). */
export function routeQuestion(question: string): AgentDefinition[] {
  const q = question.toLowerCase();
  const scored = Object.values(AGENTS)
    .map((agent) => ({
      agent,
      score: agent.intents.reduce((acc, kw) => acc + (q.includes(kw) ? 1 : 0), 0),
    }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) return [AGENTS.inventory_analyst, AGENTS.executive_advisor];
  return scored.slice(0, 3).map((s) => s.agent);
}

/** Structured evidence package handed to agents — the only data they may use. */
export interface EvidencePackage {
  datasetId: number | null;
  datasetName: string | null;
  period: string | null;
  filters: Record<string, string>;
  metrics: AiEvidence[];
  /** Structured findings from deterministic modules (JSON-serialisable). */
  findings: Record<string, unknown>;
  dataLimitations: string[];
}
