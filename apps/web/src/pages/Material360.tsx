import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useWorkspaceIds } from '../components/Layout';
import { useFetch } from './Inventory';
import { Badge, Card, EmptyState, ErrorState, Spinner } from '../components/ui';
import { IntelligenceHeader } from '../components/intelligence';
import { Chart } from '../components/Chart';

interface Material360 {
  material: string;
  stock: Record<string, unknown> & { description: string | null };
  abc: { abcClass: string; metricValue: number; cumulativePct: number } | null;
  xyz: { xyzClass: string; cov: number | null; reason: string } | null;
  movementCategory: { category: string; reason: string; annualizedTurnover: number | null } | null;
  shortage: { risk: string; reason: string; gapQty: number } | null;
  consumption: { series: { period: string; quantity: number }[]; stats: Record<string, number>; anomalies: unknown[] } | null;
  forecast: {
    insufficientData: boolean; note: string; best: string | null;
    history: { period: string; quantity: number }[];
    forecast: { forecast: number[] } | null;
    comparisons: { method: string; recommended: boolean; accuracy: { wape: number | null; mae: number } }[];
  } | null;
  planning: {
    insufficientData: boolean; note?: string;
    current?: Record<string, number | null>;
    proposed?: {
      safetyStock: { safetyStock: number; formula: string; assumptions: string[] };
      reorderPoint: { reorderPoint: number; formula: string };
      minMax: { minStock: number; maxStock: number; formula: string };
    };
    assumptions?: string[];
  } | null;
  availableAnalyses: { note?: string };
}

export function Material360Page() {
  const ws = useWorkspaceIds();
  const [params, setParams] = useSearchParams();
  const urlMaterial = params.get('material') ?? '';
  const [input, setInput] = useState(urlMaterial);

  const url = ws.stockDatasetId && urlMaterial
    ? `/api/analytics/material360/${ws.stockDatasetId}?material=${encodeURIComponent(urlMaterial)}${ws.movementsDatasetId ? `&movementsDatasetId=${ws.movementsDatasetId}` : ''}`
    : null;
  const { data, error, loading } = useFetch<Material360>(url);

  if (!ws.stockDatasetId) {
    return <EmptyState title="No stock dataset selected" hint="Select one in the header." />;
  }

  return (
    <div className="space-y-4">
      <IntelligenceHeader
        eyebrow="Material dossier"
        title="Material 360°"
        description="A single premium profile per material — identity, stock, value, ABC–XYZ, consumption and movement history, and planning recommendations requiring review."
      />
      <div className="flex items-center gap-2">
        <input
          className="border border-line-strong rounded-lg px-3 py-1.5 text-sm bg-surface w-64"
          placeholder="Material code (exact)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') setParams({ material: input.trim() }); }}
          aria-label="Material code"
        />
        <button type="button" className="bg-brand hover:bg-brand-hover text-white rounded-lg px-4 py-1.5 text-sm" onClick={() => setParams({ material: input.trim() })}>
          Open profile
        </button>
      </div>
      {!urlMaterial && <EmptyState title="Enter a material code" hint="Or click any material link in the analysis modules." />}
      {loading && <Spinner label="Building material profile…" />}
      {error && <ErrorState message={error} />}
      {data && (
        <>
          <Card title={`${data.material} — ${data.stock.description ?? 'no description'}`}>
            <div className="flex flex-wrap gap-2 mb-3">
              {data.abc && <Badge value={data.abc.abcClass} label={`ABC: ${data.abc.abcClass}`} />}
              {data.xyz && <Badge value={data.xyz.xyzClass} label={`XYZ: ${data.xyz.xyzClass}`} />}
              {data.movementCategory && <Badge value={data.movementCategory.category === 'non_moving' ? 'critical' : data.movementCategory.category === 'slow_moving' ? 'medium' : 'good'} label={data.movementCategory.category} />}
              {data.shortage && <Badge value={data.shortage.risk} label={`shortage: ${data.shortage.risk}`} />}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-2 text-sm">
              {(['quantity', 'value', 'unrestricted', 'blocked', 'reserved', 'in_transit', 'safety_stock', 'reorder_point', 'min_stock', 'max_stock', 'lead_time_days', 'last_movement'] as const).map((k) => (
                <div key={k} className="bg-sunken rounded-lg p-2 text-center">
                  <p className="text-xs text-muted">{k.replace(/_/g, ' ')}</p>
                  <p className="font-semibold tabular-nums">{data.stock[k] === null || data.stock[k] === undefined ? '—' : String(typeof data.stock[k] === 'number' ? (data.stock[k] as number).toLocaleString() : data.stock[k])}</p>
                </div>
              ))}
            </div>
            {data.xyz && <p className="text-xs text-muted mt-2">XYZ reasoning: {data.xyz.reason}</p>}
            {data.movementCategory && <p className="text-xs text-muted">Movement category: {data.movementCategory.reason}</p>}
            {data.shortage && <p className="text-xs text-danger">Shortage: {data.shortage.reason}</p>}
            {data.availableAnalyses.note && <p className="text-xs text-warning mt-2">{data.availableAnalyses.note}</p>}
          </Card>

          {data.consumption && (
            <Card title="Consumption history" subtitle="Monthly issued quantity">
              <Chart height={240} option={{
                xAxis: { type: 'category', data: data.consumption.series.map((p) => p.period) },
                yAxis: { type: 'value', name: 'Qty' },
                series: [{ type: 'bar', data: data.consumption.series.map((p) => p.quantity), itemStyle: { color: '#2a78d6', borderRadius: [4, 4, 0, 0] }, barMaxWidth: 32 }],
              }} />
            </Card>
          )}

          {data.forecast && !data.forecast.insufficientData && data.forecast.forecast && (
            <Card title={`Forecast (${data.forecast.best})`} subtitle={data.forecast.note}>
              <Chart height={240} option={{
                xAxis: {
                  type: 'category',
                  data: [
                    ...data.forecast.history.map((p) => p.period),
                    ...data.forecast.forecast.forecast.map((_, i) => `+${i + 1}`),
                  ],
                },
                yAxis: { type: 'value', name: 'Qty' },
                legend: { top: 0 },
                series: [
                  { name: 'History', type: 'line', data: data.forecast.history.map((p) => p.quantity), showSymbol: false, lineStyle: { width: 2, color: '#2a78d6' } },
                  {
                    name: 'Forecast', type: 'line',
                    data: [...Array(data.forecast.history.length - 1).fill(null), data.forecast.history.at(-1)?.quantity ?? null, ...data.forecast.forecast.forecast],
                    lineStyle: { width: 2, type: 'dashed', color: '#008300' }, showSymbol: false,
                  },
                ],
              }} />
              <details className="text-sm mt-2">
                <summary className="cursor-pointer text-link">Method comparison (holdout back-test)</summary>
                <table className="mt-2 text-sm w-full max-w-md">
                  <thead><tr className="text-left text-muted"><th>Method</th><th className="text-right">WAPE %</th><th className="text-right">MAE</th></tr></thead>
                  <tbody>
                    {data.forecast.comparisons.map((c) => (
                      <tr key={c.method} className={c.recommended ? 'font-semibold' : ''}>
                        <td>{c.method}{c.recommended ? ' ✓' : ''}</td>
                        <td className="text-right tabular-nums">{c.accuracy.wape ?? '—'}</td>
                        <td className="text-right tabular-nums">{c.accuracy.mae}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </Card>
          )}
          {data.forecast?.insufficientData && (
            <Card title="Forecast"><p className="text-sm text-muted">{data.forecast.note}</p></Card>
          )}

          {data.planning && (
            <Card title="Planning proposal" subtitle="Recommendations requiring planner review — never applied automatically">
              {data.planning.insufficientData
                ? <p className="text-sm text-muted">{data.planning.note}</p>
                : data.planning.proposed && (
                  <div className="text-sm space-y-2">
                    <div className="grid md:grid-cols-3 gap-3">
                      <div className="bg-sunken rounded-lg p-3">
                        <p className="text-xs text-muted">Proposed safety stock</p>
                        <p className="text-lg font-bold tabular-nums">{data.planning.proposed.safetyStock.safetyStock.toLocaleString()}</p>
                        <p className="text-xs text-subtle">{data.planning.proposed.safetyStock.formula}</p>
                        <p className="text-xs text-subtle">current: {data.planning.current?.safetyStock ?? '—'}</p>
                      </div>
                      <div className="bg-sunken rounded-lg p-3">
                        <p className="text-xs text-muted">Proposed reorder point</p>
                        <p className="text-lg font-bold tabular-nums">{data.planning.proposed.reorderPoint.reorderPoint.toLocaleString()}</p>
                        <p className="text-xs text-subtle">{data.planning.proposed.reorderPoint.formula}</p>
                        <p className="text-xs text-subtle">current: {data.planning.current?.reorderPoint ?? '—'}</p>
                      </div>
                      <div className="bg-sunken rounded-lg p-3">
                        <p className="text-xs text-muted">Proposed min / max</p>
                        <p className="text-lg font-bold tabular-nums">{data.planning.proposed.minMax.minStock.toLocaleString()} / {data.planning.proposed.minMax.maxStock.toLocaleString()}</p>
                        <p className="text-xs text-subtle">{data.planning.proposed.minMax.formula}</p>
                      </div>
                    </div>
                    <ul className="list-disc ms-5 text-xs text-muted">
                      {(data.planning.assumptions ?? []).map((a) => <li key={a}>{a}</li>)}
                      {data.planning.proposed.safetyStock.assumptions.map((a) => <li key={a}>{a}</li>)}
                    </ul>
                  </div>
                )}
            </Card>
          )}
        </>
      )}
    </div>
  );
}
