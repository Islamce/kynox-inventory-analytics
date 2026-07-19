import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useWorkspaceIds } from '../components/Layout';
import { useFetch } from './Inventory';
import { Badge, Card, DataTable, EmptyState, ErrorState, Spinner } from '../components/ui';
import { Chart, SEQUENTIAL_BLUE } from '../components/Chart';

export function AbcXyzPage() {
  const ws = useWorkspaceIds();
  const [metric, setMetric] = useState<'stock_value' | 'consumption_value'>('stock_value');

  if (!ws.stockDatasetId) {
    return <EmptyState title="No stock dataset selected" hint="Select one in the header." />;
  }
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">ABC–XYZ Analysis</h1>
      <div className="flex items-center gap-2 text-sm">
        <label htmlFor="abc-metric" className="text-slate-500">ABC metric</label>
        <select
          id="abc-metric" className="border border-slate-300 rounded-lg px-2 py-1 bg-white"
          value={metric}
          onChange={(e) => setMetric(e.target.value as typeof metric)}
        >
          <option value="stock_value">Current stock value</option>
          <option value="consumption_value" disabled={!ws.movementsDatasetId}>Consumption value (needs movements dataset)</option>
        </select>
      </div>
      <AbcSection stockId={ws.stockDatasetId} metric={metric} movementsId={ws.movementsDatasetId} />
      {ws.movementsDatasetId
        ? <>
            <XyzSection movementsId={ws.movementsDatasetId} />
            <MatrixSection stockId={ws.stockDatasetId} movementsId={ws.movementsDatasetId} />
          </>
        : <p className="text-sm bg-sky-50 border border-sky-200 text-sky-900 rounded-lg px-3 py-2">Link a movements dataset to enable XYZ classification and the ABC–XYZ matrix.</p>}
    </div>
  );
}

function AbcSection({ stockId, metric, movementsId }: { stockId: number; metric: string; movementsId: number | null }) {
  const { data, error, loading } = useFetch<{
    thresholds: { aThresholdPct: number; bThresholdPct: number };
    results: { material: string; metricValue: number; cumulativePct: number; abcClass: string }[];
    summary: { abcClass: string; materialCount: number; metricValue: number; metricSharePct: number; recommendedPolicy: string }[];
  }>(`/api/analytics/abc/${stockId}?metric=${metric}${metric === 'consumption_value' && movementsId ? `&movementsDatasetId=${movementsId}` : ''}`);
  if (loading) return <Spinner />;
  if (error) return <ErrorState message={error} />;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <div className="grid md:grid-cols-3 gap-3">
        {data.summary.map((s) => (
          <Card key={s.abcClass}>
            <div className="flex items-center gap-2 mb-1">
              <Badge value={s.abcClass} label={`Class ${s.abcClass}`} />
              <span className="text-sm text-slate-500">{s.materialCount} materials · {s.metricSharePct}% of value</span>
            </div>
            <p className="text-lg font-bold tabular-nums">{s.metricValue.toLocaleString()}</p>
            <p className="text-xs text-slate-500 mt-1">{s.recommendedPolicy}</p>
          </Card>
        ))}
      </div>
      <Card title="Pareto curve" subtitle={`Cumulative value share (A ≤ ${data.thresholds.aThresholdPct}%, B ≤ ${data.thresholds.bThresholdPct}%)`}>
        <Chart option={{
          xAxis: { type: 'category', data: data.results.map((_, i) => i + 1), name: 'Materials (ranked)' },
          yAxis: { type: 'value', max: 100, name: 'Cumulative %' },
          series: [{
            type: 'line', data: data.results.map((r) => r.cumulativePct),
            showSymbol: false, lineStyle: { width: 2, color: '#2a78d6' },
            areaStyle: { color: 'rgba(42,120,214,0.08)' },
            markLine: {
              symbol: 'none', label: { formatter: '{b}' },
              data: [
                { yAxis: data.thresholds.aThresholdPct, name: 'A', lineStyle: { color: '#898781', type: 'dashed' } },
                { yAxis: data.thresholds.bThresholdPct, name: 'B', lineStyle: { color: '#898781', type: 'dashed' } },
              ],
            },
          }],
          tooltip: { trigger: 'axis', formatter: (p: unknown) => {
            const arr = p as { dataIndex: number }[];
            const r = data.results[arr[0].dataIndex];
            // Material codes come from uploaded files — escape them before HTML interpolation.
            const safe = String(r.material).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            return `${safe}<br/>Value: ${r.metricValue.toLocaleString()}<br/>Cumulative: ${r.cumulativePct}% (${r.abcClass})`;
          } },
        }} />
      </Card>
      <Card title="Material classification">
        <DataTable
          exportName="abc-classification"
          columns={[
            { key: 'material', label: 'Material', render: (r) => <Link className="text-sky-700" to={`/materials?material=${encodeURIComponent(String(r.material))}`}>{String(r.material)}</Link> },
            { key: 'abcClass', label: 'Class', render: (r) => <Badge value={String(r.abcClass)} /> },
            { key: 'metricValue', label: 'Metric value', numeric: true },
            { key: 'cumulativePct', label: 'Cumulative %', numeric: true },
          ]}
          rows={data.results as unknown as Record<string, unknown>[]}
        />
      </Card>
    </div>
  );
}

function XyzSection({ movementsId }: { movementsId: number }) {
  const { data, error, loading } = useFetch<{
    results: { material: string; xyzClass: string; cov: number | null; zeroPeriodShare: number; reason: string }[];
  }>(`/api/analytics/xyz/${movementsId}`);
  if (loading) return <Spinner />;
  if (error) return <ErrorState message={error} />;
  if (!data) return null;
  return (
    <Card title="XYZ demand variability" subtitle="Each classification includes the reason — no black box">
      <DataTable
        exportName="xyz-classification"
        columns={[
          { key: 'material', label: 'Material', render: (r) => <Link className="text-sky-700" to={`/materials?material=${encodeURIComponent(String(r.material))}`}>{String(r.material)}</Link> },
          { key: 'xyzClass', label: 'Class', render: (r) => <Badge value={String(r.xyzClass)} /> },
          { key: 'cov', label: 'CoV', numeric: true, render: (r) => r.cov === null ? 'undefined' : String(r.cov) },
          { key: 'zeroPeriodShare', label: 'Zero periods', numeric: true, render: (r) => `${Math.round(Number(r.zeroPeriodShare) * 100)}%` },
          { key: 'reason', label: 'Why' },
        ]}
        rows={data.results as unknown as Record<string, unknown>[]}
      />
    </Card>
  );
}

function MatrixSection({ stockId, movementsId }: { stockId: number; movementsId: number }) {
  const { data, error, loading } = useFetch<{
    cells: { segment: string; materialCount: number; stockValue: number; recommendedPolicy: string }[];
  }>(`/api/analytics/matrix/${stockId}/${movementsId}`);
  if (loading) return <Spinner />;
  if (error) return <ErrorState message={error} />;
  if (!data) return null;
  const maxCount = Math.max(1, ...data.cells.map((c) => c.materialCount));
  const cellFor = (seg: string) => data.cells.find((c) => c.segment === seg);
  return (
    <Card title="ABC–XYZ matrix" subtitle="Count of materials per segment with recommended control policy (hover a cell)">
      <div className="grid grid-cols-4 gap-1 max-w-2xl text-sm">
        <div />
        {['X (stable)', 'Y (variable)', 'Z (unpredictable)'].map((h) => <div key={h} className="text-center text-xs text-slate-500 py-1">{h}</div>)}
        {(['A', 'B', 'C'] as const).map((a) => (
          [
            <div key={`${a}-label`} className="flex items-center justify-center text-xs text-slate-500">{a} (value)</div>,
            ...(['X', 'Y', 'Z'] as const).map((x) => {
              const cell = cellFor(`${a}${x}`);
              const intensity = cell ? cell.materialCount / maxCount : 0;
              const shade = SEQUENTIAL_BLUE[Math.min(SEQUENTIAL_BLUE.length - 1, Math.floor(intensity * (SEQUENTIAL_BLUE.length - 1)))];
              return (
                <div
                  key={`${a}${x}`}
                  className="rounded-lg p-3 text-center border border-slate-200"
                  style={{ backgroundColor: cell && cell.materialCount > 0 ? shade : '#f8fafc', color: intensity > 0.5 ? '#fff' : '#0b0b0b' }}
                  title={cell ? `${cell.segment}: ${cell.materialCount} materials, stock value ${cell.stockValue.toLocaleString()}\n${cell.recommendedPolicy}` : undefined}
                >
                  <p className="font-bold">{a}{x}</p>
                  <p className="tabular-nums">{cell?.materialCount ?? 0}</p>
                </div>
              );
            }),
          ]
        ))}
      </div>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-sky-700">Recommended policies per segment</summary>
        <ul className="mt-2 space-y-1">
          {data.cells.map((c) => (
            <li key={c.segment}><span className="font-semibold">{c.segment}</span> ({c.materialCount}): <span className="text-slate-600">{c.recommendedPolicy}</span></li>
          ))}
        </ul>
        <p className="text-xs text-slate-400 mt-2">Policies are configurable recommendations, not universal facts.</p>
      </details>
    </Card>
  );
}
