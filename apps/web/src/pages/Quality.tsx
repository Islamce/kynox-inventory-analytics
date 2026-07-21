import { useEffect, useState } from 'react';
import { apiGet } from '../lib/api';
import { Badge, Card, EmptyState, ErrorState, Spinner } from '../components/ui';

interface DatasetRow {
  id: number; name: string; version: number; kind: string;
  rowCount: number; qualityScore: number | null; createdAt: string;
}
interface DatasetDetail {
  dataset: {
    id: number; name: string; version: number; kind: string; rowCount: number;
    qualityIssues: {
      ruleId: string; severity: string; title: string; description: string;
      recommendation: string; affectedRows: number; businessImpact: string;
      samples: { row: number; column: string; value: unknown }[];
    }[];
    qualityScores: Record<string, number> | null;
    cleansingLog: string[];
  };
}

export function QualityPage() {
  const [datasets, setDatasets] = useState<DatasetRow[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<DatasetDetail['dataset'] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<{ datasets: DatasetRow[] }>('/api/datasets')
      .then((r) => {
        setDatasets(r.datasets);
        if (r.datasets.length > 0) setSelected(r.datasets[0].id);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (selected === null) return;
    apiGet<DatasetDetail>(`/api/datasets/${selected}`)
      .then((r) => setDetail(r.dataset))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load dataset'));
  }, [selected]);

  if (loading) return <Spinner />;
  if (error) return <ErrorState message={error} />;
  if (datasets.length === 0) return <EmptyState title="No datasets yet" hint="Create one in the Data Workspace." />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-bold">Data Quality Center</h1>
        <select
          className="border border-line-strong rounded-lg px-3 py-1.5 text-sm bg-surface"
          value={selected ?? ''}
          onChange={(e) => setSelected(Number(e.target.value))}
          aria-label="Select dataset"
        >
          {datasets.map((d) => <option key={d.id} value={d.id}>{d.name} v{d.version} ({d.kind})</option>)}
        </select>
      </div>

      {detail && (
        <>
          <Card title="Quality scores" subtitle="Computed at dataset creation, per dimension">
            {detail.qualityScores
              ? (
                <div className="grid grid-cols-3 md:grid-cols-7 gap-2 text-center text-sm">
                  {Object.entries(detail.qualityScores).map(([k, v]) => (
                    <div key={k} className="bg-sunken rounded-lg p-3">
                      <p className="text-xs text-muted capitalize">{k}</p>
                      <p className={`text-lg font-bold ${v >= 90 ? 'text-emerald-700' : v >= 70 ? 'text-amber-600' : 'text-red-600'}`}>{v}</p>
                    </div>
                  ))}
                </div>
              )
              : <EmptyState title="No scores stored for this dataset" />}
          </Card>

          <Card title={`Open findings (${detail.qualityIssues.length})`} subtitle="Issues remaining after the approved cleansing">
            {detail.qualityIssues.length === 0
              ? <EmptyState title="No remaining issues" hint="All detected problems were resolved by cleansing or absent from the source." />
              : (
                <ul className="space-y-3">
                  {detail.qualityIssues.map((issue) => (
                    <li key={issue.ruleId} className="border border-line rounded-lg p-3 text-sm">
                      <div className="flex items-center gap-2">
                        <Badge value={issue.severity} />
                        <span className="font-medium">{issue.title}</span>
                        <span className="text-subtle">· {issue.affectedRows.toLocaleString()} row(s)</span>
                      </div>
                      <p className="text-muted mt-1">{issue.description}</p>
                      <p className="text-muted mt-1"><span className="font-medium">Business impact:</span> {issue.businessImpact}</p>
                      <p className="text-muted"><span className="font-medium">Recommended correction:</span> {issue.recommendation}</p>
                      {issue.samples.length > 0 && (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-brand">Affected locations (sample)</summary>
                          <ul className="text-xs text-muted mt-1 ms-4 list-disc">
                            {issue.samples.slice(0, 10).map((s, i) => (
                              <li key={i}>Row {s.row >= 0 ? s.row + 2 : '—'}, column "{s.column}": {String(s.value ?? '(empty)')}</li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </li>
                  ))}
                </ul>
              )}
          </Card>

          <Card title="Applied cleansing (transformation log)">
            {detail.cleansingLog.length === 0
              ? <EmptyState title="No cleansing was applied" />
              : <ul className="list-disc ms-5 text-sm text-muted">{detail.cleansingLog.map((l) => <li key={l}>{l}</li>)}</ul>}
          </Card>
        </>
      )}
    </div>
  );
}
