import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet } from '../lib/api';
import { useWorkspaceIds } from '../components/Layout';
import { Card, DataTable, EmptyState, ErrorState, Kpi, Spinner, Badge, PageHeader } from '../components/ui';
import { StatTile } from '../components/intelligence';
import { Chart, SEQUENTIAL_BLUE } from '../components/Chart';

interface DashboardData {
  dataset: { id: number; name: string; periodStart: string | null; periodEnd: string | null };
  kpis: Record<string, number | null>;
  aging: { bucket: string; materialCount: number; value: number }[];
  byGroup: { group: string; value: number }[];
  byPlant: { plant: string; value: number }[];
  topShortages: { material: string; reason: string; risk: string; gapQty: number }[];
  topExcess: { material: string; excessValue: number; excessQty: number }[];
  healthExplanation: string[];
  notes: string[];
}

export function DashboardPage() {
  const ws = useWorkspaceIds();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!ws.stockDatasetId) { setData(null); return; }
    setLoading(true);
    setError(null);
    const qs = ws.movementsDatasetId ? `?movementsDatasetId=${ws.movementsDatasetId}` : '';
    apiGet<DashboardData>(`/api/analytics/dashboard/${ws.stockDatasetId}${qs}`)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load dashboard'))
      .finally(() => setLoading(false));
  }, [ws.stockDatasetId, ws.movementsDatasetId]);

  // Phase 2: source-independent transaction categories for the linked
  // movements dataset — receipts/consumption/transfers/returns/adjustments/
  // reversals/unknown, backed by the canonical_transactions engine.

  if (!ws.stockDatasetId) {
    return (
      <EmptyState
        title="No stock dataset selected"
        hint="Upload a stock report (e.g. MB52) in the Data Workspace, then pick it in the header above."
      />
    );
  }
  if (loading) return <Spinner label="Computing dashboard…" />;
  if (error) return <ErrorState message={error} />;
  if (!data) return null;

  const k = data.kpis;
  const health = k.healthScore ?? null;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Executive Dashboard"
        description={<>Dataset: <span className="text-body font-medium">{data.dataset.name}</span> · Period {data.dataset.periodStart ?? 'n/a'} → {data.dataset.periodEnd ?? 'n/a'}</>}
      />

      {data.notes.map((n) => (
        <p key={n} className="text-sm bg-info-soft border border-info/30 text-body rounded-lg px-3 py-2">{n}</p>
      ))}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        <Kpi name="Total inventory value" value={k.totalValue} status="neutral"
          definition="Sum of stock line values in the selected dataset" formula="Σ line value" />
        <Kpi name="Materials" value={k.totalMaterials} status="neutral"
          definition="Distinct materials with stock lines" />
        <Kpi name="Blocked value" value={k.blockedValue} status={(k.blockedValue ?? 0) > 0 ? 'warning' : 'good'}
          definition="Value of stock in blocked status" />
        <Kpi name="Slow-moving value" value={k.slowMovingValue} status={(k.slowMovingValue ?? 0) > 0 ? 'warning' : 'good'}
          definition="Stock value of materials whose last issue exceeds the slow-moving threshold"
          formula="last issue ≥ configured slow-moving days" />
        <Kpi name="Non-moving value" value={k.nonMovingValue} status={(k.nonMovingValue ?? 0) > 0 ? 'critical' : 'good'}
          definition="Stock value of materials with no issue within the non-moving threshold" />
        <Kpi name="Excess value" value={k.excessValue} status={(k.excessValue ?? 0) > 0 ? 'warning' : 'good'}
          definition="Stock value above the configured coverage target" formula="stock − daily demand × coverage days" />
        <Kpi name="Shortage-risk materials" value={k.shortageMaterials}
          status={(k.criticalShortages ?? 0) > 0 ? 'critical' : (k.shortageMaterials ?? 0) > 0 ? 'warning' : 'good'}
          definition="Materials below safety stock / reorder point, or with negative availability" />
        <Kpi name="Critical shortages" value={k.criticalShortages} status={(k.criticalShortages ?? 0) > 0 ? 'critical' : 'good'}
          definition="Negative availability or uncovered reservations" />
        <Kpi name="Inventory health" value={health} unit="/100"
          status={health === null ? 'neutral' : health >= 75 ? 'good' : health >= 50 ? 'warning' : 'critical'}
          definition="Weighted index across availability, excess, obsolescence, aging, turnover and data quality"
          formula={data.healthExplanation.join(' | ')} />
        <Kpi name="Data quality" value={k.dataQualityScore} unit="/100"
          status={(k.dataQualityScore ?? 0) >= 90 ? 'good' : 'warning'}
          definition="Overall data-quality score of the dataset at creation time" />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="Inventory aging" subtitle="Value by days since last movement">
          <Chart option={{
            xAxis: { type: 'category', data: data.aging.map((a) => a.bucket), axisLabel: { rotate: 20 } },
            yAxis: { type: 'value', name: 'Value' },
            series: [{
              type: 'bar',
              data: data.aging.map((a, i) => ({
                value: Math.round(a.value * 100) / 100,
                itemStyle: { color: SEQUENTIAL_BLUE[Math.min(i, SEQUENTIAL_BLUE.length - 1)], borderRadius: [4, 4, 0, 0] },
              })),
              barMaxWidth: 48,
            }],
          }} />
        </Card>
        <Card title="Stock value by material group" subtitle="Top 10 groups">
          <Chart option={{
            yAxis: { type: 'category', data: data.byGroup.map((g) => g.group).reverse() },
            xAxis: { type: 'value', name: 'Value' },
            series: [{
              type: 'bar',
              data: data.byGroup.map((g) => Math.round(g.value * 100) / 100).reverse(),
              itemStyle: { color: '#2a78d6', borderRadius: [0, 4, 4, 0] },
              barMaxWidth: 24,
            }],
          }} />
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="Top shortage risks" subtitle="Highest priority exceptions" actions={<Link className="text-sm text-link" to="/inventory">Drill down →</Link>}>
          {data.topShortages.length === 0
            ? <EmptyState title="No shortage risks detected" />
            : (
              <ul className="divide-y divide-line text-sm">
                {data.topShortages.map((s) => (
                  <li key={s.material + s.reason} className="py-2 flex items-start gap-2">
                    <Badge value={s.risk} />
                    <div>
                      <Link to={`/materials?material=${encodeURIComponent(s.material)}`} className="font-medium text-link">{s.material}</Link>
                      <p className="text-muted">{s.reason}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
        </Card>
        <Card title="Top excess stock" subtitle="Working-capital reduction candidates" actions={<Link className="text-sm text-link" to="/inventory">Drill down →</Link>}>
          {data.topExcess.length === 0
            ? <EmptyState title="No excess computed" hint="Link a movements dataset to enable demand-based excess." />
            : (
              <ul className="divide-y divide-line text-sm">
                {data.topExcess.map((e) => (
                  <li key={e.material} className="py-2 flex justify-between">
                    <Link to={`/materials?material=${encodeURIComponent(e.material)}`} className="font-medium text-link">{e.material}</Link>
                    <span className="tabular-nums">{e.excessValue.toLocaleString()} value · {e.excessQty.toLocaleString()} qty</span>
                  </li>
                ))}
              </ul>
            )}
        </Card>
      </div>

      {ws.movementsDatasetId && <MovementCategoriesCard movementsDatasetId={ws.movementsDatasetId} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Phase 2: movement-category cards + a demand-filtered canonical transaction
// browser for the linked movements dataset. Source-independent — driven by
// canonical_transactions, not SAP movement types.
// ---------------------------------------------------------------------------

interface NormalizationSummary {
  receiptRows: number; consumptionRows: number; transferRows: number; returnRows: number;
  adjustmentRows: number; reversalRows: number; neutralRows: number; unknownTransactionRows: number;
  totalReceiptQuantity: number; totalConsumptionQuantity: number;
}
interface NormalizationDetail {
  sourceSystem: string | null;
  summary: NormalizationSummary | null;
}
interface CanonicalRow extends Record<string, unknown> {
  id: number; source_row_number: number; material_id: string; transaction_date: string | null;
  signed_quantity: number | null; transaction_direction: string; transaction_category: string;
  warehouse_name: string | null; currency: string | null; transaction_value: number | null;
}

/** Categories excluded from the default "demand" view — internal movement, not external demand/supply. */
const NON_DEMAND_CATEGORIES = new Set([
  'TRANSFER_IN', 'TRANSFER_OUT', 'RETURN_IN', 'RETURN_OUT',
  'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'REVERSAL_IN', 'REVERSAL_OUT',
]);

function MovementCategoriesCard({ movementsDatasetId }: { movementsDatasetId: number }) {
  const [norm, setNorm] = useState<NormalizationDetail | null>(null);
  const [rows, setRows] = useState<CanonicalRow[]>([]);
  const [total, setTotal] = useState(0);
  const [demandOnly, setDemandOnly] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      apiGet<NormalizationDetail>(`/api/datasets/${movementsDatasetId}/normalization`),
      apiGet<{ rows: CanonicalRow[]; total: number }>(`/api/datasets/${movementsDatasetId}/canonical?pageSize=500`),
    ])
      .then(([n, c]) => { setNorm(n); setRows(c.rows); setTotal(c.total); })
      .catch(() => { setNorm(null); setRows([]); setTotal(0); })
      .finally(() => setLoading(false));
  }, [movementsDatasetId]);

  if (loading) return <Card title="Transaction categories"><Spinner label="Loading transaction categories…" /></Card>;
  if (!norm?.summary) return null; // pre-Phase-2 dataset: no canonical data to show

  const s = norm.summary;
  const visibleRows = demandOnly ? rows.filter((r) => !NON_DEMAND_CATEGORIES.has(r.transaction_category)) : rows;

  return (
    <Card
      title="Transaction categories"
      subtitle="Source-independent classification of every transaction in the linked movements dataset — never SAP-specific movement codes"
      actions={norm.sourceSystem && <Badge value="info" label={norm.sourceSystem} />}
    >
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5">
        <StatTile label="Receipt" value={s.receiptRows} tone="positive" hint={s.totalReceiptQuantity.toLocaleString()} />
        <StatTile label="Consumption" value={s.consumptionRows} tone="warning" hint={s.totalConsumptionQuantity.toLocaleString()} />
        <StatTile label="Transfers" value={s.transferRows} tone="info" />
        <StatTile label="Returns" value={s.returnRows} tone="info" />
        <StatTile label="Adjustments" value={s.adjustmentRows} tone="warning" />
        <StatTile label="Reversals" value={s.reversalRows} tone="warning" />
        <StatTile label="Unknown" value={s.unknownTransactionRows} tone={s.unknownTransactionRows > 0 ? 'risk' : 'positive'}
          hint="excluded from receipt/consumption KPIs" />
      </div>

      <div className="mt-4 flex items-center justify-between flex-wrap gap-2">
        <div className="inline-flex rounded-lg border border-line-strong overflow-hidden text-sm">
          <button type="button"
            className={`px-3 py-1.5 ${demandOnly ? 'bg-brand text-on-brand' : 'bg-surface text-body hover:bg-sunken'}`}
            onClick={() => setDemandOnly(true)}
          >
            Demand view (default)
          </button>
          <button type="button"
            className={`px-3 py-1.5 border-s border-line-strong ${!demandOnly ? 'bg-brand text-on-brand' : 'bg-surface text-body hover:bg-sunken'}`}
            onClick={() => setDemandOnly(false)}
          >
            All transactions
          </button>
        </div>
        <span className="text-xs text-subtle">
          {demandOnly
            ? 'Transfers, returns, adjustments and reversals are hidden by default — they are internal movement, not external demand or supply.'
            : `Showing every transaction category (${total.toLocaleString()} total in the dataset).`}
        </span>
      </div>

      <div className="mt-2">
        <DataTable<CanonicalRow>
          columns={[
            { key: 'source_row_number', label: 'Row', numeric: true, render: (r) => r.source_row_number + 2 },
            { key: 'material_id', label: 'Material' },
            { key: 'transaction_date', label: 'Date' },
            { key: 'signed_quantity', label: 'Signed qty', numeric: true },
            { key: 'transaction_direction', label: 'Direction' },
            { key: 'transaction_category', label: 'Category' },
            { key: 'warehouse_name', label: 'Warehouse' },
            { key: 'transaction_value', label: 'Value', numeric: true },
          ]}
          rows={visibleRows}
          exportName={`dataset-${movementsDatasetId}-transactions-${demandOnly ? 'demand' : 'all'}`}
        />
      </div>
    </Card>
  );
}
