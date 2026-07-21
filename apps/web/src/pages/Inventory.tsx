import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet } from '../lib/api';
import { useWorkspaceIds } from '../components/Layout';
import { Badge, Card, DataTable, EmptyState, ErrorState, Spinner } from '../components/ui';
import { Chart } from '../components/Chart';

const TABS = ['Position', 'Aging', 'Movement categories', 'Excess', 'Shortage'] as const;
type Tab = typeof TABS[number];

export function InventoryPage() {
  const ws = useWorkspaceIds();
  const [tab, setTab] = useState<Tab>('Position');

  if (!ws.stockDatasetId) {
    return <EmptyState title="No stock dataset selected" hint="Pick one in the header, or import one in the Data Workspace." />;
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Inventory Intelligence</h1>
      <div className="flex gap-1 flex-wrap" role="tablist">
        {TABS.map((t) => (
          <button
            key={t} type="button" role="tab" aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded-lg text-sm ${tab === t ? 'bg-brand text-white' : 'bg-surface border border-line-strong text-body hover:bg-sunken'}`}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === 'Position' && <PositionTab stockId={ws.stockDatasetId} />}
      {tab === 'Aging' && <AgingTab stockId={ws.stockDatasetId} />}
      {tab === 'Movement categories' && <CategoriesTab stockId={ws.stockDatasetId} movementsId={ws.movementsDatasetId} />}
      {tab === 'Excess' && <ExcessTab stockId={ws.stockDatasetId} movementsId={ws.movementsDatasetId} />}
      {tab === 'Shortage' && <ShortageTab stockId={ws.stockDatasetId} movementsId={ws.movementsDatasetId} />}
    </div>
  );
}

function useFetch<T>(url: string | null): { data: T | null; error: string | null; loading: boolean } {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: !!url });
  useEffect(() => {
    if (!url) return;
    setState({ data: null, error: null, loading: true });
    apiGet<T>(url)
      .then((data) => setState({ data, error: null, loading: false }))
      .catch((e) => setState({ data: null, error: e instanceof Error ? e.message : 'Request failed', loading: false }));
  }, [url]);
  return state;
}

export { useFetch };

function PositionTab({ stockId }: { stockId: number }) {
  const { data, error, loading } = useFetch<{
    totals: Record<string, number>;
    byGroup: { group: string; quantity: number; value: number; materials: number }[];
    byPlant: { plant: string; quantity: number; value: number; materials: number }[];
  }>(`/api/analytics/position/${stockId}`);
  if (loading) return <Spinner />;
  if (error) return <ErrorState message={error} />;
  if (!data) return null;
  return (
    <div className="space-y-4">
      <Card title="Stock status split" subtitle="Quantities by stock status across the dataset">
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-2 text-center text-sm">
          {Object.entries(data.totals).map(([k, v]) => (
            <div key={k} className="bg-sunken rounded-lg p-3">
              <p className="text-xs text-muted capitalize">{k.replace(/([A-Z])/g, ' $1')}</p>
              <p className="font-bold tabular-nums">{v === null ? '—' : v.toLocaleString()}</p>
            </div>
          ))}
        </div>
      </Card>
      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="Value by material group">
          <DataTable
            exportName="stock-by-group"
            columns={[
              { key: 'group', label: 'Group' },
              { key: 'materials', label: 'Materials', numeric: true },
              { key: 'quantity', label: 'Quantity', numeric: true },
              { key: 'value', label: 'Value', numeric: true },
            ]}
            rows={data.byGroup}
          />
        </Card>
        <Card title="Value by plant">
          <DataTable
            exportName="stock-by-plant"
            columns={[
              { key: 'plant', label: 'Plant' },
              { key: 'materials', label: 'Materials', numeric: true },
              { key: 'quantity', label: 'Quantity', numeric: true },
              { key: 'value', label: 'Value', numeric: true },
            ]}
            rows={data.byPlant}
          />
        </Card>
      </div>
    </div>
  );
}

function AgingTab({ stockId }: { stockId: number }) {
  const [basis, setBasis] = useState('last_movement');
  const { data, error, loading } = useFetch<{
    asOfDate: string;
    summary: { bucket: string; materialCount: number; quantity: number; value: number }[];
    results: { material: string; ageDays: number | null; bucket: string | null; quantity: number; value: number }[];
  }>(`/api/analytics/aging/${stockId}?basis=${basis}`);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm">
        <label htmlFor="aging-basis" className="text-muted">Aging basis</label>
        <select id="aging-basis" className="border border-line-strong rounded-lg px-2 py-1 bg-surface" value={basis} onChange={(e) => setBasis(e.target.value)}>
          <option value="last_movement">Last movement</option>
          <option value="last_receipt">Last receipt</option>
          <option value="last_issue">Last issue</option>
        </select>
        {data && <span className="text-subtle">as of {data.asOfDate}</span>}
      </div>
      {loading && <Spinner />}
      {error && <ErrorState message={error} />}
      {data && (
        <>
          <Card title="Aging distribution" subtitle="Stock value per aging bucket">
            <Chart option={{
              xAxis: { type: 'category', data: data.summary.map((s) => s.bucket), axisLabel: { rotate: 20 } },
              yAxis: { type: 'value', name: 'Value' },
              series: [{ type: 'bar', data: data.summary.map((s) => s.value), itemStyle: { color: '#2a78d6', borderRadius: [4, 4, 0, 0] }, barMaxWidth: 48 }],
            }} />
          </Card>
          <Card title="Materials by age">
            <DataTable
              exportName="inventory-aging"
              columns={[
                { key: 'material', label: 'Material', render: (r) => <Link className="text-brand" to={`/materials?material=${encodeURIComponent(String(r.material))}`}>{String(r.material)}</Link> },
                { key: 'ageDays', label: 'Age (days)', numeric: true, render: (r) => r.ageDays === null ? 'no date' : String(r.ageDays) },
                { key: 'bucket', label: 'Bucket' },
                { key: 'quantity', label: 'Quantity', numeric: true },
                { key: 'value', label: 'Value', numeric: true },
              ]}
              rows={data.results as unknown as Record<string, unknown>[]}
            />
          </Card>
        </>
      )}
    </div>
  );
}

function CategoriesTab({ stockId, movementsId }: { stockId: number; movementsId: number | null }) {
  const { data, error, loading } = useFetch<{
    thresholds: Record<string, number>;
    summary: Record<string, { count: number; value: number }>;
    results: { material: string; category: string; reason: string; stockQty: number; stockValue: number; annualizedTurnover: number | null }[];
  }>(`/api/analytics/movement-categories/${stockId}${movementsId ? `?movementsDatasetId=${movementsId}` : ''}`);
  if (loading) return <Spinner />;
  if (error) return <ErrorState message={error} />;
  if (!data) return null;
  return (
    <div className="space-y-4">
      {!movementsId && <p className="text-sm bg-info-soft border border-info/30 text-brand rounded-lg px-3 py-2">No movements dataset linked — classification relies on last-issue dates in the stock report only.</p>}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Object.entries(data.summary).map(([k, v]) => (
          <Card key={k}>
            <p className="text-xs text-muted uppercase">{k.replace(/([A-Z])/g, ' $1')}</p>
            <p className="text-xl font-bold">{v.count} <span className="text-sm font-normal text-muted">materials</span></p>
            <p className="text-sm text-muted tabular-nums">{v.value.toLocaleString()} value</p>
          </Card>
        ))}
      </div>
      <Card
        title="Classification detail"
        subtitle={`Thresholds: slow-moving ≥ ${data.thresholds.slowMovingDays}d without issue or turnover < ${data.thresholds.slowTurnoverThreshold}; non-moving ≥ ${data.thresholds.nonMovingDays}d. Slow-moving, non-moving, excess and obsolete are distinct concepts.`}
      >
        <DataTable
          exportName="movement-categories"
          columns={[
            { key: 'material', label: 'Material', render: (r) => <Link className="text-brand" to={`/materials?material=${encodeURIComponent(String(r.material))}`}>{String(r.material)}</Link> },
            { key: 'category', label: 'Category', render: (r) => <Badge value={String(r.category) === 'non_moving' ? 'critical' : String(r.category) === 'slow_moving' ? 'medium' : 'good'} label={String(r.category)} /> },
            { key: 'annualizedTurnover', label: 'Turnover (ann.)', numeric: true, render: (r) => r.annualizedTurnover === null ? '—' : String(r.annualizedTurnover) },
            { key: 'stockQty', label: 'Stock qty', numeric: true },
            { key: 'stockValue', label: 'Stock value', numeric: true },
            { key: 'reason', label: 'Why' },
          ]}
          rows={data.results as unknown as Record<string, unknown>[]}
        />
      </Card>
    </div>
  );
}

function ExcessTab({ stockId, movementsId }: { stockId: number; movementsId: number | null }) {
  const [method, setMethod] = useState('above_coverage_target');
  const { data, error, loading } = useFetch<{
    results: { material: string; stockQty: number; stockValue: number; referenceQty: number; excessQty: number; excessValue: number }[];
    totalExcessValue: number; coverageTargetDays: number; note?: string;
  }>(`/api/analytics/excess/${stockId}?method=${method}${movementsId ? `&movementsDatasetId=${movementsId}` : ''}`);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm">
        <label htmlFor="excess-method" className="text-muted">Method</label>
        <select id="excess-method" className="border border-line-strong rounded-lg px-2 py-1 bg-surface" value={method} onChange={(e) => setMethod(e.target.value)}>
          <option value="above_coverage_target">Above coverage target</option>
          <option value="above_max_stock">Above maximum stock</option>
          <option value="above_safety_plus_leadtime">Above safety stock + lead-time demand</option>
          <option value="no_demand">Stock without demand</option>
        </select>
        {data && <span className="text-muted font-medium tabular-nums">Total excess value: {data.totalExcessValue.toLocaleString()}</span>}
      </div>
      {data?.note && <p className="text-sm bg-amber-50 border border-amber-200 text-amber-900 rounded-lg px-3 py-2">{data.note}</p>}
      {loading && <Spinner />}
      {error && <ErrorState message={error} />}
      {data && (
        <Card title="Excess stock" subtitle="Materials are only listed when the method's required inputs exist — nothing is guessed">
          {data.results.length === 0
            ? <EmptyState title="No excess found with this method" hint="Try another method, or check that max stock / demand data is available." />
            : (
              <DataTable
                exportName="excess-stock"
                columns={[
                  { key: 'material', label: 'Material', render: (r) => <Link className="text-brand" to={`/materials?material=${encodeURIComponent(String(r.material))}`}>{String(r.material)}</Link> },
                  { key: 'stockQty', label: 'Stock qty', numeric: true },
                  { key: 'referenceQty', label: 'Reference (limit)', numeric: true },
                  { key: 'excessQty', label: 'Excess qty', numeric: true },
                  { key: 'excessValue', label: 'Excess value', numeric: true },
                ]}
                rows={data.results as unknown as Record<string, unknown>[]}
              />
            )}
        </Card>
      )}
    </div>
  );
}

function ShortageTab({ stockId, movementsId }: { stockId: number; movementsId: number | null }) {
  const { data, error, loading } = useFetch<{
    summary: { critical: number; high: number; medium: number };
    results: { material: string; reason: string; risk: string; stockQty: number; gapQty: number }[];
  }>(`/api/analytics/shortage/${stockId}${movementsId ? `?movementsDatasetId=${movementsId}` : ''}`);
  if (loading) return <Spinner />;
  if (error) return <ErrorState message={error} />;
  if (!data) return null;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {(['critical', 'high', 'medium'] as const).map((lvl) => (
          <Card key={lvl}>
            <div className="flex items-center gap-2"><Badge value={lvl} /><span className="text-xl font-bold">{data.summary[lvl]}</span></div>
          </Card>
        ))}
      </div>
      <Card title="Shortage risks">
        {data.results.length === 0
          ? <EmptyState title="No shortage risks detected" />
          : (
            <DataTable
              exportName="shortage-risks"
              columns={[
                { key: 'material', label: 'Material', render: (r) => <Link className="text-brand" to={`/materials?material=${encodeURIComponent(String(r.material))}`}>{String(r.material)}</Link> },
                { key: 'risk', label: 'Risk', render: (r) => <Badge value={String(r.risk)} /> },
                { key: 'stockQty', label: 'Stock qty', numeric: true },
                { key: 'gapQty', label: 'Gap qty', numeric: true },
                { key: 'reason', label: 'Reason' },
              ]}
              rows={data.results as unknown as Record<string, unknown>[]}
            />
          )}
      </Card>
    </div>
  );
}
