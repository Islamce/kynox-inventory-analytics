import { useEffect, useState } from 'react';
import { apiGet } from '../lib/api';
import { Badge, Card, EmptyState, ErrorState, Spinner } from '../components/ui';
import { IntelligenceHeader } from '../components/intelligence';

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

// ---- Phase 2: canonical normalization findings for movements datasets -----
interface NormalizationFinding {
  code: string; severity: string; rowNumber: number | null; columnName: string | null;
  explanation: string; recommendedCorrection: string; confidenceScore: number;
  blocksImport: boolean; userActionRequired: boolean;
}
interface NormalizationDetail {
  sourceSystem: string | null; sourceReportType: string | null;
  counts: {
    totalSourceRows: number | null; normalizedRows: number | null; rejectedRows: number | null;
    warningRows: number | null; unknownTransactionRows: number | null;
  };
  findings: NormalizationFinding[];
}

export function QualityPage() {
  const [datasets, setDatasets] = useState<DatasetRow[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<DatasetDetail['dataset'] | null>(null);
  const [normalization, setNormalization] = useState<NormalizationDetail | null>(null);
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
    setNormalization(null);
    apiGet<DatasetDetail>(`/api/datasets/${selected}`)
      .then((r) => {
        setDetail(r.dataset);
        // Phase 2: canonical normalization findings only exist for movements
        // datasets created after the normalization engine was wired in; an
        // older dataset (or a non-movements one) simply has none to show.
        if (r.dataset.kind === 'movements') {
          apiGet<NormalizationDetail>(`/api/datasets/${selected}/normalization`)
            .then(setNormalization)
            .catch(() => setNormalization(null));
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load dataset'));
  }, [selected]);

  if (loading) return <Spinner />;
  if (error) return <ErrorState message={error} />;
  if (datasets.length === 0) return <EmptyState title="No datasets yet" hint="Create one in the Data Workspace." />;

  return (
    <div className="space-y-4">
      <IntelligenceHeader
        eyebrow="Data quality"
        title="Data Quality Center"
        description="Per-dimension quality of a dataset, the findings that remain after approved cleansing, and the exact transformation log — fully transparent."
        actions={
          <select
            className="border border-line-strong rounded-lg px-3 py-1.5 text-sm bg-surface text-body"
            value={selected ?? ''}
            onChange={(e) => setSelected(Number(e.target.value))}
            aria-label="Select dataset"
          >
            {datasets.map((d) => <option key={d.id} value={d.id}>{d.name} v{d.version} ({d.kind})</option>)}
          </select>
        }
      />

      {detail && (
        <>
          <Card title="Quality scores" subtitle="Computed at dataset creation, per dimension">
            {detail.qualityScores
              ? (
                <div className="grid grid-cols-3 md:grid-cols-7 gap-2 text-center text-sm">
                  {Object.entries(detail.qualityScores).map(([k, v]) => (
                    <div key={k} className="bg-sunken rounded-lg p-3">
                      <p className="text-xs text-muted capitalize">{k}</p>
                      <p className={`text-lg font-bold ${v >= 90 ? 'text-success' : v >= 70 ? 'text-warning' : 'text-danger'}`}>{v}</p>
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
                          <summary className="cursor-pointer text-link">Affected locations (sample)</summary>
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

          {detail.kind === 'movements' && normalization && (
            <Card
              title={`Transaction normalization findings (${normalization.findings.length})`}
              subtitle="Date, sign and classification issues from the canonical normalization engine — separate from the row-level quality checks above"
            >
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center text-sm mb-3">
                <div className="bg-sunken rounded-lg p-2.5">
                  <p className="text-xs text-muted">Source</p>
                  <p className="font-semibold text-body">{normalization.sourceSystem ?? 'Unknown'}</p>
                </div>
                <div className="bg-sunken rounded-lg p-2.5">
                  <p className="text-xs text-muted">Normalized rows</p>
                  <p className="font-semibold text-body">{normalization.counts.normalizedRows ?? '—'}</p>
                </div>
                <div className="bg-sunken rounded-lg p-2.5">
                  <p className="text-xs text-muted">Rejected rows</p>
                  <p className="font-semibold text-body">{normalization.counts.rejectedRows ?? '—'}</p>
                </div>
                <div className="bg-sunken rounded-lg p-2.5">
                  <p className="text-xs text-muted">Warning rows</p>
                  <p className="font-semibold text-body">{normalization.counts.warningRows ?? '—'}</p>
                </div>
                <div className="bg-sunken rounded-lg p-2.5">
                  <p className="text-xs text-muted">Unknown type</p>
                  <p className={`font-semibold ${(normalization.counts.unknownTransactionRows ?? 0) > 0 ? 'text-warning' : 'text-body'}`}>
                    {normalization.counts.unknownTransactionRows ?? '—'}
                  </p>
                </div>
              </div>
              {normalization.findings.length === 0
                ? <EmptyState title="No normalization findings" hint="Dates, signs and transaction types were classified without issue." />
                : (
                  <ul className="space-y-3">
                    {normalization.findings.map((f, i) => (
                      <li key={i} className="border border-line rounded-lg p-3 text-sm">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge value={f.severity} />
                          <span className="font-medium">{f.code}</span>
                          {f.rowNumber !== null && <span className="text-subtle">· row {f.rowNumber + 2}</span>}
                          {f.columnName && <span className="text-subtle">· column "{f.columnName}"</span>}
                          {f.blocksImport && <Badge value="high" label="blocked import" />}
                        </div>
                        <p className="text-muted mt-1">{f.explanation}</p>
                        {f.recommendedCorrection && (
                          <p className="text-muted"><span className="font-medium">Recommended correction:</span> {f.recommendedCorrection}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
            </Card>
          )}
        </>
      )}
    </div>
  );
}
