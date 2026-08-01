/**
 * Phase 2 — inventory reconciliation: opening + movements = closing, per
 * material, computed from the source-independent `canonical_transactions`
 * table (never SAP-specific movement types).
 *
 * Honest scope (read before relying on this for period-close sign-off):
 *  - "Opening" comes from OPENING_BALANCE canonical rows if the source
 *    included them; otherwise it is 0 and the computed closing quantity is
 *    simply the net of every transaction in the dataset.
 *  - When a stock dataset is linked, the computed closing quantity is
 *    compared against that dataset's CURRENT stock quantity. This is only a
 *    meaningful check when the movements dataset's period covers the material's
 *    full transaction history since stock was last a known value (an explicit
 *    OPENING_BALANCE, or truly zero) — otherwise treat the variance as
 *    informational, not a bug report.
 *  - Transfer/reversal pairing is best-effort across the current and older
 *    imports within the same tenant boundary. `unpairedTransferRows` and
 *    `unpairedReversalRows` count rows where no safe exact match was found;
 *    that can still be expected when a counterpart is outside the available
 *    history. `transferNet` (the coarser net-sum check) also works for datasets
 *    imported before pairing existed.
 */
import { db } from '../db';
import { round } from '@kynox/analytics-engine';
import { requireDataset, loadStockByMaterial } from './analytics';

const VARIANCE_EPSILON = 0.001;

export interface ReconciliationRow {
  material: string;
  openingQty: number;
  receiptQty: number;
  consumptionQty: number;
  transferNet: number;
  returnNet: number;
  adjustmentNet: number;
  reversalNet: number;
  unknownNet: number;
  computedClosingQty: number;
  reportedClosingQty: number | null;      // from CLOSING_BALANCE canonical rows in this dataset, if any
  reportedStockQty: number | null;        // from the linked stock dataset, if any
  variance: number | null;                // computedClosingQty - reportedStockQty
  variancePct: number | null;
  hasTransferImbalance: boolean;
  unpairedTransferRows: number;
  unpairedReversalRows: number;
  rowCount: number;
  unknownRowCount: number;
}

export interface ReconciliationResult {
  available: boolean;
  note: string | null;
  stockDatasetLinked: boolean;
  results: ReconciliationRow[];
  summary: {
    totalMaterials: number;
    materialsWithReportedClosing: number;
    materialsWithVariance: number;
    materialsWithTransferImbalance: number;
    materialsWithUnpairedTransfers: number;
    materialsWithUnpairedReversals: number;
    materialsWithUnknownTransactions: number;
    totalUnknownRows: number;
  } | null;
}

/** Categories excluded from opening/closing arithmetic on purpose: they are
 * point-in-time snapshots or non-quantity-moving states, not flows. */
const NON_FLOW_CATEGORIES = new Set(['CLOSING_BALANCE']);

export async function reconciliationAnalysis(
  movementsDatasetId: number, stockDatasetId?: number,
): Promise<ReconciliationResult> {
  await requireDataset(movementsDatasetId, 'movements');

  const [{ c: canonicalCount }] = await db('canonical_transactions')
    .where({ dataset_id: movementsDatasetId }).count({ c: '*' }) as unknown as { c: number }[];
  if (Number(canonicalCount) === 0) {
    return {
      available: false,
      note: 'This movements dataset has no canonical transaction data — it predates the normalization engine (Phase 2). Re-import the source file to enable reconciliation.',
      stockDatasetLinked: false,
      results: [],
      summary: null,
    };
  }

  const rows = await db('canonical_transactions').where({ dataset_id: movementsDatasetId })
    .select('material_id', 'transaction_category', 'signed_quantity', 'transfer_id', 'reversal_of_transaction_id');

  const byMat = new Map<string, ReconciliationRow>();
  const get = (material: string): ReconciliationRow => {
    let r = byMat.get(material);
    if (!r) {
      r = {
        material, openingQty: 0, receiptQty: 0, consumptionQty: 0, transferNet: 0, returnNet: 0,
        adjustmentNet: 0, reversalNet: 0, unknownNet: 0, computedClosingQty: 0,
        reportedClosingQty: null, reportedStockQty: null, variance: null, variancePct: null,
        hasTransferImbalance: false, unpairedTransferRows: 0, unpairedReversalRows: 0,
        rowCount: 0, unknownRowCount: 0,
      };
      byMat.set(material, r);
    }
    return r;
  };

  for (const row of rows) {
    const r = get(row.material_id);
    const qty = row.signed_quantity ?? 0;
    const cat = row.transaction_category as string;
    r.rowCount += 1;

    if (cat === 'CLOSING_BALANCE') {
      r.reportedClosingQty = (r.reportedClosingQty ?? 0) + qty;
      continue; // snapshot, not a flow — excluded from computedClosingQty
    }
    if (!NON_FLOW_CATEGORIES.has(cat)) r.computedClosingQty += qty;

    switch (cat) {
      case 'OPENING_BALANCE': r.openingQty += qty; break;
      case 'RECEIPT': r.receiptQty += qty; break;
      case 'CONSUMPTION': r.consumptionQty += qty; break;
      case 'TRANSFER_IN': case 'TRANSFER_OUT':
        r.transferNet += qty;
        if (row.transfer_id == null) r.unpairedTransferRows += 1;
        break;
      case 'RETURN_IN': case 'RETURN_OUT': r.returnNet += qty; break;
      case 'ADJUSTMENT_IN': case 'ADJUSTMENT_OUT': r.adjustmentNet += qty; break;
      case 'REVERSAL_IN': case 'REVERSAL_OUT':
        r.reversalNet += qty;
        if (row.reversal_of_transaction_id == null) r.unpairedReversalRows += 1;
        break;
      case 'UNKNOWN': r.unknownNet += qty; r.unknownRowCount += 1; break;
      default: break; // NEUTRAL / STOCK_COUNT / RESERVATION / BLOCKED_STOCK / QUALITY_INSPECTION
    }
  }

  const stockDatasetLinked = stockDatasetId != null;
  let stockByMaterial: Map<string, number> | null = null;
  if (stockDatasetId != null) {
    await requireDataset(stockDatasetId, 'stock');
    const stock = await loadStockByMaterial(stockDatasetId);
    stockByMaterial = new Map(stock.map((s) => [s.material, s.quantity]));
  }

  const results = [...byMat.values()].map((r) => {
    r.openingQty = round(r.openingQty, 3);
    r.receiptQty = round(r.receiptQty, 3);
    r.consumptionQty = round(r.consumptionQty, 3);
    r.transferNet = round(r.transferNet, 3);
    r.returnNet = round(r.returnNet, 3);
    r.adjustmentNet = round(r.adjustmentNet, 3);
    r.reversalNet = round(r.reversalNet, 3);
    r.unknownNet = round(r.unknownNet, 3);
    r.computedClosingQty = round(r.computedClosingQty, 3);
    if (r.reportedClosingQty != null) r.reportedClosingQty = round(r.reportedClosingQty, 3);
    r.hasTransferImbalance = Math.abs(r.transferNet) > VARIANCE_EPSILON;

    const reportedStock = stockByMaterial?.get(r.material) ?? null;
    r.reportedStockQty = reportedStock === null ? null : round(reportedStock, 3);
    if (r.reportedStockQty !== null) {
      r.variance = round(r.computedClosingQty - r.reportedStockQty, 3);
      r.variancePct = r.reportedStockQty === 0 ? null : round((r.variance / Math.abs(r.reportedStockQty)) * 100, 1);
    }
    return r;
  }).sort((a, b) => Math.abs(b.variance ?? 0) - Math.abs(a.variance ?? 0) || a.material.localeCompare(b.material));

  const summary = {
    totalMaterials: results.length,
    materialsWithReportedClosing: results.filter((r) => r.reportedClosingQty !== null).length,
    materialsWithVariance: results.filter((r) => r.variance !== null && Math.abs(r.variance) > VARIANCE_EPSILON).length,
    materialsWithTransferImbalance: results.filter((r) => r.hasTransferImbalance).length,
    materialsWithUnpairedTransfers: results.filter((r) => r.unpairedTransferRows > 0).length,
    materialsWithUnpairedReversals: results.filter((r) => r.unpairedReversalRows > 0).length,
    materialsWithUnknownTransactions: results.filter((r) => r.unknownRowCount > 0).length,
    totalUnknownRows: results.reduce((a, r) => a + r.unknownRowCount, 0),
  };

  return {
    available: true,
    note: stockDatasetLinked
      ? null
      : 'No stock dataset linked: variance against current stock is unavailable. Only the computed opening/movements/closing breakdown is shown.',
    stockDatasetLinked,
    results,
    summary,
  };
}
