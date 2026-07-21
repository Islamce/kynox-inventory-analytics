import { useEffect, useState } from 'react';
import { apiDownload, apiGet, apiSend } from '../lib/api';
import { useWorkspaceIds } from '../components/Layout';
import { Card, DataTable, EmptyState, ErrorState, Spinner } from '../components/ui';

interface DatasetRow {
  id: number; name: string; version: number; kind: string;
  rowCount: number; qualityScore: number | null; createdBy: string; createdAt: string;
}

export function ReportsPage() {
  const ws = useWorkspaceIds();
  const [datasets, setDatasets] = useState<DatasetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = () => {
    apiGet<{ datasets: DatasetRow[] }>('/api/datasets')
      .then((r) => setDatasets(r.datasets))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  };
  useEffect(reload, []);

  const download = async (label: string, path: string, filename: string) => {
    setBusy(label);
    setError(null);
    try {
      await apiDownload(path, filename);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed');
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: number, name: string) => {
    if (!window.confirm(`Delete dataset "${name}" (#${id})? The uploaded source file is kept, but the analysis dataset and its rows are removed.`)) return;
    try {
      await apiSend('DELETE', `/api/datasets/${id}`);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  if (loading) return <Spinner />;

  const movQs = ws.movementsDatasetId ? `?movementsDatasetId=${ws.movementsDatasetId}` : '';

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Reports & Exports</h1>
      {error && <ErrorState message={error} />}

      <Card title="Management reports" subtitle="Generated from the datasets selected in the header; every report carries dataset, period, generation info and method notes">
        {!ws.stockDatasetId
          ? <EmptyState title="Select a stock dataset in the header first" />
          : (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void download('pdf', `/api/exports/report/${ws.stockDatasetId}${movQs}`, 'management-report.pdf')}
                className="bg-brand hover:bg-brand-hover disabled:opacity-60 text-white rounded-lg px-4 py-2 text-sm font-medium"
              >
                {busy === 'pdf' ? 'Generating…' : 'Management report (PDF)'}
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void download('analysis', `/api/exports/analysis/${ws.stockDatasetId}${movQs}`, 'analysis-workbook.xlsx')}
                className="bg-[var(--kx-neutral-700)] hover:bg-[var(--kx-neutral-800)] disabled:opacity-60 text-white rounded-lg px-4 py-2 text-sm font-medium"
              >
                {busy === 'analysis' ? 'Generating…' : 'Analysis workbook (XLSX)'}
              </button>
            </div>
          )}
      </Card>

      <Card title="Datasets" subtitle="Export cleaned dataset rows, or delete datasets you no longer need (audited)">
        {datasets.length === 0
          ? <EmptyState title="No datasets yet" hint="Create one in the Data Workspace." />
          : (
            <DataTable
              searchable
              columns={[
                { key: 'id', label: 'ID', numeric: true },
                { key: 'name', label: 'Name' },
                { key: 'version', label: 'v', numeric: true },
                { key: 'kind', label: 'Kind' },
                { key: 'rowCount', label: 'Rows', numeric: true },
                { key: 'qualityScore', label: 'Quality', numeric: true },
                { key: 'createdBy', label: 'Created by' },
                {
                  key: 'actions', label: 'Actions',
                  render: (r) => (
                    <span className="flex gap-2">
                      <button type="button" className="text-brand hover:underline" onClick={() => void download(`x${r.id}`, `/api/exports/dataset/${r.id}`, `dataset-${r.id}.xlsx`)}>XLSX</button>
                      <button type="button" className="text-brand hover:underline" onClick={() => void download(`c${r.id}`, `/api/exports/dataset/${r.id}?format=csv`, `dataset-${r.id}.csv`)}>CSV</button>
                      <button type="button" className="text-red-600 hover:underline" onClick={() => void remove(Number(r.id), String(r.name))}>Delete</button>
                    </span>
                  ),
                },
              ]}
              rows={datasets as unknown as Record<string, unknown>[]}
            />
          )}
      </Card>
    </div>
  );
}
