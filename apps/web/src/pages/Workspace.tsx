import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, apiGet, apiSend, apiUpload, getWorkspace, setWorkspace } from '../lib/api';
import { Badge, Button, Card, DataTable, EmptyState, ErrorState, Spinner } from '../components/ui';
import { IntelligenceHeader, ContextChip, InsightCallout, Stepper, Meter, StatTile, Drawer, type Step } from '../components/intelligence';
import { Icon } from '../design/icons';

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

// ---- Phase 2: canonical normalization preview -----------------------------
interface NormalizationSummary {
  totalSourceRows: number; normalizedRows: number; rejectedRows: number; warningRows: number;
  unknownTransactionRows: number; receiptRows: number; consumptionRows: number; transferRows: number;
  returnRows: number; adjustmentRows: number; reversalRows: number; neutralRows: number;
  signConflicts: number; directionConflicts: number;
  totalReceiptQuantity: number; totalConsumptionQuantity: number;
  dateFormat: string | null; dateFormatConfidence: number; dateFormatUserConfirmed: boolean;
  ambiguousDateRows: number; invalidDateRows: number;
}
interface NormalizationFinding {
  code: string; severity: string; rowNumber: number | null; columnName: string | null;
  explanation: string; recommendedCorrection: string; confidenceScore: number;
  blocksImport: boolean; userActionRequired: boolean;
}
interface NormalizationDetail {
  sourceSystem: string | null; sourceReportType: string | null;
  dateFormat: { detected: string | null; selected: string | null; confidence: number | null; userConfirmed: boolean };
  summary: NormalizationSummary | null;
  findings: NormalizationFinding[];
}
interface CanonicalRow extends Record<string, unknown> {
  id: number; source_row_number: number; material_id: string; material_description: string | null;
  transaction_date: string | null; raw_quantity: string | null; signed_quantity: number | null;
  receipt_quantity: number | null; consumption_quantity: number | null; unit_of_measure: string | null;
  transaction_direction: string; transaction_category: string; transaction_type_code: string | null;
  classification_confidence: number; sign_conflict: boolean | number; direction_conflict: boolean | number;
  warehouse_name: string | null; plant_id: string | null; currency: string | null; transaction_value: number | null;
}

const CATEGORY_TONE: Record<string, string> = {
  RECEIPT: 'good', CONSUMPTION: 'medium', TRANSFER_IN: 'info', TRANSFER_OUT: 'info',
  RETURN_IN: 'info', RETURN_OUT: 'info', ADJUSTMENT_IN: 'medium', ADJUSTMENT_OUT: 'medium',
  REVERSAL_IN: 'medium', REVERSAL_OUT: 'medium', UNKNOWN: 'high',
};
const DIRECTION_TONE: Record<string, string> = { IN: 'good', OUT: 'medium', NEUTRAL: 'info', UNKNOWN: 'high' };

interface DoneResult {
  id: number; rowCount: number; cleansingLog: string[]; qualityScores: { overall: number }; kind: string;
  sourceSystem?: string; sourceReportType?: string;
  normalization?: { summary: NormalizationSummary; canonicalRowCount: number; findingCount: number };
}

// ---- Phase 2: import-time preview, before the dataset is ever created -----
interface PreImportPreview {
  kind: string; rowCount: number; excludedRowCount: number;
  wouldBlock: boolean; criticalIssues: { title: string }[];
  sourceSystem: string | null; sourceReportType: string | null;
  normalization: {
    summary: NormalizationSummary; findings: NormalizationFinding[];
    canonicalRowCount: number; ambiguousDatesNeedConfirmation: boolean;
  };
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

const PIPELINE: Step[] = [
  { key: 'upload', label: 'Upload', icon: 'workspace' },
  { key: 'detect', label: 'Detect', icon: 'search' },
  { key: 'map', label: 'Map', icon: 'database' },
  { key: 'validate', label: 'Validate', icon: 'quality' },
  { key: 'cleanse', label: 'Cleanse', icon: 'admin' },
  { key: 'approve', label: 'Approve', icon: 'audit' },
  { key: 'analyze', label: 'Analyze', icon: 'dashboard' },
];
// Map the 4 real states onto the 7-stage narrative stepper.
const STAGE_FOR_STEP = [0, 0, 2, 4, 6];

export function WorkspacePage() {
  const navigate = useNavigate();
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
  const [done, setDone] = useState<DoneResult | null>(null);
  const [detailIssue, setDetailIssue] = useState<Issue | null>(null);

  // Phase 2: ambiguous transaction-date columns block dataset creation (422)
  // until the user confirms day/month order.
  const [dateOrderRequired, setDateOrderRequired] = useState(false);
  const [dateOrderChoice, setDateOrderChoice] = useState<'DMY' | 'MDY' | null>(null);

  // Phase 2: import-time preview — see exactly how this file will be
  // normalized (source system, categories, findings) before a dataset row
  // is ever written.
  const [preImportPreview, setPreImportPreview] = useState<PreImportPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Phase 2: canonical transaction normalization preview (movements datasets).
  const [normDetail, setNormDetail] = useState<NormalizationDetail | null>(null);
  const [canonicalRows, setCanonicalRows] = useState<CanonicalRow[]>([]);
  const [canonicalTotal, setCanonicalTotal] = useState(0);
  const [canonicalLoading, setCanonicalLoading] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [directionFilter, setDirectionFilter] = useState('');

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

  const createDataset = async (dateOrder?: 'DMY' | 'MDY') => {
    if (!upload) return;
    const resolvedDateOrder = dateOrder ?? dateOrderChoice ?? undefined;
    setBusy(true); setError(null);
    try {
      const res = await apiSend<DoneResult>(
        'POST', '/api/datasets',
        {
          uploadId: upload.id,
          name: datasetName || upload.originalName,
          approvedActionIds: [...approved],
          periodStart: periodStart || undefined,
          periodEnd: periodEnd || undefined,
          dateOrder: resolvedDateOrder,
        },
      );
      setDone(res);
      setDateOrderRequired(false);
      const ws = getWorkspace();
      if (res.kind === 'stock') setWorkspace({ ...ws, stockDatasetId: res.id });
      if (res.kind === 'movements') setWorkspace({ ...ws, movementsDatasetId: res.id });
      setStep(4);
    } catch (e) {
      // Phase 2: the API blocks activation on a genuinely ambiguous transaction
      // date column (never guesses) — offer the day/month choice inline instead
      // of surfacing a raw error.
      if (e instanceof ApiError && e.status === 422 && /dateOrder/i.test(e.message)) {
        setDateOrderRequired(true);
      } else {
        fail(e);
      }
    } finally { setBusy(false); }
  };

  // Phase 2: preview exactly how this file will be normalized — source
  // system, date-order decision, category/direction breakdown, findings —
  // without writing anything. Shares the same prepareImport() pipeline the
  // server uses for real dataset creation, so what's shown here is what
  // creation will actually produce.
  const runPreview = async (dateOrder?: 'DMY' | 'MDY') => {
    if (!upload) return;
    const resolvedDateOrder = dateOrder ?? dateOrderChoice ?? undefined;
    setPreviewLoading(true); setError(null);
    try {
      const res = await apiSend<PreImportPreview>(
        'POST', '/api/datasets/preview',
        { uploadId: upload.id, approvedActionIds: [...approved], dateOrder: resolvedDateOrder },
      );
      setPreImportPreview(res);
      if (dateOrder) setDateOrderChoice(dateOrder);
    } catch (e) { fail(e); } finally { setPreviewLoading(false); }
  };

  const loadCanonical = async (datasetId: number) => {
    setCanonicalLoading(true);
    try {
      const qs = new URLSearchParams({ pageSize: '200' });
      if (categoryFilter) qs.set('category', categoryFilter);
      if (directionFilter) qs.set('direction', directionFilter);
      const res = await apiGet<{ rows: CanonicalRow[]; total: number }>(`/api/datasets/${datasetId}/canonical?${qs}`);
      setCanonicalRows(res.rows);
      setCanonicalTotal(res.total);
    } catch (e) { fail(e); } finally { setCanonicalLoading(false); }
  };

  useEffect(() => {
    if (step !== 4 || !done || done.kind !== 'movements') return;
    apiGet<NormalizationDetail>(`/api/datasets/${done.id}/normalization`).then(setNormDetail).catch(() => setNormDetail(null));
    void loadCanonical(done.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, done]);

  useEffect(() => {
    if (step !== 4 || !done || done.kind !== 'movements') return;
    void loadCanonical(done.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryFilter, directionFilter]);

  const restart = () => {
    setStep(1); setUpload(null); setValidation(null); setDone(null); setApproved(new Set());
    setDateOrderRequired(false); setDateOrderChoice(null); setPreImportPreview(null);
    setNormDetail(null); setCanonicalRows([]); setCanonicalTotal(0);
    setCategoryFilter(''); setDirectionFilter('');
  };

  const mapped = mapping.filter((m) => m.canonicalField).length;
  const critical = validation?.issues.filter((i) => i.severity === 'critical').length ?? 0;

  return (
    <div className="space-y-4">
      <IntelligenceHeader
        eyebrow="Data pipeline"
        title="Data Workspace"
        description="Turn a raw SAP export into a governed, versioned dataset — detection, mapping, validation and cleansing, with a human approving every change. The source file is never modified."
        context={<>
          <ContextChip icon="database" label="Stage" value={`${STAGE_FOR_STEP[step] + 1} of 7`} />
          {upload && <ContextChip icon="reports" label="File" value={upload.originalName} />}
          {validation && <ContextChip icon="quality" label="Quality" value={`${validation.scores.overall ?? '—'}`} />}
        </>}
      />

      <Card>
        <Stepper steps={PIPELINE} current={STAGE_FOR_STEP[step]} />
      </Card>

      {error && <ErrorState message={error} />}
      {busy && <Spinner label="Working…" />}

      {step === 1 && !busy && (
        <div className="space-y-4">
          <Card title="Upload a report" subtitle="XLSX, XLS or CSV — SAP exports are auto-detected and mapped">
            <label
              className="group border-2 border-dashed border-line-strong rounded-xl p-10 flex flex-col items-center gap-2 cursor-pointer hover:border-brand hover:bg-brand-soft/40 transition-colors"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void doUpload(f); }}
            >
              <span className="grid place-items-center w-14 h-14 rounded-2xl bg-brand-soft text-link group-hover:scale-105 transition-transform" aria-hidden>
                <Icon name="workspace" size={26} />
              </span>
              <span className="text-body font-medium">Drag &amp; drop a file here, or click to browse</span>
              <span className="text-xs text-subtle">Max 50 MB · the original file is preserved and hashed for traceability</span>
              <input
                type="file" className="hidden" accept=".xlsx,.xls,.csv"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void doUpload(f); }}
              />
            </label>
            <div className="flex flex-wrap gap-1.5 mt-3">
              {['MB52', 'MB51', 'MB5B', 'MMBE', 'MD04', 'Material master', 'Physical inventory'].map((t) => (
                <span key={t} className="text-[11px] rounded-full border border-line bg-bg px-2 py-0.5 text-muted">{t}</span>
              ))}
            </div>
          </Card>
          <UploadHistory />
        </div>
      )}

      {step === 2 && upload && !busy && (
        <div className="space-y-4">
          <div className="grid lg:grid-cols-3 gap-4">
            <Card title="Report detection" subtitle="Automatic — override if needed" className="lg:col-span-1">
              <div className="flex items-center justify-between">
                <span className="text-2xl font-bold text-body">{upload.detection.reportType}</span>
                <Badge value={upload.detection.confidence >= 0.7 ? 'good' : 'medium'} label={`${Math.round(upload.detection.confidence * 100)}%`} />
              </div>
              <div className="mt-2"><Meter value={upload.detection.confidence} label="Detection confidence" /></div>
              <div className="flex items-center gap-2 mt-3">
                <label htmlFor="rtype" className="text-xs text-muted">Override type</label>
                <select id="rtype" className="border border-line-strong rounded-lg px-2 py-1 bg-surface text-sm flex-1" value={reportType} onChange={(e) => setReportType(e.target.value)}>
                  {REPORT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <ul className="mt-3 text-xs text-muted list-disc ms-5 space-y-0.5">
                {upload.detection.reasons.slice(0, 4).map((r) => <li key={r}>{r}</li>)}
                {upload.detection.alternatives.length > 0 && (
                  <li>Alternatives: {upload.detection.alternatives.map((a) => `${a.reportType} (${Math.round(a.confidence * 100)}%)`).join(', ')}</li>
                )}
              </ul>
            </Card>

            <Card title="Column mapping" subtitle="Every source column and its canonical target" className="lg:col-span-2"
              actions={<Badge value={mapped === mapping.length ? 'good' : 'info'} label={`${mapped}/${mapping.length} mapped`} />}>
              <div className="overflow-auto max-h-96 border border-line rounded-lg" tabIndex={0} role="region" aria-label="Column mapping table">
                <table className="w-full text-sm data-table">
                  <thead>
                    <tr className="bg-sunken text-muted">
                      <th className="text-left px-3 py-2 bg-sunken font-semibold">Source column</th>
                      <th className="text-left px-3 py-2 bg-sunken font-semibold">Canonical field</th>
                      <th className="text-left px-3 py-2 bg-sunken font-semibold">Confidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mapping.map((m, i) => (
                      <tr key={m.sourceColumn} className="border-t border-line">
                        <td className="px-3 py-1.5 text-body">{m.sourceColumn}</td>
                        <td className="px-3 py-1.5">
                          <select
                            className={`border rounded-lg px-2 py-1 bg-surface w-56 ${m.canonicalField ? 'border-line-strong text-body' : 'border-warning/50 text-muted'}`}
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
                        <td className="px-3 py-1.5 w-40">
                          <div className="flex items-center gap-2">
                            <span className="w-20"><Meter value={m.confidence} /></span>
                            <span className="text-xs text-muted tabular-nums w-16">{m.method}</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 flex justify-between items-center">
                <button type="button" onClick={restart} className="text-sm text-muted hover:text-body">← Start over</button>
                <Button variant="primary" icon="arrow-right" onClick={() => void saveMapping()}>Confirm mapping &amp; validate</Button>
              </div>
            </Card>
          </div>
        </div>
      )}

      {step === 3 && validation && !busy && (
        <div className="space-y-4">
          {critical > 0
            ? <InsightCallout tone="risk" title={`${critical} critical issue${critical > 1 ? 's' : ''} block finalisation`}>
                Approve the exclusion actions below (or fix the source file) — critical rows cannot enter a dataset.
              </InsightCallout>
            : <InsightCallout tone="positive" title="No blocking issues">
                Review the proposed cleansing, then save a governed, versioned dataset. Nothing is applied without your approval.
              </InsightCallout>}

          <Card title="Data quality result" subtitle={`${validation.rowCount.toLocaleString()} rows · dataset kind: ${validation.kind}`}>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5">
              {Object.entries(validation.scores).map(([k, v]) => (
                <StatTile key={k} label={k} value={v} tone={v >= 90 ? 'positive' : v >= 70 ? 'warning' : 'risk'} />
              ))}
            </div>
          </Card>

          <Card title={`Issues found (${validation.issues.length})`} subtitle="Each finding names its business impact and recommendation — no black box">
            {validation.issues.length === 0
              ? <EmptyState title="No issues found" icon="quality" hint="The source data passed every quality rule for this report type." />
              : (
                <ul className="space-y-2.5">
                  {validation.issues.map((issue) => (
                    <li key={issue.ruleId} className="border border-line rounded-lg p-3 text-sm bg-bg">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge value={issue.severity} />
                        <span className="font-medium text-body">{issue.title}</span>
                        <span className="text-subtle">· {issue.affectedRows.toLocaleString()} row(s)</span>
                        <button type="button" onClick={() => setDetailIssue(issue)} className="ms-auto text-link text-xs hover:underline">View details →</button>
                      </div>
                      <p className="text-muted mt-1">{issue.description}</p>
                    </li>
                  ))}
                </ul>
              )}
          </Card>

          <Card title="Cleansing approval" subtitle="Nothing is applied without your approval; the original file is always preserved">
            <ul className="space-y-2">
              {validation.proposals.map((p) => (
                <li key={p.id} className="flex items-start gap-2.5 text-sm border border-line rounded-lg p-2.5 bg-bg">
                  <input
                    id={`prop-${p.id}`} type="checkbox"
                    checked={approved.has(p.id)}
                    disabled={p.type === 'flag_only'}
                    onChange={(e) => {
                      const next = new Set(approved);
                      if (e.target.checked) next.add(p.id); else next.delete(p.id);
                      setApproved(next);
                    }}
                    className="mt-0.5 accent-[var(--kx-brand)]"
                  />
                  <label htmlFor={`prop-${p.id}`} className={`flex-1 ${p.type === 'flag_only' ? 'text-subtle' : 'text-body'}`}>
                    {p.description}{' '}
                    {p.safe ? <Badge value="good" label="safe" /> : <Badge value="medium" label="review carefully" />}
                    {p.affectedRows > 0 && <span className="text-subtle"> · {p.affectedRows} row(s)</span>}
                  </label>
                </li>
              ))}
            </ul>
            <div className="grid md:grid-cols-3 gap-3 mt-4">
              <div>
                <label className="block text-xs text-muted mb-1" htmlFor="ds-name">Dataset name</label>
                <input id="ds-name" className="w-full border border-line-strong rounded-lg px-3 py-1.5 text-sm bg-surface text-body" value={datasetName} onChange={(e) => setDatasetName(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs text-muted mb-1" htmlFor="ds-start">Period start</label>
                <input id="ds-start" type="date" className="w-full border border-line-strong rounded-lg px-3 py-1.5 text-sm bg-surface text-body" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs text-muted mb-1" htmlFor="ds-end">Period end</label>
                <input id="ds-end" type="date" className="w-full border border-line-strong rounded-lg px-3 py-1.5 text-sm bg-surface text-body" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
              </div>
            </div>

            {validation.kind === 'movements' && (
              <div className="mt-4 rounded-lg border border-line p-3.5 bg-sunken/40">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <p className="font-medium text-body text-sm">Preview normalization</p>
                    <p className="text-xs text-muted">See how this file will be classified — source system, category/direction breakdown, findings — before anything is saved.</p>
                  </div>
                  <Button variant="secondary" icon="search" onClick={() => void runPreview()} disabled={previewLoading}>
                    {previewLoading ? 'Previewing…' : preImportPreview ? 'Refresh preview' : 'Preview normalization'}
                  </Button>
                </div>

                {previewLoading && <div className="mt-3"><Spinner label="Running normalization preview…" /></div>}

                {preImportPreview && !previewLoading && (
                  <div className="mt-3 space-y-3">
                    <div className="flex flex-wrap gap-1.5">
                      {preImportPreview.sourceSystem && <ContextChip icon="database" label="Source" value={preImportPreview.sourceSystem} />}
                      {preImportPreview.sourceReportType && <ContextChip label="Report" value={preImportPreview.sourceReportType} />}
                      {preImportPreview.normalization.summary.dateFormat && (
                        <ContextChip icon="quality" label="Date format" value={preImportPreview.normalization.summary.dateFormat} />
                      )}
                    </div>

                    {preImportPreview.wouldBlock && (
                      <InsightCallout tone="risk" title="This would still be blocked at save">
                        {preImportPreview.criticalIssues.length} critical issue(s) remain — approve their cleansing actions above before saving.
                      </InsightCallout>
                    )}

                    {preImportPreview.normalization.ambiguousDatesNeedConfirmation ? (
                      <div className="rounded-lg border border-warning/30 bg-warning-soft p-3">
                        <p className="text-sm font-medium text-body">Confirm the transaction date format</p>
                        <p className="text-xs text-muted mt-1">
                          Both DD/MM/YYYY and MM/DD/YYYY are possible for this file's date values, so it was not guessed.
                          Choose the format used in the source file — this choice carries through to "Apply approved cleansing".
                        </p>
                        <div className="flex flex-wrap gap-2 mt-2">
                          <Button variant={dateOrderChoice === 'DMY' ? 'primary' : 'secondary'} onClick={() => void runPreview('DMY')}>Day first — DD/MM/YYYY</Button>
                          <Button variant={dateOrderChoice === 'MDY' ? 'primary' : 'secondary'} onClick={() => void runPreview('MDY')}>Month first — MM/DD/YYYY</Button>
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5">
                        <StatTile label="Canonical rows" value={preImportPreview.normalization.canonicalRowCount} tone="neutral" />
                        <StatTile label="Receipt" value={preImportPreview.normalization.summary.receiptRows} tone="positive" />
                        <StatTile label="Consumption" value={preImportPreview.normalization.summary.consumptionRows} tone="warning" />
                        <StatTile label="Transfers" value={preImportPreview.normalization.summary.transferRows} tone="info" />
                        <StatTile label="Returns" value={preImportPreview.normalization.summary.returnRows} tone="info" />
                        <StatTile label="Adjustments" value={preImportPreview.normalization.summary.adjustmentRows} tone="warning" />
                        <StatTile label="Unknown" value={preImportPreview.normalization.summary.unknownTransactionRows}
                          tone={preImportPreview.normalization.summary.unknownTransactionRows > 0 ? 'risk' : 'positive'} />
                      </div>
                    )}

                    {preImportPreview.normalization.findings.length > 0 && (
                      <div>
                        <p className="text-sm font-medium text-body mb-1.5">
                          Normalization findings ({preImportPreview.normalization.findings.length})
                        </p>
                        <ul className="space-y-2">
                          {preImportPreview.normalization.findings.slice(0, 6).map((f, i) => (
                            <li key={i} className="border border-line rounded-lg p-2.5 text-sm bg-bg">
                              <div className="flex items-center gap-2 flex-wrap">
                                <Badge value={f.severity} />
                                <span className="font-medium text-body">{f.code}</span>
                                {f.rowNumber !== null && <span className="text-subtle">· row {f.rowNumber + 2}</span>}
                              </div>
                              <p className="text-muted mt-1">{f.explanation}</p>
                            </li>
                          ))}
                        </ul>
                        {preImportPreview.normalization.findings.length > 6 && (
                          <p className="text-xs text-subtle mt-1.5">
                            {preImportPreview.normalization.findings.length - 6} more finding(s) — full detail is shown after the dataset is saved.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {dateOrderRequired ? (
              <div className="mt-4 rounded-lg border border-warning/30 bg-warning-soft p-3.5">
                <p className="font-medium text-body text-sm">Confirm the transaction date format</p>
                <p className="text-sm text-muted mt-1">
                  The transaction date column is ambiguous — both DD/MM/YYYY and MM/DD/YYYY are possible for the values in
                  this file, so it was not guessed. Select the format actually used in the source file to continue.
                </p>
                <div className="flex flex-wrap gap-2 mt-3">
                  <Button variant="primary" onClick={() => void createDataset('DMY')}>Day first — DD/MM/YYYY</Button>
                  <Button variant="primary" onClick={() => void createDataset('MDY')}>Month first — MM/DD/YYYY</Button>
                </div>
              </div>
            ) : (
              <div className="mt-3 flex justify-between items-center">
                <button type="button" onClick={() => setStep(2)} className="text-sm text-muted hover:text-body">← Back to mapping</button>
                <Button variant="primary" icon="arrow-right" onClick={() => void createDataset()}>Apply approved cleansing &amp; save dataset</Button>
              </div>
            )}
          </Card>
        </div>
      )}

      {step === 4 && done && validation && (
        <div className="space-y-4">
          <InsightCallout tone="positive" title={`Dataset #${done.id} is ready and selected in the workspace`}
            action={<Button variant="primary" icon="dashboard" onClick={() => navigate('/')}>Open dashboard</Button>}>
            The dashboard and every analysis module now use it. Re-importing the same name creates a new version.
          </InsightCallout>

          <Card title="Before → after" subtitle="Cleansing is transparent and reversible at the source">
            <div className="grid grid-cols-3 gap-3">
              <StatTile label="Source rows" value={validation.rowCount} tone="neutral" />
              <StatTile label="Excluded" value={validation.rowCount - done.rowCount} tone={validation.rowCount - done.rowCount > 0 ? 'warning' : 'positive'} hint="critical / duplicate rows" />
              <StatTile label="Rows in dataset" value={done.rowCount} tone="positive" />
            </div>
            <div className="mt-3">
              <p className="text-sm font-medium text-body mb-1">Transformation log</p>
              <ul className="list-disc ms-5 text-sm text-muted space-y-0.5">
                {done.cleansingLog.map((l) => <li key={l}>{l}</li>)}
              </ul>
            </div>
            <div className="mt-4 flex gap-2 flex-wrap">
              <Button variant="secondary" icon="workspace" onClick={restart}>Upload another file</Button>
              <Button variant="ghost" icon="quality" onClick={() => navigate('/quality')}>Open Data Quality Center</Button>
            </div>
          </Card>

          {done.kind === 'movements' && <NormalizationPreview done={done} normDetail={normDetail}
            canonicalRows={canonicalRows} canonicalTotal={canonicalTotal} canonicalLoading={canonicalLoading}
            categoryFilter={categoryFilter} setCategoryFilter={setCategoryFilter}
            directionFilter={directionFilter} setDirectionFilter={setDirectionFilter} />}
        </div>
      )}

      <Drawer open={!!detailIssue} onClose={() => setDetailIssue(null)} title={detailIssue?.title ?? 'Issue'}>
        {detailIssue && (
          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-2"><Badge value={detailIssue.severity} /><span className="text-muted">{detailIssue.affectedRows.toLocaleString()} row(s) affected</span></div>
            <div><p className="font-medium text-body">Description</p><p className="text-muted">{detailIssue.description}</p></div>
            <div><p className="font-medium text-body">Business impact</p><p className="text-muted">{detailIssue.businessImpact}</p></div>
            <div><p className="font-medium text-body">Recommendation</p><p className="text-muted">{detailIssue.recommendation}</p></div>
            {detailIssue.samples.length > 0 && (
              <div>
                <p className="font-medium text-body">Sample locations</p>
                <ul className="text-xs text-muted mt-1 ms-4 list-disc space-y-0.5">
                  {detailIssue.samples.slice(0, 12).map((s, i) => (
                    <li key={i}>Row {s.row >= 0 ? s.row + 2 : '—'}, column "{s.column}": {String(s.value ?? '(empty)')}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}

/**
 * Phase 2 — transaction normalization preview. Shows how the source-neutral
 * engines actually classified this import: source system, date-format
 * decision, category/direction breakdown, findings, and a filterable preview
 * of the persisted canonical_transactions rows.
 */
function NormalizationPreview({
  done, normDetail, canonicalRows, canonicalTotal, canonicalLoading,
  categoryFilter, setCategoryFilter, directionFilter, setDirectionFilter,
}: {
  done: DoneResult;
  normDetail: NormalizationDetail | null;
  canonicalRows: CanonicalRow[];
  canonicalTotal: number;
  canonicalLoading: boolean;
  categoryFilter: string;
  setCategoryFilter: (v: string) => void;
  directionFilter: string;
  setDirectionFilter: (v: string) => void;
}) {
  const summary = normDetail?.summary ?? done.normalization?.summary ?? null;
  const canonicalRowCount = done.normalization?.canonicalRowCount ?? canonicalTotal;

  return (
    <Card
      title="Transaction normalization preview"
      subtitle="How the source-independent engines classified this import — canonical_transactions is the system of record for analytics"
      actions={<div className="flex flex-wrap gap-1.5">
        {normDetail?.sourceSystem && <ContextChip icon="database" label="Source" value={normDetail.sourceSystem} />}
        {normDetail?.sourceReportType && <ContextChip label="Report" value={normDetail.sourceReportType} />}
        {normDetail?.dateFormat.detected && (
          <ContextChip icon="quality" label="Date format"
            value={`${normDetail.dateFormat.detected}${normDetail.dateFormat.userConfirmed ? ' (confirmed)' : ''}`} />
        )}
      </div>}
    >
      {!summary
        ? <Spinner label="Loading normalization summary…" />
        : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5">
              <StatTile label="Canonical rows" value={canonicalRowCount} tone="neutral" />
              <StatTile label="Receipt" value={summary.receiptRows} tone="positive" hint={summary.totalReceiptQuantity.toLocaleString()} />
              <StatTile label="Consumption" value={summary.consumptionRows} tone="warning" hint={summary.totalConsumptionQuantity.toLocaleString()} />
              <StatTile label="Transfers" value={summary.transferRows} tone="info" />
              <StatTile label="Returns" value={summary.returnRows} tone="info" />
              <StatTile label="Adjustments" value={summary.adjustmentRows} tone="warning" />
              <StatTile label="Reversals" value={summary.reversalRows} tone="warning" />
              <StatTile label="Unknown" value={summary.unknownTransactionRows} tone={summary.unknownTransactionRows > 0 ? 'risk' : 'positive'}
                hint="excluded from receipt/consumption KPIs" />
            </div>

            {(summary.signConflicts > 0 || summary.directionConflicts > 0) && (
              <div className="mt-3">
                <InsightCallout tone="warning" title="Classification conflicts found">
                  {summary.signConflicts > 0 && <>Sign conflicts on {summary.signConflicts} row(s) (imported sign disagreed with the classified direction — normalized to the classification). </>}
                  {summary.directionConflicts > 0 && <>Direction conflicts on {summary.directionConflicts} row(s) (explicit direction contradicted the quantity sign). </>}
                  Review the Data Quality Center for row-level detail.
                </InsightCallout>
              </div>
            )}

            {done.normalization && done.normalization.findingCount > 0 && (
              <div className="mt-3">
                <p className="text-sm font-medium text-body mb-1.5">
                  Normalization findings ({done.normalization.findingCount})
                </p>
                <ul className="space-y-2">
                  {normDetail?.findings.slice(0, 8).map((f, i) => (
                    <li key={i} className="border border-line rounded-lg p-2.5 text-sm bg-bg">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge value={f.severity} />
                        <span className="font-medium text-body">{f.code}</span>
                        {f.rowNumber !== null && <span className="text-subtle">· row {f.rowNumber + 2}</span>}
                        {f.blocksImport && <Badge value="high" label="would block" />}
                      </div>
                      <p className="text-muted mt-1">{f.explanation}</p>
                    </li>
                  ))}
                </ul>
                {done.normalization.findingCount > 8 && (
                  <p className="text-xs text-subtle mt-1.5">
                    {done.normalization.findingCount - 8} more finding(s) — see the Data Quality Center.
                  </p>
                )}
              </div>
            )}
          </>
        )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <label className="text-xs text-muted" htmlFor="cat-filter">Category</label>
        <select id="cat-filter" className="border border-line-strong rounded-lg px-2 py-1 bg-surface text-sm"
          value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
          <option value="">All</option>
          {Object.keys(CATEGORY_TONE).map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <label className="text-xs text-muted" htmlFor="dir-filter">Direction</label>
        <select id="dir-filter" className="border border-line-strong rounded-lg px-2 py-1 bg-surface text-sm"
          value={directionFilter} onChange={(e) => setDirectionFilter(e.target.value)}>
          <option value="">All</option>
          {Object.keys(DIRECTION_TONE).map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <span className="text-xs text-subtle ms-auto">
          Showing {canonicalRows.length.toLocaleString()} of {canonicalTotal.toLocaleString()} canonical row(s)
        </span>
      </div>

      <div className="mt-2">
        {canonicalLoading
          ? <Spinner label="Loading canonical transactions…" />
          : canonicalRows.length === 0
            ? <EmptyState title="No canonical transactions match this filter" icon="database" />
            : (
              <DataTable<CanonicalRow>
                columns={[
                  { key: 'source_row_number', label: 'Row', numeric: true, render: (r) => r.source_row_number + 2 },
                  { key: 'material_id', label: 'Material' },
                  { key: 'transaction_date', label: 'Date' },
                  { key: 'raw_quantity', label: 'Raw qty', numeric: true },
                  { key: 'signed_quantity', label: 'Signed qty', numeric: true },
                  { key: 'transaction_direction', label: 'Direction', render: (r) => <Badge value={DIRECTION_TONE[r.transaction_direction] ?? 'info'} label={r.transaction_direction} /> },
                  { key: 'transaction_category', label: 'Category', render: (r) => <Badge value={CATEGORY_TONE[r.transaction_category] ?? 'info'} label={r.transaction_category} /> },
                  { key: 'classification_confidence', label: 'Confidence', render: (r) => <Meter value={r.classification_confidence} /> },
                  {
                    key: 'conflicts', label: 'Conflicts',
                    render: (r) => (r.sign_conflict || r.direction_conflict) ? <Badge value="high" label="conflict" /> : <span className="text-subtle">—</span>,
                  },
                ]}
                rows={canonicalRows}
                searchable
                exportName={`dataset-${done.id}-canonical-transactions`}
              />
            )}
      </div>
    </Card>
  );
}

function UploadHistory() {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  useEffect(() => {
    apiGet<{ uploads: Record<string, unknown>[] }>('/api/uploads').then((r) => setRows(r.uploads)).catch(() => setRows([]));
  }, []);
  if (rows.length === 0) return null;
  return (
    <Card title="Recent uploads" subtitle="Source files are retained and hashed for traceability">
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
