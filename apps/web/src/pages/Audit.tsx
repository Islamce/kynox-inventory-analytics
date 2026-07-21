import { useEffect, useState } from 'react';
import { apiGet } from '../lib/api';
import { Card, DataTable, ErrorState, Spinner } from '../components/ui';

interface AuditEntry {
  id: number; action: string; entity_type: string | null; entity_id: string | null;
  user_email: string | null; result: string; created_at: string;
  prev_value: string | null; new_value: string | null; source_ip: string | null;
}

const ACTIONS = [
  '', 'login', 'logout', 'login_failed', 'file_uploaded', 'mapping_changed',
  'cleansing_approved', 'dataset_created', 'dataset_deleted', 'analysis_run',
  'config_changed', 'ai_query', 'export', 'user_created', 'user_updated', 'role_changed',
];

export function AuditPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiGet<{ entries: AuditEntry[]; total: number }>(`/api/admin/audit?page=${page}&pageSize=50${action ? `&action=${action}` : ''}`)
      .then((r) => { setEntries(r.entries); setTotal(r.total); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load audit log (requires the view_audit permission)'))
      .finally(() => setLoading(false));
  }, [page, action]);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Audit & Governance</h1>
      <div className="flex items-center gap-2 text-sm">
        <label htmlFor="audit-action" className="text-muted">Action filter</label>
        <select id="audit-action" className="border border-line-strong rounded-lg px-2 py-1 bg-surface" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }}>
          {ACTIONS.map((a) => <option key={a} value={a}>{a || 'all actions'}</option>)}
        </select>
        <span className="text-subtle">{total.toLocaleString()} entries</span>
      </div>
      {loading && <Spinner />}
      {error && <ErrorState message={error} />}
      {!loading && !error && (
        <Card title="Audit trail" subtitle="Append-only record of critical actions; secrets are never logged">
          <DataTable
            searchable={false}
            pageSize={50}
            columns={[
              { key: 'id', label: 'ID', numeric: true },
              { key: 'created_at', label: 'Time' },
              { key: 'user_email', label: 'User' },
              { key: 'action', label: 'Action' },
              { key: 'entity_type', label: 'Entity' },
              { key: 'entity_id', label: 'Entity ID' },
              { key: 'result', label: 'Result' },
              {
                key: 'new_value', label: 'Details',
                render: (r) => {
                  const prev = r.prev_value ? `prev: ${r.prev_value}` : '';
                  const next = r.new_value ? `new: ${r.new_value}` : '';
                  const text = [prev, next].filter(Boolean).join(' → ');
                  return text ? <span className="text-xs text-muted font-mono">{text.slice(0, 160)}{text.length > 160 ? '…' : ''}</span> : '—';
                },
              },
            ]}
            rows={entries as unknown as Record<string, unknown>[]}
          />
          <div className="flex items-center gap-2 mt-2 text-sm">
            <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="px-2 py-1 border border-line-strong rounded-lg disabled:opacity-40">Prev</button>
            <span className="text-muted">Page {page} / {Math.max(1, Math.ceil(total / 50))}</span>
            <button type="button" disabled={page >= Math.ceil(total / 50)} onClick={() => setPage(page + 1)} className="px-2 py-1 border border-line-strong rounded-lg disabled:opacity-40">Next</button>
          </div>
        </Card>
      )}
    </div>
  );
}
