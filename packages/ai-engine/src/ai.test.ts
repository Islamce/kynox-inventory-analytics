import { describe, it, expect } from 'vitest';
import { routeQuestion, AGENTS, type EvidencePackage } from './agents';
import { governanceChecks, askOrchestrator } from './orchestrator';
import { createProvider, AiNotConfiguredError, type AiProvider } from './providers';
import type { AiInsight } from '@kynox/shared-types';

const emptyPkg: EvidencePackage = {
  datasetId: 1, datasetName: 'test', period: '2026-01..2026-06', filters: {},
  metrics: [{ metric: 'total_inventory_value', value: 125000, source: 'inventory-service' }],
  findings: { excessValue: 40000 },
  dataLimitations: [],
};

describe('agent routing', () => {
  it('routes inventory questions to the inventory analyst', () => {
    const agents = routeQuestion('Which materials have the highest excess stock?');
    expect(agents.map((a) => a.id)).toContain('inventory_analyst');
  });
  it('routes why-questions to the root cause agent', () => {
    const agents = routeQuestion('Why did inventory value increase this month?');
    expect(agents.map((a) => a.id)).toContain('root_cause');
  });
  it('falls back to sensible defaults on unmatched questions', () => {
    const agents = routeQuestion('zzzz qqqq');
    expect(agents.length).toBeGreaterThan(0);
  });
  it('routes executive summaries to the executive advisor', () => {
    const agents = routeQuestion('Summarize inventory performance for senior management');
    expect(agents.map((a) => a.id)).toContain('executive_advisor');
  });
});

describe('governance checks', () => {
  const goodInsight: AiInsight = {
    finding: 'Excess stock is concentrated in 3 materials',
    evidence: [{ metric: 'excessValue', value: 40000, source: 'inventory-service' }],
    likelyCause: 'Hypothesis: over-ordering after a demand spike',
    businessImpact: 'Working capital locked',
    riskLevel: 'high',
    recommendedAction: 'Review the top 3 materials',
    priority: 1,
    suggestedOwner: 'Inventory Manager',
    targetTimeframe: '2 weeks',
    confidence: 'medium',
    assumptions: ['Valuation at book value'],
    dataLimitations: [],
  };

  it('passes well-formed evidenced insights', () => {
    const checks = governanceChecks([goodInsight], emptyPkg);
    expect(checks.every((c) => c.passed)).toBe(true);
  });

  it('fails insights without evidence', () => {
    const bad = { ...goodInsight, evidence: [] };
    const checks = governanceChecks([bad], emptyPkg);
    expect(checks.find((c) => c.name === 'evidence_present')!.passed).toBe(false);
  });

  it('fails untraceable numbers', () => {
    const bad = { ...goodInsight, evidence: [{ metric: 'x', value: 999999321, source: 's' }] };
    const checks = governanceChecks([bad], emptyPkg);
    expect(checks.find((c) => c.name === 'evidence_traceable')!.passed).toBe(false);
  });
});

describe('provider factory', () => {
  it('returns null when unconfigured', () => {
    expect(createProvider({ provider: 'none' })).toBeNull();
    expect(createProvider({ provider: 'anthropic' })).toBeNull(); // no key
  });
  it('creates providers with keys', () => {
    const p = createProvider({ provider: 'anthropic', apiKey: 'k' });
    expect(p?.name).toBe('anthropic');
    expect(p?.model).toBeTruthy();
  });
});

describe('orchestrator', () => {
  it('throws AiNotConfiguredError without a provider', async () => {
    await expect(askOrchestrator(null, 'q', emptyPkg)).rejects.toThrow(AiNotConfiguredError);
  });

  it('parses structured responses and applies governance', async () => {
    const mockProvider: AiProvider = {
      name: 'mock', model: 'mock-1',
      complete: async () => ({ inputTokens: 100, outputTokens: 200, text: JSON.stringify({
        answer: 'Excess is 40000.',
        insights: [{
          finding: 'Excess concentration',
          evidence: [{ metric: 'excessValue', value: 40000, source: 'inventory-service' }],
          likelyCause: 'Hypothesis: over-ordering',
          businessImpact: 'Locked capital',
          riskLevel: 'high',
          recommendedAction: 'Review',
          priority: 1,
          suggestedOwner: 'Inventory Manager',
          targetTimeframe: '2 weeks',
          confidence: 'medium',
          assumptions: [],
          dataLimitations: [],
        }],
      }) }),
    };
    const res = await askOrchestrator(mockProvider, 'How much excess?', emptyPkg);
    expect(res.governance.passed).toBe(true);
    expect(res.insights).toHaveLength(1);
    expect(res.answer).toContain('40000');
    expect(res.usage.inputTokens).toBe(100);
  });

  it('withholds insights that fail governance', async () => {
    const mockProvider: AiProvider = {
      name: 'mock', model: 'mock-1',
      complete: async () => ({ inputTokens: null, outputTokens: null, text: JSON.stringify({
        answer: 'Made-up claim.',
        insights: [{
          finding: 'Fabricated',
          evidence: [],   // no evidence -> governance failure
          recommendedAction: 'Do something',
          confidence: 'high',
        }],
      }) }),
    };
    const res = await askOrchestrator(mockProvider, 'q', emptyPkg);
    expect(res.governance.passed).toBe(false);
    expect(res.insights).toHaveLength(0);
  });
});

describe('agent registry', () => {
  it('defines all 10 analytical agents with guardrails', () => {
    expect(Object.keys(AGENTS)).toHaveLength(10);
    for (const agent of Object.values(AGENTS)) {
      expect(agent.systemPrompt).toContain('Never invent');
    }
  });
});
