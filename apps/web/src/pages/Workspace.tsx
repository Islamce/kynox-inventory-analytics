import { useEffect, useState } from 'react';
import { apiGet, apiSend, apiUpload, getWorkspace, setWorkspace } from '../lib/api';
import { Badge, Card, DataTable, EmptyState, ErrorState, Spinner } from '../components/ui';

interface Mapping { sourceColumn: string; canonicalField: string | null; confidence: number; method: string }
interface Detection {
  reportType: string; confidence: number; matchedFields: string[];
  alternatives: { reportType: string; confidence: number }[]; reasons: string[];
}
interface UploadResult {
  id: number; originalName: string; rowCount: number;
  sheets: { name: string; rows: number }[]; activeSheet: string;
  detection: Detection; mapping: Mapping[];
}
interface Issue {
  ruleId: string; severity: string; title: string; description: string;
  recommendation: string; affectedRows: number; businessImpact: string;
  samples: { row: number; column: string; value: unknown }[];
}
interface Proposal { id: string; description: string; affectedRows: number; safe: boolean; type: string }
interface Validation {
  kind: string; rowCount: number; issues: Issue[]; proposals: Proposal[];
  scores: Record<string, number>; blocking: string | null;
}

const CANONICAL_FIELDS = [
  '', 'material', 'material_description', 'material_type', 'material_group', 'base_unit',
  'plant', 'storage_location', 'warehouse', 'bin', 'batch', 'valuation_class',
  'standard_price', 'moving_avg_price', 'currency', 'quantity', 'value',
  'unrestricted_qty', 'blocked_qty', 'quality_qty', 'in_transit_qty', 'reserved_qty',
  'safety_stock', 'reorder_point', 'min_stock', 'max_stock', 'lead_time_days',
  'movement_type', 'movement_qty', 'movement_value', 'posting_date', 'document_date',
  'document_number', 'reservation', 'purchase_order', 'purchase_requisition',
  'production_order', 'wbs_element', 'cost_center', 'vendor', 'customer', 'requester',
  'mrp_controller', 'consumption_qty', 'demand_qty', 'forecast_qty',
  'book_qty', 'counted_qty', 'count_difference',
  'last_receipt_date', 'last_issue_date', 'last_movement_date',
];

const REPORT_TYPES = ['MB52', 'MB51', 'MB5B', 'MMBE', 'MD04', 'MATERIAL_MASTER', 'PHYSICAL_INVENTORY', 'CONSUMPTION', 'RESERVATIONS', 'PURCHASE_ORDERS'];

export function WorkspacePage() {
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [upload, setUpload] = useState<UploadResult | null>(null);
  const [mapping, setMapping] = useState<Mapping[]>([]);
  const [reportType, setReportType] = useState('');
  const [validation, setValidation] = useState<Validation | null>(null);
  const [approved, setApproved] = useState<Set<string>>(new Set());
  const [datasetName, setDatasetName] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [done, setDone] = useState<{ id: number; rowCount: number; cleansingLog: string[]; qualityScores: { overall: number } } | null>(null);

  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));

  const doUpload = async (file: File) => {
    setBusy(true); setError(null);
    try {
      const res = await apiUpload<UploadResult>('/api/uploads', file);
      setUpload(res);
      setMapping(res.mapping);
      setReportType(res.detection.reportType);
      setDatasetName(file.name.replace(/\.[^.]+$/, ''));
      setStep(2);
    } catch (e) { fail(e); } finally { setBusy(false); }
  };

  const saveMapping = async () => {
    if (!upload) return;
    setBusy(true); setError(null);
    try {
      const res = await apiSend<{ mapping: Mapping[]; detection: Detection }>(
        'PUT', `/api/uploads/${upload.id}/mapping`,
        { mapping, reportType: reportType || undefined },
      );
      setMapping(res.mapping);
      setUpload({ ...upload, detection: res.detection });
      const val = await apiSend<Validation>('POST', `/api/uploads/${upload.id}/validate`);
      setValidation(val);
      setApproved(new Set(val.proposals.filter((p) => p.safe).map((p) => p.id)));
      setStep(3);
    } catch (e) { fail(e); } finally { setBusy(false); }
  };

  const createDataset = async () => {
    if (!upload) return;
    setBusy(true); setError(null);
    try {
      const res = await apiSend<{ id: number; rowCount: number; cleansingLog: string[]; qualityScores: { overall: number }; kind: string }>(
        'POST', '/api/datasets',
        {
          uploadId: upload.id,
          name: datasetName || upload.originalName,
          approvedActionIds: [...approved],
          periodStart: periodStart || undefined,
          periodEnd: periodEnd || undefined,
        },
      );
      setDone(res);
      // Convenience: auto-select the new dataset in the workspace header.
      const ws = getWorkspace();
      if (res.kind === 'stock') setWorkspace({ ...ws, stockDatasetId: res.id });
      if (res.kind === 'movements') setWorkspace({ ...ws, movementsDatasetId: res.id });
      setStep(4);
    } catch (e) { fail(e); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Data Workspace</h1>
      <ol className="flex flex-wrap gap-2 text-sm">
        {['Upload', 'Detect & map', 'Validate & cleanse', 'Dataset ready'].map((label, i) => (
          <li key={label} className={`px-3 py-1 rounded-full ${step === i + 1 ? 'bg-brand text-white' : step > i + 1 ? 'bg-emerald-100 text-emerald-800' : 'bg-sunken text-muted'}`}>
            {i + 1}. {label}
          </li>
        ))}
      </ol>
      {error && <ErrorState message={error} />}
      {busy && <Spinner label="Working…" />}

      {step === 1 && !busy && (
        <Card title="Upload a report" subtitle="XLSX, XLS or CSV — SAP exports (MB52, MB51, material master, physical inventory…) are auto-detected">
          <label
            className="border-2 border-dashed border-line-strong rounded-xl p-10 flex flex-col items-center gap-2 cursor-pointer hover:border-brand"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void doUpload(f); }}
          >
            <span className="text-3xl" aria-hidden>📥</span>
            <span className="text-muted">Drag & drop a file here, or click to browse</span>
            <span className="text-xs text-subtle">Max 50 MB · original file is never modified</span>
            <input
              type="file" className="hidden" accept=".xlsx,.xls,.csv"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void doUpload(f); }}
            />
          </label>
        </Card>
      )}

      {step === 2 && upload && !busy && (
        <div className="space-y-4">
          <Card title="Report detection" subtitle="Review the automatic detection; override if needed">
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <p>
                Detected: <span className="font-semibold">{upload.detection.reportType}</span>{' '}
                <Badge value={upload.detection.confidence >= 0.7 ? 'good' : 'medium'} label={`${Math.round(upload.detection.confidence * 100)}% confidence`} />
              </p>
              <div className="flex items-center gap-2">
                <label htmlFor="rtype" className="text-muted">Override:</label>
                <select id="rtype" className="border border-line-strong rounded-lg px-2 py-1 bg-surface" value={reportType} onChange={(e) => setReportType(e.target.value)}>
                  {REPORT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
            <ul className="mt-2 text-xs text-muted list-disc ms-5">
              {upload.detection.reasons.map((r) => <li key={r}>{r}</li>)}
              {upload.detection.alternatives.length > 0 && (
                <li>Alternatives: {upload.detection.alternatives.map((a) => `${a.reportType} (${Math.round(a.confidence * 100)}%)`).join(', ')}</li>
              )}
            </ul>
          </Card>

          <Card title="Column mapping" subtitle="Every source column and its canonical target — adjust anything the automation got wrong">
            <div className="overflow-auto max-h-96 border border-line rounded-lg">
              <table className="w-full text-sm data-table">
                <thead>
                  <tr className="bg-sunken text-muted">
                    <th className="text-left px-3 py-2 bg-sunken">Source column</th>
                    <th className="text-left px-3 py-2 bg-sunken">Canonical field</th>
                    <th className="text-left px-3 py-2 bg-sunken">Method</th>
                    <th className="text-right px-3 py-2 bg-sunken">Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {mapping.map((m, i) => (
                    <tr key={m.sourceColumn} className="border-t border-line">
                      <td className="px-3 py-1.5">{m.sourceColumn}</td>
                      <td className="px-3 py-1.5">
                        <select
                          className="border border-line-strong rounded-lg px-2 py-1 bg-surface w-56"
                          value={m.canonicalField ?? ''}
                          aria-label={`Mapping for ${m.sourceColumn}`}
                          onChange={(e) => {
                            const next = [...mapping];
                            next[i] = { ...m, canonicalField: e.target.value || null, method: 'user', confidence: e.target.value ? 1 : 0 };
                            setMapping(next);
                          }}
                        >
                          {CANONICAL_FIELDS.map((f) => <option key={f} value={f}>{f || '— unmapped —'}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-1.5 text-muted">{m.method}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{Math.round(m.confidence * 100)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex justify-end">
              <button type="button" onClick={() => void saveMapping()} className="bg-brand hover:bg-brand-hover text-white rounded-lg px-4 py-2 text-sm font-medium">
                Confirm mapping & validate →
              </button>
            </div>
          </Card>
        </div>
      )}

      {step === 3 && validation && !busy && (
        <div className="space-y-4">
          <Card title="Data quality result" subtitle={`${validation.rowCount.toLocaleString()} rows · dataset kind: ${validation.kind}`}>
            <div className="grid grid-cols-3 md:grid-cols-7 gap-2 text-center text-sm">
              {Object.entries(validation.scores).map(([k, v]) => (
                <div key={k} className="bg-sunken rounded-lg p-2">
                  <p className="text-xs text-muted capitalize">{k}</p>
                  <p className={`font-bold ${v >= 90 ? 'text-emerald-700' : v >= 70 ? 'text-amber-600' : 'text-red-600'}`}>{v}</p>
                </div>
              ))}
            </div>
            {validation.blocking && <p className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{validation.blocking}</p>}
          </Card>

          <Card title={`Issues found (${validation.issues.length})`}>
            {validation.issues.length === 0
              ? <EmptyState title="No issues found" />
              : (
                <ul className="space-y-3">
                  {validation.issues.map((issue) => (
                    <li key={issue.ruleId} className="border border-line rounded-lg p-3 text-sm">
                      <div className="flex items-center gap-2">
                        <Badge value={issue.severity} />
                        <span className="font-medium">{issue.title}</span>
                        <span className="text-subtle">· {issue.affectedRows.toLocaleString()} row(s)</span>
                      </div>
                      <p className="text-muted mt-1">{issue.description}</p>
                      <p className="text-muted mt-1"><span className="font-medium">Impact:</span> {issue.businessImpact}</p>
                      <p className="text-muted"><span className="font-medium">Recommendation:</span> {issue.recommendation}</p>
                      {issue.samples.length > 0 && (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-brand">Sample locations</summary>
                          <ul className="text-xs text-muted mt-1 ms-4 list-disc">
                            {issue.samples.slice(0, 8).map((s, i) => (
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

          <Card title="Cleansing approval" subtitle="Nothing is applied without your approval; the original file is always preserved">
            <ul className="space-y-2">
              {validation.proposals.map((p) => (
                <li key={p.id} className="flex items-start gap-2 text-sm">
                  <input
                    id={`prop-${p.id}`} type="checkbox"
                    checked={approved.has(p.id)}
                    disabled={p.type === 'flag_only'}
                    onChange={(e) => {
                      const next = new Set(approved);
                      if (e.target.checked) next.add(p.id); else next.delete(p.id);
                      setApproved(next);
                    }}
                    className="mt-0.5"
                  />
                  <label htmlFor={`prop-${p.id}`} className={p.type === 'flag_only' ? 'text-subtle' : ''}>
                    {p.description}{' '}
                    {p.safe ? <Badge value="good" label="safe" /> : <Badge value="medium" label="review carefully" />}
                  </label>
                </li>
              ))}
            </ul>
            <div className="grid md:grid-cols-3 gap-3 mt-4">
              <div>
                <label className="block text-xs text-muted mb-1" htmlFor="ds-name">Dataset name</label>
                <input id="ds-name" className="w-full border border-line-strong rounded-lg px-3 py-1.5 text-sm" value={datasetName} onChange={(e) => setDatasetName(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs text-muted mb-1" htmlFor="ds-start">Period start</label>
                <input id="ds-start" type="date" className="w-full border border-line-strong rounded-lg px-3 py-1.5 text-sm" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs text-muted mb-1" htmlFor="ds-end">Period end</label>
                <input id="ds-end" type="date" className="w-full border border-line-strong rounded-lg px-3 py-1.5 text-sm" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
              </div>
            </div>
            <div className="mt-3 flex justify-between">
              <button type="button" onClick={() => setStep(2)} className="text-sm text-muted hover:text-body">← Back to mapping</button>
              <button type="button" onClick={() => void createDataset()} className="bg-brand hover:bg-brand-hover text-white rounded-lg px-4 py-2 text-sm font-medium">
                Apply approved cleansing & save dataset →
              </button>
            </div>
          </Card>
        </div>
      )}

      {step === 4 && done && (
        <Card title="Dataset ready ✓">
          <p className="text-sm">Dataset #{done.id} created with {done.rowCount.toLocaleString()} rows. Overall quality score: <span className="font-semibold">{done.qualityScores.overall}</span>.</p>
          <p className="text-sm text-muted mt-1">It has been selected in the workspace header — the dashboard and all analysis modules now use it.</p>
          <details className="mt-2 text-sm">
            <summary className="cursor-pointer text-brand">Transformation log</summary>
            <ul className="list-disc ms-5 text-muted mt-1">
              {done.cleansingLog.map((l) => <li key={l}>{l}</li>)}
            </ul>
          </details>
          <button type="button" onClick={() => { setStep(1); setUpload(null); setValidation(null); setDone(null); }} className="mt-4 bg-[var(--kx-neutral-700)] hover:bg-[var(--kx-neutral-800)] text-white rounded-lg px-4 py-2 text-sm">
            Upload another file
          </button>
        </Card>
      )}

      <UploadHistory />
    </div>
  );
}

function UploadHistory() {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  useEffect(() => {
    apiGet<{ uploads: Record<string, unknown>[] }>('/api/uploads').then((r) => setRows(r.uploads)).catch(() => setRows([]));
  }, []);
  if (rows.length === 0) return null;
  return (
    <Card title="Recent uploads">
      <DataTable
        columns={[
          { key: 'id', label: 'ID', numeric: true },
          { key: 'originalName', label: 'File' },
          { key: 'detectedType', label: 'Detected type' },
          { key: 'status', label: 'Status' },
          { key: 'createdAt', label: 'Uploaded at' },
        ]}
        rows={rows}
        searchable={false}
      />
    </Card>
  );
}
