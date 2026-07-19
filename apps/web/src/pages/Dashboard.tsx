import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet } from '../lib/api';
import { useWorkspaceIds } from '../components/Layout';
import { Card, EmptyState, ErrorState, Kpi, Spinner, Badge } from '../components/ui';
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
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h1 className="text-xl font-bold">Executive Dashboard</h1>
        <p className="text-sm text-slate-500">
          Dataset: {data.dataset.name} · Period {data.dataset.periodStart ?? 'n/a'} → {data.dataset.periodEnd ?? 'n/a'}
        </p>
      </div>

      {data.notes.map((n) => (
        <p key={n} className="text-sm bg-sky-50 border border-sky-200 text-sky-900 rounded-lg px-3 py-2">{n}</p>
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
        <Card title="Top shortage risks" subtitle="Highest priority exceptions" actions={<Link className="text-sm text-sky-700" to="/inventory">Drill down →</Link>}>
          {data.topShortages.length === 0
            ? <EmptyState title="No shortage risks detected" />
            : (
              <ul className="divide-y divide-slate-100 text-sm">
                {data.topShortages.map((s) => (
                  <li key={s.material + s.reason} className="py-2 flex items-start gap-2">
                    <Badge value={s.risk} />
                    <div>
                      <Link to={`/materials?material=${encodeURIComponent(s.material)}`} className="font-medium text-sky-800">{s.material}</Link>
                      <p className="text-slate-500">{s.reason}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
        </Card>
        <Card title="Top excess stock" subtitle="Working-capital reduction candidates" actions={<Link className="text-sm text-sky-700" to="/inventory">Drill down →</Link>}>
          {data.topExcess.length === 0
            ? <EmptyState title="No excess computed" hint="Link a movements dataset to enable demand-based excess." />
            : (
              <ul className="divide-y divide-slate-100 text-sm">
                {data.topExcess.map((e) => (
                  <li key={e.material} className="py-2 flex justify-between">
                    <Link to={`/materials?material=${encodeURIComponent(e.material)}`} className="font-medium text-sky-800">{e.material}</Link>
                    <span className="tabular-nums">{e.excessValue.toLocaleString()} value · {e.excessQty.toLocaleString()} qty</span>
                  </li>
                ))}
              </ul>
            )}
        </Card>
      </div>
    </div>
  );
}
