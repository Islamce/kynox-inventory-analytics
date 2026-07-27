import { useEffect, useState } from 'react';
import { apiGet } from '../lib/api';
import { useWorkspaceIds } from '../components/Layout';
import { Badge, Card, DataTable, EmptyState, ErrorState, Spinner } from '../components/ui';
import { IntelligenceHeader, ContextChip, InsightCallout, StatTile } from '../components/intelligence';

interface ReconciliationRow extends Record<string, unknown> {
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
  reportedClosingQty: number | null;
  reportedStockQty: number | null;
  variance: number | null;
  variancePct: number | null;
  hasTransferImbalance: boolean;
  rowCount: number;
  unknownRowCount: number;
}
interface ReconciliationData {
  available: boolean;
  note: string | null;
  stockDatasetLinked: boolean;
  results: ReconciliationRow[];
  summary: {
    totalMaterials: number;
    materialsWithReportedClosing: number;
    materialsWithVariance: number;
    materialsWithTransferImbalance: number;
    materialsWithUnknownTransactions: number;
    totalUnknownRows: number;
  } | null;
}

export function ReconciliationPage() {
  const ws = useWorkspaceIds();
  const [data, setData] = useState<ReconciliationData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!ws.movementsDatasetId) { setData(null); return; }
    setLoading(true);
    setError(null);
    const qs = ws.stockDatasetId ? `?stockDatasetId=${ws.stockDatasetId}` : '';
    apiGet<ReconciliationData>(`/api/analytics/reconciliation/${ws.movementsDatasetId}${qs}`)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load reconciliation'))
      .finally(() => setLoading(false));
  }, [ws.movementsDatasetId, ws.stockDatasetId]);

  if (!ws.movementsDatasetId) {
    return (
      <EmptyState
        title="No movements dataset selected"
        icon="database"
        hint="Upload a transaction/movements report in the Data Workspace, then pick it in the header above."
      />
    );
  }
  if (loading) return <Spinner label="Reconciling opening, movements and closing…" />;
  if (error) return <ErrorState message={error} />;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <IntelligenceHeader
        eyebrow="Reconciliation"
        title="Inventory Reconciliation"
        description="Opening balance + every canonical transaction should equal closing stock. Computed from the source-independent canonical_transactions engine — never SAP-specific movement types."
        context={<>
          <ContextChip icon="database" label="Movements dataset" value={`#${ws.movementsDatasetId}`} />
          <ContextChip icon="inventory" label="Stock dataset" value={ws.stockDatasetId ? `#${ws.stockDatasetId}` : 'none linked'} />
        </>}
      />

      {!data.available && (
        <EmptyState
          title="Reconciliation not available for this dataset"
          icon="database"
          hint={data.note ?? 'This dataset has no canonical transaction data.'}
        />
      )}

      {data.available && data.note && (
        <InsightCallout tone="info" title="Link a stock dataset for variance detection">{data.note}</InsightCallout>
      )}

      {data.available && data.summary && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
            <StatTile label="Materials" value={data.summary.totalMaterials} tone="neutral" />
            <StatTile label="With reported closing" value={data.summary.materialsWithReportedClosing} tone="neutral"
              hint="from CLOSING_BALANCE rows in this dataset" />
            <StatTile label="With variance" value={data.summary.materialsWithVariance}
              tone={data.summary.materialsWithVariance > 0 ? 'risk' : 'positive'}
              hint={data.stockDatasetLinked ? 'vs linked stock dataset' : 'link a stock dataset to compute'} />
            <StatTile label="Transfer imbalance" value={data.summary.materialsWithTransferImbalance}
              tone={data.summary.materialsWithTransferImbalance > 0 ? 'warning' : 'positive'}
              hint="net transfer in/out ≠ 0 within this dataset" />
            <StatTile label="Unknown transactions" value={data.summary.totalUnknownRows}
              tone={data.summary.totalUnknownRows > 0 ? 'warning' : 'positive'}
              hint={`${data.summary.materialsWithUnknownTransactions} material(s) affected`} />
          </div>

          <InsightCallout tone="neutral" title="Scope of this reconciliation">
            Transfer and reversal figures are NET per material (should be ~0 if both legs of a transfer fall inside this
            dataset) — the underlying schema reserves columns for exact document-level pairing, but that matching is not
            yet implemented. Variance against a linked stock dataset is only meaningful when this movements dataset's
            period covers the material&apos;s full history since stock was last a known value (an explicit opening
            balance, or genuinely zero).
          </InsightCallout>

          <Card title="Reconciliation by material" subtitle={`${data.results.length.toLocaleString()} material(s)`}>
            {data.results.length === 0
              ? <EmptyState title="No canonical transactions found" />
              : (
                <DataTable<ReconciliationRow>
                  columns={[
                    { key: 'material', label: 'Material' },
                    { key: 'openingQty', label: 'Opening', numeric: true },
                    { key: 'receiptQty', label: 'Receipts', numeric: true },
                    { key: 'consumptionQty', label: 'Consumption', numeric: true },
                    { key: 'transferNet', label: 'Transfer net', numeric: true, render: (r) => (
                      <span className={r.hasTransferImbalance ? 'text-warning font-medium' : undefined}>{r.transferNet.toLocaleString()}</span>
                    ) },
                    { key: 'adjustmentNet', label: 'Adjustments', numeric: true },
                    { key: 'reversalNet', label: 'Reversals', numeric: true },
                    { key: 'unknownNet', label: 'Unknown', numeric: true },
                    { key: 'computedClosingQty', label: 'Computed closing', numeric: true },
                    { key: 'reportedStockQty', label: 'Reported stock', numeric: true, render: (r) => r.reportedStockQty ?? '—' },
                    {
                      key: 'variance', label: 'Variance', numeric: true,
                      render: (r) => r.variance === null
                        ? '—'
                        : <Badge value={Math.abs(r.variance) > 0.001 ? 'high' : 'good'} label={`${r.variance.toLocaleString()}${r.variancePct !== null ? ` (${r.variancePct}%)` : ''}`} />,
                    },
                  ]}
                  rows={data.results}
                  exportName={`reconciliation-dataset-${ws.movementsDatasetId}`}
                />
              )}
          </Card>
        </>
      )}
    </div>
  );
}
