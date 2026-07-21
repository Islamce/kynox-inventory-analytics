import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useWorkspaceIds } from '../components/Layout';
import { useFetch } from './Inventory';
import { Badge, Card, DataTable, EmptyState, ErrorState, Spinner } from '../components/ui';
import { Chart } from '../components/Chart';

export function ConsumptionPage() {
  const ws = useWorkspaceIds();
  const [granularity, setGranularity] = useState('month');
  const [material, setMaterial] = useState('');
  const [applied, setApplied] = useState('');

  const url = ws.movementsDatasetId
    ? `/api/analytics/consumption/${ws.movementsDatasetId}?granularity=${granularity}${applied ? `&material=${encodeURIComponent(applied)}` : ''}`
    : null;
  const { data, error, loading } = useFetch<{
    series: { period: string; quantity: number; value: number }[];
    stats: Record<string, number>;
    anomalies: { period: string; quantity: number; zScore: number; direction: string }[];
    topConsumers?: { material: string; issuedQty: number; issuedValue: number }[];
  }>(url);

  if (!ws.movementsDatasetId) {
    return <EmptyState title="No movements dataset selected" hint="Import a movement report (e.g. MB51) in the Data Workspace and select it in the header." />;
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Consumption Analytics</h1>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label htmlFor="cons-gran" className="text-muted">Granularity</label>
        <select id="cons-gran" className="border border-line-strong rounded-lg px-2 py-1 bg-surface" value={granularity} onChange={(e) => setGranularity(e.target.value)}>
          <option value="month">Monthly</option>
          <option value="week">Weekly</option>
          <option value="day">Daily</option>
        </select>
        <input
          className="border border-line-strong rounded-lg px-3 py-1 bg-surface w-56"
          placeholder="Filter to one material (exact code)"
          value={material}
          onChange={(e) => setMaterial(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') setApplied(material.trim()); }}
        />
        <button type="button" className="px-3 py-1 rounded-lg border border-line-strong hover:bg-sunken" onClick={() => setApplied(material.trim())}>Apply</button>
        {applied && <button type="button" className="text-brand" onClick={() => { setMaterial(''); setApplied(''); }}>Clear</button>}
      </div>
      {loading && <Spinner />}
      {error && <ErrorState message={error} />}
      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-2">
            {Object.entries(data.stats).map(([k, v]) => (
              <div key={k} className="bg-surface border border-line rounded-lg p-3 text-center">
                <p className="text-xs text-muted capitalize">{k.replace(/([A-Z])/g, ' $1')}</p>
                <p className="font-bold tabular-nums">{typeof v === 'number' ? v.toLocaleString() : v}</p>
              </div>
            ))}
          </div>
          <Card title={applied ? `Consumption of ${applied}` : 'Total consumption (issues)'} subtitle="Quantities issued per period; empty periods are shown as zero">
            <Chart option={{
              xAxis: { type: 'category', data: data.series.map((p) => p.period) },
              yAxis: { type: 'value', name: 'Quantity' },
              series: [{
                type: 'line', data: data.series.map((p) => p.quantity),
                showSymbol: data.series.length <= 40, symbolSize: 8,
                lineStyle: { width: 2, color: '#2a78d6' },
                markPoint: data.anomalies.length > 0 ? {
                  data: data.anomalies.map((a) => ({
                    coord: [a.period, a.quantity],
                    value: `${a.direction} (z=${a.zScore})`,
                    itemStyle: { color: a.direction === 'spike' ? '#d03b3b' : '#eda100' },
                  })),
                  symbolSize: 40,
                } : undefined,
              }],
            }} />
          </Card>
          {data.anomalies.length > 0 && (
            <Card title={`Anomalies (${data.anomalies.length})`} subtitle="Periods deviating ≥ 3σ from the mean — verify whether these are business events (projects, seasonality) or data errors">
              <ul className="text-sm space-y-1">
                {data.anomalies.map((a) => (
                  <li key={a.period} className="flex items-center gap-2">
                    <Badge value={a.direction === 'spike' ? 'critical' : 'medium'} label={a.direction} />
                    <span>{a.period}: quantity {a.quantity.toLocaleString()} (z-score {a.zScore})</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {data.topConsumers && (
            <Card title="Top consuming materials" subtitle="By issued value in the analysed period">
              <DataTable
                exportName="top-consumers"
                columns={[
                  { key: 'material', label: 'Material', render: (r) => <Link className="text-brand" to={`/materials?material=${encodeURIComponent(String(r.material))}`}>{String(r.material)}</Link> },
                  { key: 'issuedQty', label: 'Issued qty', numeric: true },
                  { key: 'issuedValue', label: 'Issued value', numeric: true },
                ]}
                rows={data.topConsumers as unknown as Record<string, unknown>[]}
              />
            </Card>
          )}
        </>
      )}
    </div>
  );
}
