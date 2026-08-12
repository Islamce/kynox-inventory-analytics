import { db } from '../db';
import { HttpError } from '../middleware/errors';
import {
  abcClassify, abcSummary, xyzClassify, abcXyzMatrix,
  inventoryAging, agingSummary, DEFAULT_AGING_BUCKETS,
  movementCategories, excessStock, shortageRisks,
  aggregateByPeriod, consumptionStats, consumptionAnomalies,
  selectBestForecast, safetyStock, reorderPoint, minMaxPlan,
  inventoryHealthIndex, DEFAULT_HEALTH_WEIGHTS,
  round, mean,
  type ExcessMethod, type Granularity, type AgingDateBasis,
} from '@kynox/analytics-engine';
import type { AgingBucket, HealthWeights } from '@kynox/shared-types';

// ---------------------------------------------------------------------------
// Configuration access
// ---------------------------------------------------------------------------

export async function getConfig<T>(key: string, fallback: T): Promise<T> {
  const row = await db('config').where({ key }).first();
  if (!row) return fallback;
  try { return JSON.parse(row.value) as T; } catch { return fallback; }
}

// ---------------------------------------------------------------------------
// Dataset loading
// ---------------------------------------------------------------------------

export interface DatasetMeta {
  id: number;
  name: string;
  kind: string;
  period_start: string | null;
  period_end: string | null;
  quality_scores: string | null;
}

export async function requireDataset(id: number, kind?: string): Promise<DatasetMeta> {
  const ds = await db('datasets').where({ id }).first();
  if (!ds) throw new HttpError(404, `Dataset ${id} not found`);
  if (kind && ds.kind !== kind) {
    throw new HttpError(400, `Dataset ${id} is of kind '${ds.kind}', expected '${kind}'`);
  }
  return ds;
}

export interface StockAgg {
  material: string;
  description: string | null;
  material_group: string | null;
  plant: string | null;
  quantity: number;
  value: number;
  unrestricted: number | null;
  blocked: number | null;
  quality: number | null;
  in_transit: number | null;
  reserved: number | null;
  safety_stock: number | null;
  reorder_point: number | null;
  min_stock: number | null;
  max_stock: number | null;
  lead_time_days: number | null;
  last_receipt: string | null;
  last_issue: string | null;
  last_movement: string | null;
}

/** Aggregates stock lines to material level (quantities summed, planning params taken as max). */
export async function loadStockByMaterial(datasetId: number, plant?: string): Promise<StockAgg[]> {
  let q = db('stock_items').where({ dataset_id: datasetId });
  if (plant) q = q.where({ plant });
  const rows = await q.select('*');
  const byMat = new Map<string, StockAgg>();
  for (const r of rows) {
    const cur = byMat.get(r.material) ?? {
      material: r.material,
      description: r.material_description,
      material_group: r.material_group,
      plant: r.plant,
      quantity: 0, value: 0,
      unrestricted: null, blocked: null, quality: null, in_transit: null, reserved: null,
      safety_stock: null, reorder_point: null, min_stock: null, max_stock: null,
      lead_time_days: null, last_receipt: null, last_issue: null, last_movement: null,
    };
    cur.quantity += r.quantity ?? 0;
    cur.value += r.value ?? 0;
    const addOpt = (k: 'unrestricted' | 'blocked' | 'quality' | 'in_transit' | 'reserved', v: number | null) => {
      if (v != null) cur[k] = (cur[k] ?? 0) + v;
    };
    addOpt('unrestricted', r.unrestricted_qty);
    addOpt('blocked', r.blocked_qty);
    addOpt('quality', r.quality_qty);
    addOpt('in_transit', r.in_transit_qty);
    addOpt('reserved', r.reserved_qty);
    for (const k of ['safety_stock', 'reorder_point', 'min_stock', 'max_stock', 'lead_time_days'] as const) {
      if (r[k] != null) cur[k] = Math.max(cur[k] ?? 0, r[k]);
    }
    const maxDate = (a: string | null, b: string | null) => (!a ? b : !b ? a : (a > b ? a : b));
    // toIsoDate: Postgres returns Date objects, SQLite/MySQL strings — normalise before comparing.
    cur.last_receipt = maxDate(cur.last_receipt, toIsoDate(r.last_receipt_date));
    cur.last_issue = maxDate(cur.last_issue, toIsoDate(r.last_issue_date));
    cur.last_movement = maxDate(cur.last_movement, toIsoDate(r.last_movement_date));
    if (!cur.description && r.material_description) cur.description = r.material_description;
    byMat.set(r.material, cur);
  }
  return [...byMat.values()];
}

export interface MovementAgg {
  material: string;
  issuedQty: number;          // absolute quantity issued (consumption)
  receivedQty: number;
  issuedValue: number;
  lastIssueDate: string | null;
  lastMovementDate: string | null;
  series: { date: string; quantity: number; value: number }[]; // issues only
}

/**
 * Movement-type semantics (SAP convention: even type = reversal of odd type).
 * - Issues (consumption): cost-centre/order/project/delivery issues.
 * - Issue reversals SUBTRACT from consumption instead of being ignored, so
 *   returns do not inflate demand.
 * - Transfers (301/303/305/311/313/315) touch neither consumption nor
 *   receipts: internal relocation is not external demand.
 */
const ISSUE_TYPES = new Set(['201', '221', '231', '241', '251', '261', '281', '291', '601', 'Y01']);
const ISSUE_REVERSAL_TYPES = new Set(['202', '222', '232', '242', '252', '262', '282', '292', '602']);
const RECEIPT_TYPES = new Set(['101', '501', '531', '561']);
const RECEIPT_REVERSAL_TYPES = new Set(['102', '502', '532', '562']);
const TRANSFER_TYPES = new Set(['301', '303', '305', '311', '313', '315']);

/** Normalises a DB-returned date (string on SQLite/MySQL, Date on Postgres) to ISO YYYY-MM-DD. */
export function toIsoDate(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/**
 * Aggregates movements per material for demand/supply analytics
 * (consumption, ABC/XYZ, excess, shortage, health).
 *
 * Prefers the source-neutral `canonical_transactions` model when the dataset
 * has canonical rows (every dataset imported since the Phase 2 normalization
 * engine shipped): demand is `DEMAND_CATEGORIES` (`CONSUMPTION` only, per
 * `@kynox/shared-types`) — `REVERSAL_IN`/`REVERSAL_OUT` are tracked
 * separately and intentionally NOT netted against consumption, unlike the
 * legacy SAP heuristic below. Falls back to the legacy `movements` table +
 * SAP movement-type heuristic for datasets imported before that engine
 * existed (no canonical rows), so older datasets keep working unchanged.
 */
export async function loadMovementsByMaterial(datasetId: number, plant?: string): Promise<Map<string, MovementAgg>> {
  const hasCanonical = await db('canonical_transactions').where({ dataset_id: datasetId }).first('id');
  if (hasCanonical) return loadCanonicalMovementsByMaterial(datasetId, plant);
  return loadLegacyMovementsByMaterial(datasetId, plant);
}

/** Canonical-transactions-based aggregation — see `loadMovementsByMaterial`. */
async function loadCanonicalMovementsByMaterial(datasetId: number, plant?: string): Promise<Map<string, MovementAgg>> {
  let q = db('canonical_transactions').where({ dataset_id: datasetId });
  if (plant) q = q.where({ plant_id: plant });
  const rows = await q
    .select('material_id', 'transaction_category', 'transaction_date', 'receipt_quantity', 'consumption_quantity', 'transaction_value')
    .orderBy('transaction_date');
  const byMat = new Map<string, MovementAgg>();
  for (const r of rows) {
    const posting = toIsoDate(r.transaction_date);
    if (posting === null) continue;
    const cur: MovementAgg = byMat.get(r.material_id) ?? {
      material: r.material_id, issuedQty: 0, receivedQty: 0, issuedValue: 0,
      lastIssueDate: null, lastMovementDate: null, series: [],
    };
    if (r.transaction_category === 'CONSUMPTION') {
      const q0 = r.consumption_quantity ?? 0;
      const val = Math.abs(r.transaction_value ?? 0);
      cur.issuedQty += q0;
      cur.issuedValue += val;
      cur.series.push({ date: posting, quantity: q0, value: val });
      if (!cur.lastIssueDate || posting > cur.lastIssueDate) cur.lastIssueDate = posting;
    } else if (r.transaction_category === 'RECEIPT') {
      cur.receivedQty += r.receipt_quantity ?? 0;
    }
    if (!cur.lastMovementDate || posting > cur.lastMovementDate) cur.lastMovementDate = posting;
    byMat.set(r.material_id, cur);
  }
  return byMat;
}

/**
 * Legacy SAP-movement-type heuristic, retained for datasets imported before
 * the Phase 2 canonical normalization engine existed. Issues are recognised
 * by movement type when present, otherwise by negative quantity sign.
 */
async function loadLegacyMovementsByMaterial(datasetId: number, plant?: string): Promise<Map<string, MovementAgg>> {
  let q = db('movements').where({ dataset_id: datasetId });
  if (plant) q = q.where({ plant });
  const rows = await q.select('*').orderBy('posting_date');
  const byMat = new Map<string, MovementAgg>();
  for (const r of rows) {
    const cur: MovementAgg = byMat.get(r.material) ?? {
      material: r.material, issuedQty: 0, receivedQty: 0, issuedValue: 0,
      lastIssueDate: null, lastMovementDate: null, series: [],
    };
    const qty = r.movement_qty ?? 0;
    const val = r.movement_value ?? 0;
    const mvt = r.movement_type ?? '';
    const posting = toIsoDate(r.posting_date);
    if (posting === null) continue;
    if (mvt && TRANSFER_TYPES.has(mvt)) {
      // Internal transfer: counts as movement activity, never as demand or supply.
      if (!cur.lastMovementDate || posting > cur.lastMovementDate) cur.lastMovementDate = posting;
      byMat.set(r.material, cur);
      continue;
    }
    const isIssue = mvt ? ISSUE_TYPES.has(mvt) : qty < 0;
    const isIssueReversal = mvt ? ISSUE_REVERSAL_TYPES.has(mvt) : false;
    const isReceipt = mvt ? RECEIPT_TYPES.has(mvt) : qty > 0;
    const isReceiptReversal = mvt ? RECEIPT_REVERSAL_TYPES.has(mvt) : false;
    if (isIssue) {
      const q0 = Math.abs(qty);
      cur.issuedQty += q0;
      cur.issuedValue += Math.abs(val);
      cur.series.push({ date: posting, quantity: q0, value: Math.abs(val) });
      if (!cur.lastIssueDate || posting > cur.lastIssueDate) cur.lastIssueDate = posting;
    } else if (isIssueReversal) {
      const q0 = Math.abs(qty);
      cur.issuedQty -= q0;
      cur.issuedValue -= Math.abs(val);
      cur.series.push({ date: posting, quantity: -q0, value: -Math.abs(val) });
    } else if (isReceipt) {
      cur.receivedQty += Math.abs(qty);
    } else if (isReceiptReversal) {
      cur.receivedQty -= Math.abs(qty);
    }
    if (!cur.lastMovementDate || posting > cur.lastMovementDate) cur.lastMovementDate = posting;
    byMat.set(r.material, cur);
  }
  return byMat;
}

export async function movementsPeriod(datasetId: number): Promise<{ start: string; end: string; days: number }> {
  const row = await db('movements').where({ dataset_id: datasetId })
    .min({ start: 'posting_date' }).max({ end: 'posting_date' }).first();
  const start = toIsoDate(row?.start) ?? new Date().toISOString().slice(0, 10);
  const end = toIsoDate(row?.end) ?? start;
  const days = Math.max(1, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86_400_000) + 1);
  return { start, end, days };
}

// ---------------------------------------------------------------------------
// Composite analyses
// ---------------------------------------------------------------------------

export async function inventoryPosition(stockDatasetId: number, plant?: string) {
  const stock = await loadStockByMaterial(stockDatasetId, plant);
  const total = (k: (s: StockAgg) => number | null) =>
    round(stock.reduce((a, s) => a + (k(s) ?? 0), 0), 2);

  const byGroup = new Map<string, { quantity: number; value: number; materials: number }>();
  for (const s of stock) {
    const g = s.material_group ?? 'Unassigned';
    const cur = byGroup.get(g) ?? { quantity: 0, value: 0, materials: 0 };
    cur.quantity += s.quantity; cur.value += s.value; cur.materials += 1;
    byGroup.set(g, cur);
  }
  const byPlantMap = new Map<string, { quantity: number; value: number; materials: number }>();
  const plantRows = await db('stock_items').where({ dataset_id: stockDatasetId })
    .select('plant').sum({ quantity: 'quantity', value: 'value' }).count({ materials: 'id' }).groupBy('plant');
  for (const r of plantRows as { plant: string | null; quantity: unknown; value: unknown; materials: unknown }[]) {
    byPlantMap.set(r.plant ?? 'Unassigned', {
      quantity: round(Number(r.quantity ?? 0), 3), value: round(Number(r.value ?? 0), 2), materials: Number(r.materials),
    });
  }

  return {
    totals: {
      materials: stock.length,
      quantity: total((s) => s.quantity),
      value: total((s) => s.value),
      unrestricted: total((s) => s.unrestricted),
      blocked: total((s) => s.blocked),
      qualityInspection: total((s) => s.quality),
      inTransit: total((s) => s.in_transit),
      reserved: total((s) => s.reserved),
    },
    byGroup: [...byGroup.entries()].map(([group, v]) => ({
      group, quantity: round(v.quantity, 3), value: round(v.value, 2), materials: v.materials,
    })).sort((a, b) => b.value - a.value),
    byPlant: [...byPlantMap.entries()].map(([p, v]) => ({ plant: p, ...v })).sort((a, b) => b.value - a.value),
  };
}

export async function agingAnalysis(stockDatasetId: number, basis: AgingDateBasis, asOf?: string) {
  const ds = await requireDataset(stockDatasetId, 'stock');
  const buckets = await getConfig<AgingBucket[]>('aging_buckets', DEFAULT_AGING_BUCKETS);
  const stock = await loadStockByMaterial(stockDatasetId);
  const asOfDate = asOf ?? toIsoDate(ds.period_end) ?? new Date().toISOString().slice(0, 10);
  const results = inventoryAging(
    stock.map((s) => ({
      material: s.material, quantity: s.quantity, value: s.value,
      lastReceiptDate: s.last_receipt, lastIssueDate: s.last_issue, lastMovementDate: s.last_movement,
    })),
    asOfDate, basis, buckets,
  );
  return { asOfDate, basis, buckets, results, summary: agingSummary(results, buckets) };
}

export async function abcAnalysis(stockDatasetId: number, metric: 'stock_value' | 'consumption_value', movementsDatasetId?: number) {
  const thresholds = await getConfig('abc_thresholds', { aThresholdPct: 80, bThresholdPct: 95 });
  const stock = await loadStockByMaterial(stockDatasetId);
  let items: { material: string; metricValue: number }[];
  if (metric === 'consumption_value') {
    if (!movementsDatasetId) throw new HttpError(400, 'consumption_value ABC requires movementsDatasetId');
    const movements = await loadMovementsByMaterial(movementsDatasetId);
    items = [...movements.values()].map((m) => ({ material: m.material, metricValue: m.issuedValue }));
    // include stocked materials that never moved so they get classified C
    for (const s of stock) {
      if (!movements.has(s.material)) items.push({ material: s.material, metricValue: 0 });
    }
  } else {
    items = stock.map((s) => ({ material: s.material, metricValue: s.value }));
  }
  const results = abcClassify(items, thresholds);
  return { metric, thresholds, results, summary: abcSummary(results) };
}

export async function xyzAnalysis(movementsDatasetId: number, granularity: Granularity = 'month') {
  await requireDataset(movementsDatasetId, 'movements');
  const options = await getConfig('xyz_thresholds', { xMaxCov: 0.5, yMaxCov: 1.0, intermittencyThreshold: 0.4, minPeriods: 4 });
  const movements = await loadMovementsByMaterial(movementsDatasetId);
  const inputs = [...movements.values()].map((m) => ({
    material: m.material,
    series: aggregateByPeriod(m.series, granularity).map((p) => p.quantity),
  }));
  return { granularity, options, results: xyzClassify(inputs, options) };
}

export async function matrixAnalysis(stockDatasetId: number, movementsDatasetId: number) {
  const abc = await abcAnalysis(stockDatasetId, 'consumption_value', movementsDatasetId);
  const xyz = await xyzAnalysis(movementsDatasetId);
  const stock = await loadStockByMaterial(stockDatasetId);
  const valueByMat = new Map(stock.map((s) => [s.material, s.value]));
  const cells = abcXyzMatrix(abc.results, xyz.results).map((cell) => ({
    ...cell,
    stockValue: round(cell.materials.reduce((a, m) => a + (valueByMat.get(m) ?? 0), 0), 2),
    materials: cell.materials.slice(0, 100), // cap payload; counts stay exact
  }));
  return { cells, abcSummary: abc.summary };
}

export async function movementCategoryAnalysis(stockDatasetId: number, movementsDatasetId?: number) {
  const ds = await requireDataset(stockDatasetId, 'stock');
  const nonMovingDays = await getConfig('non_moving_days', 365);
  const slowMovingDays = await getConfig('slow_moving_days', 180);
  const slowTurnoverThreshold = await getConfig('slow_turnover_threshold', 1);
  const stock = await loadStockByMaterial(stockDatasetId);

  const asOf = toIsoDate(ds.period_end) ?? new Date().toISOString().slice(0, 10);
  let period = { days: 365 };
  let movements = new Map<string, MovementAgg>();
  if (movementsDatasetId) {
    movements = await loadMovementsByMaterial(movementsDatasetId);
    period = await movementsPeriod(movementsDatasetId);
  }

  const inputs = stock.map((s) => {
    const m = movements.get(s.material);
    const lastIssue = m?.lastIssueDate ?? s.last_issue ?? null;
    return {
      material: s.material,
      stockQty: s.quantity,
      stockValue: s.value,
      issuedQty: m?.issuedQty ?? 0,
      periodDays: movementsDatasetId ? period.days : 365,
      daysSinceLastIssue: lastIssue
        ? Math.max(0, Math.floor((new Date(asOf).getTime() - new Date(lastIssue).getTime()) / 86_400_000))
        : null,
    };
  });
  const results = movementCategories(inputs, { nonMovingDays, slowMovingDays, slowTurnoverThreshold });
  const summarize = (cat: string) => {
    const inCat = results.filter((r) => r.category === cat);
    return { count: inCat.length, value: round(inCat.reduce((a, r) => a + r.stockValue, 0), 2) };
  };
  return {
    thresholds: { nonMovingDays, slowMovingDays, slowTurnoverThreshold },
    asOfDate: asOf,
    results,
    summary: {
      active: summarize('active'),
      slowMoving: summarize('slow_moving'),
      nonMoving: summarize('non_moving'),
      noData: summarize('no_movement_data'),
    },
  };
}

export async function excessAnalysis(stockDatasetId: number, method: ExcessMethod, movementsDatasetId?: number) {
  const coverageTargetDays = await getConfig('coverage_target_days', 90);
  const stock = await loadStockByMaterial(stockDatasetId);
  let movements = new Map<string, MovementAgg>();
  let periodDays = 365;
  if (movementsDatasetId) {
    movements = await loadMovementsByMaterial(movementsDatasetId);
    periodDays = (await movementsPeriod(movementsDatasetId)).days;
  }
  const inputs = stock.map((s) => {
    const m = movements.get(s.material);
    return {
      material: s.material,
      stockQty: s.quantity,
      stockValue: s.value,
      maxStock: s.max_stock,
      safetyStock: s.safety_stock,
      leadTimeDays: s.lead_time_days,
      avgDailyDemand: m ? m.issuedQty / periodDays : null,
      hasDemand: m ? m.issuedQty > 0 : movementsDatasetId ? false : undefined,
    };
  });
  const results = excessStock(inputs, method, { coverageTargetDays });
  return {
    method,
    coverageTargetDays,
    results,
    totalExcessValue: round(results.reduce((a, r) => a + r.excessValue, 0), 2),
    note: movementsDatasetId ? undefined
      : 'No movements dataset supplied: demand-based excess methods are unavailable; only master-data limits were used.',
  };
}

export async function shortageAnalysis(stockDatasetId: number, movementsDatasetId?: number) {
  const stock = await loadStockByMaterial(stockDatasetId);
  let movements = new Map<string, MovementAgg>();
  let periodDays = 365;
  if (movementsDatasetId) {
    movements = await loadMovementsByMaterial(movementsDatasetId);
    periodDays = (await movementsPeriod(movementsDatasetId)).days;
  }
  const inputs = stock.map((s) => {
    const m = movements.get(s.material);
    const available = s.unrestricted ?? (s.quantity - (s.blocked ?? 0) - (s.quality ?? 0));
    return {
      material: s.material,
      stockQty: s.quantity,
      availableQty: available,
      safetyStock: s.safety_stock,
      reorderPoint: s.reorder_point,
      openReservationsQty: s.reserved,
      openSupplyQty: s.in_transit,
      avgDailyDemand: m ? m.issuedQty / periodDays : null,
      leadTimeDays: s.lead_time_days,
    };
  });
  const results = shortageRisks(inputs);
  return {
    results,
    summary: {
      critical: results.filter((r) => r.risk === 'critical').length,
      high: results.filter((r) => r.risk === 'high').length,
      medium: results.filter((r) => r.risk === 'medium').length,
    },
  };
}

export async function healthAnalysis(stockDatasetId: number, movementsDatasetId?: number) {
  const ds = await requireDataset(stockDatasetId, 'stock');
  const weights = await getConfig<HealthWeights>('health_weights', DEFAULT_HEALTH_WEIGHTS);
  const stock = await loadStockByMaterial(stockDatasetId);
  const totalValue = stock.reduce((a, s) => a + s.value, 0);

  const shortage = await shortageAnalysis(stockDatasetId, movementsDatasetId);
  const shortageCount = shortage.results.length;
  const availability = stock.length === 0 ? null : Math.max(0, 100 - (shortageCount / stock.length) * 100);

  let excess: number | null = null;
  let turnover: number | null = null;
  let obsolescence: number | null = null;
  if (movementsDatasetId) {
    const ex = await excessAnalysis(stockDatasetId, 'above_coverage_target', movementsDatasetId);
    excess = totalValue === 0 ? null : Math.max(0, 100 - (ex.totalExcessValue / totalValue) * 100);
    const cats = await movementCategoryAnalysis(stockDatasetId, movementsDatasetId);
    const nonMovingValue = cats.summary.nonMoving.value;
    obsolescence = totalValue === 0 ? null : Math.max(0, 100 - (nonMovingValue / totalValue) * 100);
    const movements = await loadMovementsByMaterial(movementsDatasetId);
    const periodDays = (await movementsPeriod(movementsDatasetId)).days;
    const totalIssued = [...movements.values()].reduce((a, m) => a + m.issuedValue, 0);
    const annualIssued = totalIssued * (365 / periodDays);
    const turns = totalValue > 0 ? annualIssued / totalValue : null;
    turnover = turns === null ? null : Math.min(100, turns * 25); // 4+ turns/year = 100
  }

  const aging = await agingAnalysis(stockDatasetId, 'last_movement');
  const agedValue = aging.summary
    .filter((b) => b.bucket === '181-365 days' || b.bucket === '> 365 days')
    .reduce((a, b) => a + b.value, 0);
  const knownValue = aging.summary.filter((b) => b.bucket !== 'No movement data').reduce((a, b) => a + b.value, 0);
  const agingScore = knownValue === 0 ? null : Math.max(0, 100 - (agedValue / knownValue) * 100);

  const dataQuality = ds.quality_scores ? JSON.parse(ds.quality_scores).overall : null;

  const result = inventoryHealthIndex(
    { availability, excess, obsolescence, aging: agingScore, turnover, dataQuality },
    weights,
  );
  return { ...result, inputs: { totalValue: round(totalValue, 2), shortageCount, materials: stock.length } };
}

// ---------------------------------------------------------------------------
// Consumption / forecast / planning
// ---------------------------------------------------------------------------

export async function consumptionAnalysis(movementsDatasetId: number, material?: string, granularity: Granularity = 'month') {
  await requireDataset(movementsDatasetId, 'movements');
  const movements = await loadMovementsByMaterial(movementsDatasetId);
  if (material) {
    const m = movements.get(material);
    if (!m) throw new HttpError(404, `No movements found for material '${material}' in this dataset`);
    const series = aggregateByPeriod(m.series, granularity);
    return {
      material,
      granularity,
      series,
      stats: consumptionStats(series),
      anomalies: consumptionAnomalies(series),
    };
  }
  const all: { date: string; quantity: number; value: number }[] = [];
  for (const m of movements.values()) all.push(...m.series);
  const series = aggregateByPeriod(all, granularity);
  const topConsumers = [...movements.values()]
    .sort((a, b) => b.issuedValue - a.issuedValue)
    .slice(0, 20)
    .map((m) => ({ material: m.material, issuedQty: round(m.issuedQty, 3), issuedValue: round(m.issuedValue, 2) }));
  return {
    granularity,
    series,
    stats: consumptionStats(series),
    anomalies: consumptionAnomalies(series),
    topConsumers,
  };
}

export async function forecastAnalysis(movementsDatasetId: number, material: string, granularity: Granularity = 'month') {
  const horizon = await getConfig('forecast_horizon', 6);
  const movements = await loadMovementsByMaterial(movementsDatasetId);
  const m = movements.get(material);
  if (!m) throw new HttpError(404, `No movements found for material '${material}'`);
  const series = aggregateByPeriod(m.series, granularity);
  const seasonLength = granularity === 'month' ? 12 : granularity === 'week' ? 52 : 7;
  const selection = selectBestForecast(series.map((p) => p.quantity), horizon, seasonLength);
  return { material, granularity, horizon, history: series, ...selection };
}

export async function planningProposal(stockDatasetId: number, movementsDatasetId: number, material: string) {
  const serviceLevel = await getConfig('service_level', 0.95);
  const coverageTargetDays = await getConfig('coverage_target_days', 90);
  const stock = await loadStockByMaterial(stockDatasetId);
  const s = stock.find((x) => x.material === material);
  if (!s) throw new HttpError(404, `Material '${material}' not found in the stock dataset`);
  const movements = await loadMovementsByMaterial(movementsDatasetId);
  const m = movements.get(material);
  if (!m || m.series.length === 0) {
    return {
      material,
      insufficientData: true,
      note: 'No issue history for this material in the movements dataset; safety stock and reorder point cannot be proposed statistically.',
    };
  }
  const monthly = aggregateByPeriod(m.series, 'month');
  const demandSeries = monthly.map((p) => p.quantity);
  const leadTimeDays = s.lead_time_days ?? null;
  if (leadTimeDays === null) {
    return {
      material,
      insufficientData: true,
      note: 'No lead time maintained for this material; maintain planned delivery time to enable safety-stock and reorder-point proposals.',
      demandSeries: monthly,
    };
  }
  const ss = safetyStock('statistical_service_level', {
    demandSeries, periodDays: 30, leadTimeDays, serviceLevel,
  });
  const avgDaily = mean(demandSeries) / 30;
  const rop = reorderPoint(avgDaily, leadTimeDays, ss.safetyStock);
  const minMax = minMaxPlan(avgDaily, leadTimeDays, ss.safetyStock, coverageTargetDays);
  return {
    material,
    insufficientData: false,
    current: { safetyStock: s.safety_stock, reorderPoint: s.reorder_point, minStock: s.min_stock, maxStock: s.max_stock },
    proposed: { safetyStock: ss, reorderPoint: rop, minMax },
    demandSeries: monthly,
    assumptions: [
      `Service level ${serviceLevel * 100}% (configurable).`,
      `Lead time ${leadTimeDays} days from the stock dataset.`,
      'All figures are recommendations requiring planner review.',
    ],
  };
}

// ---------------------------------------------------------------------------
// Physical inventory
// ---------------------------------------------------------------------------

export async function physicalInventoryAnalysis(datasetId: number) {
  await requireDataset(datasetId, 'physical_inventory');
  const rows = await db('physical_inventory').where({ dataset_id: datasetId }).select('*');
  if (rows.length === 0) throw new HttpError(404, 'The dataset contains no count rows');
  let absVariance = 0;
  let totalBook = 0;
  let positive = 0;
  let negative = 0;
  let accurate = 0;
  const byMaterial = new Map<string, { book: number; counted: number; variance: number; lines: number }>();
  for (const r of rows) {
    const diff = (r.counted_qty ?? 0) - (r.book_qty ?? 0);
    absVariance += Math.abs(diff);
    totalBook += Math.abs(r.book_qty ?? 0);
    if (diff > 0) positive += diff;
    if (diff < 0) negative += -diff;
    if (diff === 0) accurate += 1;
    const cur = byMaterial.get(r.material) ?? { book: 0, counted: 0, variance: 0, lines: 0 };
    cur.book += r.book_qty ?? 0;
    cur.counted += r.counted_qty ?? 0;
    cur.variance += diff;
    cur.lines += 1;
    byMaterial.set(r.material, cur);
  }
  const worst = [...byMaterial.entries()]
    .map(([material, v]) => ({ material, ...v, absVariance: Math.abs(v.variance) }))
    .sort((a, b) => b.absVariance - a.absVariance)
    .slice(0, 50);
  return {
    lines: rows.length,
    lineAccuracyPct: round((accurate / rows.length) * 100, 1),
    quantityAccuracyPct: totalBook === 0 ? null : round(Math.max(0, 1 - absVariance / totalBook) * 100, 1),
    positiveVariance: round(positive, 3),
    negativeVariance: round(negative, 3),
    worstMaterials: worst,
  };
}
