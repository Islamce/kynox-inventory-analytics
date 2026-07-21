import { useEffect, useState } from 'react';
import { apiDownload, apiGet, apiSend } from '../lib/api';
import { useWorkspaceIds } from '../components/Layout';
import { Button, Card, DataTable, EmptyState, ErrorState, Spinner } from '../components/ui';
import { IntelligenceHeader, ContextChip } from '../components/intelligence';
import { Icon, type IconName } from '../design/icons';

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

  const templates: { key: string; title: string; format: string; icon: IconName; description: string; path: string; filename: string }[] = ws.stockDatasetId ? [
    { key: 'pdf', title: 'Executive management report', format: 'PDF', icon: 'reports', description: 'Narrative summary with KPIs, risks and recommendations for senior management — carries dataset, period and method notes.', path: `/api/exports/report/${ws.stockDatasetId}${movQs}`, filename: 'management-report.pdf' },
    { key: 'analysis', title: 'Analysis workbook', format: 'XLSX', icon: 'abcxyz', description: 'Full multi-sheet workbook — position, ABC–XYZ, aging, excess, shortage and consumption — for offline analysis.', path: `/api/exports/analysis/${ws.stockDatasetId}${movQs}`, filename: 'analysis-workbook.xlsx' },
  ] : [];

  return (
    <div className="space-y-4">
      <IntelligenceHeader
        eyebrow="Report studio"
        title="Reports & Exports"
        description="Generate governed management reports from the selected datasets, and export any cleaned dataset. Every artefact records its dataset, period and generation method."
        context={<ContextChip icon="database" label="Datasets" value={`${datasets.length} available`} />}
      />
      {error && <ErrorState message={error} />}

      <Card title="Report templates" subtitle="Generated from the datasets selected in the header">
        {!ws.stockDatasetId
          ? <EmptyState title="Select a stock dataset in the header first" icon="database" hint="Templates generate from the active stock (and optional movements) dataset." />
          : (
            <div className="grid sm:grid-cols-2 gap-3">
              {templates.map((t) => (
                <div key={t.key} className="border border-line rounded-xl p-4 bg-bg flex flex-col">
                  <div className="flex items-center gap-2.5 mb-2">
                    <span className="grid place-items-center w-10 h-10 rounded-lg bg-brand-soft text-link"><Icon name={t.icon} size={20} /></span>
                    <div>
                      <p className="font-semibold text-body">{t.title}</p>
                      <span className="text-[11px] rounded-full border border-line px-1.5 py-0.5 text-muted">{t.format}</span>
                    </div>
                  </div>
                  <p className="text-sm text-muted flex-1">{t.description}</p>
                  <div className="mt-3">
                    <Button variant="primary" icon="reports" disabled={busy !== null} onClick={() => void download(t.key, t.path, t.filename)}>
                      {busy === t.key ? 'Generating…' : `Generate ${t.format}`}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
      </Card>

      <Card title="Dataset exports" subtitle="Export cleaned dataset rows (CSV export is formula-injection-safe), or delete datasets you no longer need (audited)">
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
                      <button type="button" className="text-link hover:underline" onClick={() => void download(`x${r.id}`, `/api/exports/dataset/${r.id}`, `dataset-${r.id}.xlsx`)}>XLSX</button>
                      <button type="button" className="text-link hover:underline" onClick={() => void download(`c${r.id}`, `/api/exports/dataset/${r.id}?format=csv`, `dataset-${r.id}.csv`)}>CSV</button>
                      <button type="button" className="text-danger hover:underline" onClick={() => void remove(Number(r.id), String(r.name))}>Delete</button>
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
