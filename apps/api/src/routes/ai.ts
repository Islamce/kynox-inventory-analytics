import { Router } from 'express';
import { z } from 'zod';
import { createProvider, askOrchestrator, type EvidencePackage } from '@kynox/ai-engine';
import type { AiEvidence } from '@kynox/shared-types';
import { db } from '../db';
import { config } from '../config';
import { requireAuth, requirePermission } from '../middleware/auth';
import { asyncHandler, HttpError } from '../middleware/errors';
import { audit } from '../services/audit';
import * as svc from '../services/analytics';

export const aiRouter = Router();
aiRouter.use(requireAuth, requirePermission('use_ai'));

const chatSchema = z.object({
  question: z.string().min(3).max(20_000), // hard schema cap; the configurable limit is enforced below
  stockDatasetId: z.number().int().positive().optional(),
  movementsDatasetId: z.number().int().positive().optional(),
});

/**
 * Daily usage limits (requests per user, requests + tokens per organisation).
 * Counted from ai_logs, so limits survive restarts and are auditable.
 */
async function enforceDailyLimits(userId: number): Promise<void> {
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);

  const [{ userCount }] = await db('ai_logs')
    .where({ user_id: userId }).where('created_at', '>=', dayStart)
    .count({ userCount: '*' });
  if (Number(userCount) >= config.ai.userDailyLimit) {
    throw new HttpError(429, `Daily AI request limit reached (${config.ai.userDailyLimit} per user). Try again tomorrow or ask an administrator to raise AI_USER_DAILY_LIMIT.`);
  }

  const [{ orgCount }] = await db('ai_logs')
    .where('created_at', '>=', dayStart)
    .count({ orgCount: '*' });
  if (Number(orgCount) >= config.ai.orgDailyLimit) {
    throw new HttpError(429, 'Organisation-wide daily AI request limit reached.');
  }

  const [{ tokens }] = await db('ai_logs')
    .where('created_at', '>=', dayStart)
    .sum({ tokens: db.raw('coalesce(input_tokens,0) + coalesce(output_tokens,0)') });
  if (Number(tokens ?? 0) >= config.ai.orgDailyTokenLimit) {
    throw new HttpError(429, 'Organisation-wide daily AI token budget exhausted.');
  }
}

/**
 * Governed natural-language analytics. The pipeline is:
 * question -> deterministic metric collection -> evidence package ->
 * agent orchestration -> governance checks -> answer with evidence.
 * The AI never queries the database and never computes core metrics.
 */
aiRouter.post('/chat', asyncHandler(async (req, res) => {
  const enabled = await svc.getConfig('ai_feature_enabled', true);
  if (!enabled) throw new HttpError(503, 'AI features are disabled by the administrator.');
  const body = chatSchema.parse(req.body);
  if (body.question.length > config.ai.maxPromptChars) {
    throw new HttpError(400, `Question exceeds the configured maximum of ${config.ai.maxPromptChars} characters.`);
  }
  const provider = createProvider(config.ai);
  if (provider) await enforceDailyLimits(req.user!.id);

  const metrics: AiEvidence[] = [];
  const findings: Record<string, unknown> = {};
  const limitations: string[] = [];
  let datasetName: string | null = null;
  let period: string | null = null;

  if (body.stockDatasetId) {
    const ds = await svc.requireDataset(body.stockDatasetId, 'stock');
    datasetName = `${ds.name} v${(ds as unknown as { version: number }).version ?? 1}`;
    period = ds.period_start && ds.period_end ? `${ds.period_start}..${ds.period_end}` : null;

    const position = await svc.inventoryPosition(body.stockDatasetId);
    metrics.push(
      { metric: 'total_inventory_value', value: position.totals.value, source: 'inventory-position' },
      { metric: 'total_materials', value: position.totals.materials, source: 'inventory-position' },
      { metric: 'blocked_value', value: position.totals.blocked, source: 'inventory-position' },
    );
    findings.position = { byGroup: position.byGroup.slice(0, 10), byPlant: position.byPlant.slice(0, 10) };

    const aging = await svc.agingAnalysis(body.stockDatasetId, 'last_movement');
    findings.aging = aging.summary;

    const categories = await svc.movementCategoryAnalysis(body.stockDatasetId, body.movementsDatasetId);
    metrics.push(
      { metric: 'slow_moving_value', value: categories.summary.slowMoving.value, source: 'movement-categories' },
      { metric: 'non_moving_value', value: categories.summary.nonMoving.value, source: 'movement-categories' },
    );
    findings.movementCategories = {
      summary: categories.summary,
      top: categories.results
        .filter((r) => r.category !== 'active')
        .sort((a, b) => b.stockValue - a.stockValue)
        .slice(0, 15),
    };

    const shortage = await svc.shortageAnalysis(body.stockDatasetId, body.movementsDatasetId);
    metrics.push({ metric: 'shortage_risk_materials', value: shortage.results.length, source: 'shortage-analysis' });
    findings.shortages = { summary: shortage.summary, top: shortage.results.slice(0, 15) };

    const health = await svc.healthAnalysis(body.stockDatasetId, body.movementsDatasetId);
    metrics.push({ metric: 'inventory_health_score', value: health.score, source: 'health-index' });
    findings.healthExplanation = health.explanation;

    if (body.movementsDatasetId) {
      const excess = await svc.excessAnalysis(body.stockDatasetId, 'above_coverage_target', body.movementsDatasetId);
      metrics.push({ metric: 'excess_value_above_coverage_target', value: excess.totalExcessValue, source: 'excess-analysis' });
      findings.excess = { method: excess.method, top: excess.results.slice(0, 15) };
    } else {
      limitations.push('No movements dataset linked: excess, turnover and consumption evidence is unavailable.');
    }
  } else {
    limitations.push('No dataset selected: the question can only be answered in general terms, without figures.');
  }

  if (body.movementsDatasetId) {
    const consumption = await svc.consumptionAnalysis(body.movementsDatasetId);
    metrics.push({ metric: 'total_consumption_value', value: consumption.stats.totalValue, source: 'consumption-analysis' });
    findings.consumption = {
      stats: consumption.stats,
      anomalies: consumption.anomalies,
      topConsumers: consumption.topConsumers?.slice(0, 10),
    };
  }

  const pkg: EvidencePackage = {
    datasetId: body.stockDatasetId ?? body.movementsDatasetId ?? null,
    datasetName,
    period,
    filters: {},
    // Data minimisation: cap the evidence records sent to the external provider.
    metrics: metrics.slice(0, config.ai.maxEvidenceRecords),
    findings,
    dataLimitations: limitations,
  };

  const response = await askOrchestrator(provider, body.question, pkg, {
    maxResponseTokens: config.ai.maxResponseTokens,
    timeoutMs: config.ai.timeoutMs,
    retries: config.ai.retries,
  });

  await db('ai_logs').insert({
    user_id: req.user!.id,
    dataset_id: pkg.datasetId,
    question: body.question,
    provider: response.provider,
    model: response.model,
    governance_passed: response.governance.passed,
    insight_count: response.insights.length,
    input_tokens: response.usage.inputTokens,
    output_tokens: response.usage.outputTokens,
  });
  await audit({
    action: 'ai_query', userId: req.user!.id, entityType: 'dataset', entityId: pkg.datasetId ?? undefined,
    newValue: { questionLength: body.question.length, governancePassed: response.governance.passed },
    sourceIp: req.ip,
  });

  res.json(response);
}));

aiRouter.get('/status', asyncHandler(async (_req, res) => {
  const provider = createProvider(config.ai);
  const enabled = await svc.getConfig('ai_feature_enabled', true);
  res.json({
    enabled,
    configured: provider !== null,
    provider: provider?.name ?? null,
    model: provider?.model ?? null,
  });
}));

aiRouter.get('/history', asyncHandler(async (req, res) => {
  const rows = await db('ai_logs').where({ user_id: req.user!.id }).orderBy('id', 'desc').limit(50);
  res.json({ history: rows });
}));
