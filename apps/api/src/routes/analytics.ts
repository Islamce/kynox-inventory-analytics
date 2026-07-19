import { Router } from 'express';
import { requireAuth, requirePermission } from '../middleware/auth';
import { asyncHandler, HttpError } from '../middleware/errors';
import { audit } from '../services/audit';
import * as svc from '../services/analytics';
import type { ExcessMethod, Granularity, AgingDateBasis } from '@kynox/analytics-engine';

export const analyticsRouter = Router();
analyticsRouter.use(requireAuth, requirePermission('run_analysis'));

const intParam = (v: unknown, name: string): number => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `Invalid ${name}`);
  return n;
};
const optInt = (v: unknown): number | undefined => {
  if (v === undefined || v === '') return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'Invalid dataset id parameter');
  return n;
};
const granularity = (v: unknown): Granularity =>
  (['day', 'week', 'month'].includes(String(v)) ? String(v) : 'month') as Granularity;

analyticsRouter.get('/position/:stockDatasetId', asyncHandler(async (req, res) => {
  const id = intParam(req.params.stockDatasetId, 'dataset id');
  await svc.requireDataset(id, 'stock');
  const plant = typeof req.query.plant === 'string' ? req.query.plant : undefined;
  res.json(await svc.inventoryPosition(id, plant));
}));

analyticsRouter.get('/aging/:stockDatasetId', asyncHandler(async (req, res) => {
  const id = intParam(req.params.stockDatasetId, 'dataset id');
  const basis = (['last_receipt', 'last_issue', 'last_movement'].includes(String(req.query.basis))
    ? String(req.query.basis) : 'last_movement') as AgingDateBasis;
  const asOf = typeof req.query.asOf === 'string' ? req.query.asOf : undefined;
  res.json(await svc.agingAnalysis(id, basis, asOf));
}));

analyticsRouter.get('/abc/:stockDatasetId', asyncHandler(async (req, res) => {
  const id = intParam(req.params.stockDatasetId, 'dataset id');
  await svc.requireDataset(id, 'stock');
  const metric = req.query.metric === 'consumption_value' ? 'consumption_value' : 'stock_value';
  res.json(await svc.abcAnalysis(id, metric, optInt(req.query.movementsDatasetId)));
}));

analyticsRouter.get('/xyz/:movementsDatasetId', asyncHandler(async (req, res) => {
  const id = intParam(req.params.movementsDatasetId, 'dataset id');
  res.json(await svc.xyzAnalysis(id, granularity(req.query.granularity)));
}));

analyticsRouter.get('/matrix/:stockDatasetId/:movementsDatasetId', asyncHandler(async (req, res) => {
  res.json(await svc.matrixAnalysis(
    intParam(req.params.stockDatasetId, 'stock dataset id'),
    intParam(req.params.movementsDatasetId, 'movements dataset id'),
  ));
}));

analyticsRouter.get('/movement-categories/:stockDatasetId', asyncHandler(async (req, res) => {
  const id = intParam(req.params.stockDatasetId, 'dataset id');
  res.json(await svc.movementCategoryAnalysis(id, optInt(req.query.movementsDatasetId)));
}));

const EXCESS_METHODS: ExcessMethod[] = ['above_max_stock', 'above_coverage_target', 'above_safety_plus_leadtime', 'no_demand'];

analyticsRouter.get('/excess/:stockDatasetId', asyncHandler(async (req, res) => {
  const id = intParam(req.params.stockDatasetId, 'dataset id');
  await svc.requireDataset(id, 'stock');
  const method = EXCESS_METHODS.includes(req.query.method as ExcessMethod)
    ? req.query.method as ExcessMethod : 'above_coverage_target';
  res.json(await svc.excessAnalysis(id, method, optInt(req.query.movementsDatasetId)));
}));

analyticsRouter.get('/shortage/:stockDatasetId', asyncHandler(async (req, res) => {
  const id = intParam(req.params.stockDatasetId, 'dataset id');
  await svc.requireDataset(id, 'stock');
  res.json(await svc.shortageAnalysis(id, optInt(req.query.movementsDatasetId)));
}));

analyticsRouter.get('/health/:stockDatasetId', asyncHandler(async (req, res) => {
  const id = intParam(req.params.stockDatasetId, 'dataset id');
  res.json(await svc.healthAnalysis(id, optInt(req.query.movementsDatasetId)));
}));

analyticsRouter.get('/consumption/:movementsDatasetId', asyncHandler(async (req, res) => {
  const id = intParam(req.params.movementsDatasetId, 'dataset id');
  const material = typeof req.query.material === 'string' && req.query.material ? req.query.material : undefined;
  res.json(await svc.consumptionAnalysis(id, material, granularity(req.query.granularity)));
}));

analyticsRouter.get('/forecast/:movementsDatasetId', asyncHandler(async (req, res) => {
  const id = intParam(req.params.movementsDatasetId, 'dataset id');
  await svc.requireDataset(id, 'movements');
  const material = String(req.query.material ?? '');
  if (!material) throw new HttpError(400, 'material query parameter is required');
  const result = await svc.forecastAnalysis(id, material, granularity(req.query.granularity));
  await audit({ action: 'analysis_run', userId: req.user!.id, entityType: 'forecast', entityId: material, sourceIp: req.ip });
  res.json(result);
}));

analyticsRouter.get('/planning/:stockDatasetId/:movementsDatasetId', asyncHandler(async (req, res) => {
  const material = String(req.query.material ?? '');
  if (!material) throw new HttpError(400, 'material query parameter is required');
  res.json(await svc.planningProposal(
    intParam(req.params.stockDatasetId, 'stock dataset id'),
    intParam(req.params.movementsDatasetId, 'movements dataset id'),
    material,
  ));
}));

analyticsRouter.get('/physical/:datasetId', asyncHandler(async (req, res) => {
  res.json(await svc.physicalInventoryAnalysis(intParam(req.params.datasetId, 'dataset id')));
}));

// Material 360: everything known about one material across datasets.
analyticsRouter.get('/material360/:stockDatasetId', asyncHandler(async (req, res) => {
  const stockId = intParam(req.params.stockDatasetId, 'stock dataset id');
  await svc.requireDataset(stockId, 'stock');
  const movementsId = optInt(req.query.movementsDatasetId);
  const material = String(req.query.material ?? '');
  if (!material) throw new HttpError(400, 'material query parameter is required');

  const stock = await svc.loadStockByMaterial(stockId);
  const s = stock.find((x) => x.material === material);
  if (!s) throw new HttpError(404, `Material '${material}' not found in the stock dataset`);

  const abc = await svc.abcAnalysis(stockId, movementsId ? 'consumption_value' : 'stock_value', movementsId);
  const abcEntry = abc.results.find((r) => r.material === material) ?? null;

  let consumption: unknown = null;
  let xyzEntry: unknown = null;
  let forecast: unknown = null;
  let planning: unknown = null;
  if (movementsId) {
    try {
      consumption = await svc.consumptionAnalysis(movementsId, material);
    } catch { consumption = null; }
    const xyz = await svc.xyzAnalysis(movementsId);
    xyzEntry = xyz.results.find((r) => r.material === material) ?? null;
    try {
      forecast = await svc.forecastAnalysis(movementsId, material);
    } catch { forecast = null; }
    try {
      planning = await svc.planningProposal(stockId, movementsId, material);
    } catch { planning = null; }
  }

  const categories = await svc.movementCategoryAnalysis(stockId, movementsId);
  const category = categories.results.find((r) => r.material === material) ?? null;
  const shortage = await svc.shortageAnalysis(stockId, movementsId);
  const shortageEntry = shortage.results.find((r) => r.material === material) ?? null;

  res.json({
    material,
    stock: s,
    abc: abcEntry,
    xyz: xyzEntry,
    movementCategory: category,
    shortage: shortageEntry,
    consumption,
    forecast,
    planning,
    availableAnalyses: {
      consumption: movementsId != null,
      forecast: movementsId != null,
      planning: movementsId != null,
      note: movementsId ? undefined : 'Supply a movements dataset id to enable consumption, forecast and planning views.',
    },
  });
}));

// Executive dashboard: one call aggregating the headline KPIs.
analyticsRouter.get('/dashboard/:stockDatasetId', asyncHandler(async (req, res) => {
  const stockId = intParam(req.params.stockDatasetId, 'stock dataset id');
  const ds = await svc.requireDataset(stockId, 'stock');
  const movementsId = optInt(req.query.movementsDatasetId);

  const position = await svc.inventoryPosition(stockId);
  const aging = await svc.agingAnalysis(stockId, 'last_movement');
  const categories = await svc.movementCategoryAnalysis(stockId, movementsId);
  const shortage = await svc.shortageAnalysis(stockId, movementsId);
  const health = await svc.healthAnalysis(stockId, movementsId);
  let excess: Awaited<ReturnType<typeof svc.excessAnalysis>> | null = null;
  if (movementsId) {
    excess = await svc.excessAnalysis(stockId, 'above_coverage_target', movementsId);
  }
  const qualityScores = ds.quality_scores ? JSON.parse(ds.quality_scores) : null;

  res.json({
    dataset: { id: ds.id, name: ds.name, periodStart: ds.period_start, periodEnd: ds.period_end },
    kpis: {
      totalValue: position.totals.value,
      totalMaterials: position.totals.materials,
      blockedValue: position.totals.blocked,
      slowMovingValue: categories.summary.slowMoving.value,
      nonMovingValue: categories.summary.nonMoving.value,
      excessValue: excess?.totalExcessValue ?? null,
      shortageMaterials: shortage.summary.critical + shortage.summary.high + shortage.summary.medium,
      criticalShortages: shortage.summary.critical,
      healthScore: health.score,
      dataQualityScore: qualityScores?.overall ?? null,
    },
    aging: aging.summary,
    byGroup: position.byGroup.slice(0, 10),
    byPlant: position.byPlant,
    topShortages: shortage.results.slice(0, 10),
    topExcess: excess?.results.slice(0, 10) ?? [],
    healthExplanation: health.explanation,
    notes: movementsId ? [] : ['Link a movements dataset to enable excess, turnover and consumption KPIs.'],
  });
}));
