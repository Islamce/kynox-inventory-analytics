import { useState } from 'react';
import { useWorkspaceIds } from '../components/Layout';
import { useFetch } from './Inventory';
import { Card, EmptyState, ErrorState, Spinner } from '../components/ui';
import { Chart } from '../components/Chart';

export function PlanningPage() {
  const ws = useWorkspaceIds();
  const [material, setMaterial] = useState('');
  const [applied, setApplied] = useState('');

  const forecastUrl = ws.movementsDatasetId && applied
    ? `/api/analytics/forecast/${ws.movementsDatasetId}?material=${encodeURIComponent(applied)}`
    : null;
  const planningUrl = ws.stockDatasetId && ws.movementsDatasetId && applied
    ? `/api/analytics/planning/${ws.stockDatasetId}/${ws.movementsDatasetId}?material=${encodeURIComponent(applied)}`
    : null;

  const forecast = useFetch<{
    insufficientData: boolean; note: string; best: string | null; horizon: number;
    history: { period: string; quantity: number }[];
    forecast: { forecast: number[]; params: Record<string, number> } | null;
    comparisons: { method: string; recommended: boolean; accuracy: { wape: number | null; mae: number; rmse: number; bias: number; trackingSignal: number | null } }[];
  }>(forecastUrl);
  const planning = useFetch<{
    insufficientData: boolean; note?: string;
    current?: Record<string, number | null>;
    proposed?: {
      safetyStock: { safetyStock: number; formula: string; assumptions: string[]; inputs: Record<string, number> };
      reorderPoint: { reorderPoint: number; leadTimeDemand: number; formula: string };
      minMax: { minStock: number; maxStock: number; orderQuantity: number; formula: string };
    };
    assumptions?: string[];
  }>(planningUrl);

  if (!ws.movementsDatasetId) {
    return <EmptyState title="Planning needs a movements dataset" hint="Import a movement/consumption report and select it in the header. Forecasting and safety-stock proposals derive from consumption history." />;
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Planning & Forecasting</h1>
      <div className="flex items-center gap-2">
        <input
          className="border border-line-strong rounded-lg px-3 py-1.5 text-sm bg-surface w-64"
          placeholder="Material code (exact)"
          value={material}
          onChange={(e) => setMaterial(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') setApplied(material.trim()); }}
          aria-label="Material code for planning"
        />
        <button type="button" className="bg-brand hover:bg-brand-hover text-white rounded-lg px-4 py-1.5 text-sm" onClick={() => setApplied(material.trim())}>
          Analyse
        </button>
      </div>
      {!applied && <EmptyState title="Enter a material to plan" hint="The system back-tests all applicable forecast methods and recommends the best performer with full transparency." />}
      {(forecast.loading || planning.loading) && <Spinner label="Back-testing forecast methods…" />}
      {forecast.error && <ErrorState message={forecast.error} />}

      {forecast.data && (
        forecast.data.insufficientData
          ? <Card title="Forecast"><p className="text-sm text-muted">{forecast.data.note}</p></Card>
          : (
            <Card title={`Recommended method: ${forecast.data.best}`} subtitle={forecast.data.note}>
              {forecast.data.forecast && (
                <Chart option={{
                  xAxis: {
                    type: 'category',
                    data: [...forecast.data.history.map((p) => p.period), ...forecast.data.forecast.forecast.map((_, i) => `+${i + 1}`)],
                  },
                  yAxis: { type: 'value', name: 'Quantity' },
                  legend: { top: 0 },
                  series: [
                    { name: 'History', type: 'line', data: forecast.data.history.map((p) => p.quantity), showSymbol: false, lineStyle: { width: 2, color: '#2a78d6' } },
                    {
                      name: 'Forecast', type: 'line',
                      data: [...Array(Math.max(0, forecast.data.history.length - 1)).fill(null), forecast.data.history.at(-1)?.quantity ?? null, ...forecast.data.forecast.forecast],
                      showSymbol: false, lineStyle: { width: 2, type: 'dashed', color: '#008300' },
                    },
                  ],
                }} />
              )}
              <div className="overflow-auto mt-3">
                <table className="text-sm w-full max-w-2xl">
                  <thead>
                    <tr className="text-left text-muted border-b border-line">
                      <th className="py-1">Method</th>
                      <th className="text-right">WAPE %</th>
                      <th className="text-right">MAE</th>
                      <th className="text-right">RMSE</th>
                      <th className="text-right">Bias</th>
                      <th className="text-right">Tracking signal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {forecast.data.comparisons.map((c) => (
                      <tr key={c.method} className={`border-b border-line ${c.recommended ? 'font-semibold bg-emerald-50' : ''}`}>
                        <td className="py-1">{c.method}{c.recommended ? ' ✓ recommended' : ''}</td>
                        <td className="text-right tabular-nums">{c.accuracy.wape ?? '—'}</td>
                        <td className="text-right tabular-nums">{c.accuracy.mae}</td>
                        <td className="text-right tabular-nums">{c.accuracy.rmse}</td>
                        <td className="text-right tabular-nums">{c.accuracy.bias}</td>
                        <td className="text-right tabular-nums">{c.accuracy.trackingSignal ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )
      )}

      {planning.data && (
        <Card title="Safety stock & reorder point proposal" subtitle="Statistical service-level method — recommendations only, with formula and assumptions shown">
          {planning.data.insufficientData
            ? <p className="text-sm text-muted">{planning.data.note}</p>
            : planning.data.proposed && (
              <div className="text-sm space-y-3">
                <div className="grid md:grid-cols-3 gap-3">
                  <div className="bg-sunken rounded-lg p-3">
                    <p className="text-xs text-muted">Safety stock</p>
                    <p className="text-xl font-bold tabular-nums">{planning.data.proposed.safetyStock.safetyStock.toLocaleString()}</p>
                    <p className="text-xs text-subtle">{planning.data.proposed.safetyStock.formula}</p>
                    <p className="text-xs text-subtle mt-1">Current: {planning.data.current?.safetyStock ?? 'not maintained'}</p>
                  </div>
                  <div className="bg-sunken rounded-lg p-3">
                    <p className="text-xs text-muted">Reorder point</p>
                    <p className="text-xl font-bold tabular-nums">{planning.data.proposed.reorderPoint.reorderPoint.toLocaleString()}</p>
                    <p className="text-xs text-subtle">{planning.data.proposed.reorderPoint.formula}</p>
                    <p className="text-xs text-subtle mt-1">Lead-time demand: {planning.data.proposed.reorderPoint.leadTimeDemand.toLocaleString()}</p>
                  </div>
                  <div className="bg-sunken rounded-lg p-3">
                    <p className="text-xs text-muted">Min / Max / Order qty</p>
                    <p className="text-xl font-bold tabular-nums">
                      {planning.data.proposed.minMax.minStock.toLocaleString()} / {planning.data.proposed.minMax.maxStock.toLocaleString()}
                    </p>
                    <p className="text-xs text-subtle">{planning.data.proposed.minMax.formula}</p>
                    <p className="text-xs text-subtle mt-1">Order quantity: {planning.data.proposed.minMax.orderQuantity.toLocaleString()}</p>
                  </div>
                </div>
                <div>
                  <p className="font-medium text-body">Assumptions</p>
                  <ul className="list-disc ms-5 text-xs text-muted">
                    {(planning.data.assumptions ?? []).map((a) => <li key={a}>{a}</li>)}
                    {planning.data.proposed.safetyStock.assumptions.map((a) => <li key={a}>{a}</li>)}
                  </ul>
                </div>
              </div>
            )}
        </Card>
      )}
    </div>
  );
}
