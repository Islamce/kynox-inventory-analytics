import { useMemo, useState, type ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Small shared UI primitives: cards, badges, states, KPI tiles, data table.
// ---------------------------------------------------------------------------

export function Card({ title, subtitle, children, actions }: {
  title?: string; subtitle?: string; children: ReactNode; actions?: ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
      {(title || actions) && (
        <div className="flex items-start justify-between mb-3">
          <div>
            {title && <h3 className="font-semibold text-slate-800">{title}</h3>}
            {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}

const badgeColors: Record<string, string> = {
  critical: 'bg-red-100 text-red-800',
  high: 'bg-orange-100 text-orange-800',
  medium: 'bg-amber-100 text-amber-800',
  low: 'bg-sky-100 text-sky-800',
  info: 'bg-slate-100 text-slate-700',
  good: 'bg-emerald-100 text-emerald-800',
  A: 'bg-red-100 text-red-800',
  B: 'bg-amber-100 text-amber-800',
  C: 'bg-emerald-100 text-emerald-800',
  X: 'bg-emerald-100 text-emerald-800',
  Y: 'bg-amber-100 text-amber-800',
  Z: 'bg-red-100 text-red-800',
};

export function Badge({ value, label }: { value: string; label?: string }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${badgeColors[value] ?? 'bg-slate-100 text-slate-700'}`}>
      {label ?? value}
    </span>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-slate-500 text-sm py-8 justify-center" role="status">
      <span className="inline-block w-4 h-4 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />
      {label}
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-4 text-sm" role="alert">
      {message}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="text-center py-10 text-slate-500">
      <p className="font-medium">{title}</p>
      {hint && <p className="text-sm mt-1">{hint}</p>}
    </div>
  );
}

export function Kpi({ name, value, unit, status, definition, formula, onClick }: {
  name: string;
  value: string | number | null;
  unit?: string;
  status?: 'good' | 'warning' | 'critical' | 'neutral';
  definition?: string;
  formula?: string;
  onClick?: () => void;
}) {
  const statusBar = {
    good: 'bg-emerald-500', warning: 'bg-amber-500', critical: 'bg-red-500', neutral: 'bg-slate-300',
  }[status ?? 'neutral'];
  return (
    <button
      type="button"
      onClick={onClick}
      title={definition ? `${definition}${formula ? `\nFormula: ${formula}` : ''}` : undefined}
      className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 text-left w-full hover:shadow-md transition-shadow cursor-pointer"
    >
      <div className={`h-1 rounded-full mb-3 ${statusBar}`} aria-hidden />
      <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">{name}</p>
      <p className="text-2xl font-bold text-slate-900 mt-1">
        {value === null || value === undefined ? '—' : typeof value === 'number' ? value.toLocaleString() : value}
        {unit && <span className="text-sm font-normal text-slate-500 ms-1">{unit}</span>}
      </p>
    </button>
  );
}

// ---------------------------------------------------------------------------
// DataTable with sorting, filtering, pagination and CSV export.
// ---------------------------------------------------------------------------

export interface Column<T> {
  key: string;
  label: string;
  render?: (row: T) => ReactNode;
  numeric?: boolean;
}

export function DataTable<T extends Record<string, unknown>>({ columns, rows, pageSize = 15, searchable = true, exportName }: {
  columns: Column<T>[];
  rows: T[];
  pageSize?: number;
  searchable?: boolean;
  exportName?: string;
}) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortAsc, setSortAsc] = useState(true);
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    let out = rows;
    if (filter.trim()) {
      const f = filter.toLowerCase();
      out = rows.filter((r) => columns.some((c) => String(r[c.key] ?? '').toLowerCase().includes(f)));
    }
    if (sortKey) {
      out = [...out].sort((a, b) => {
        const av = a[sortKey];
        const bv = b[sortKey];
        if (typeof av === 'number' && typeof bv === 'number') return sortAsc ? av - bv : bv - av;
        return sortAsc
          ? String(av ?? '').localeCompare(String(bv ?? ''))
          : String(bv ?? '').localeCompare(String(av ?? ''));
      });
    }
    return out;
  }, [rows, filter, sortKey, sortAsc, columns]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const current = Math.min(page, pages);
  const visible = filtered.slice((current - 1) * pageSize, current * pageSize);

  const exportCsv = () => {
    const header = columns.map((c) => `"${c.label}"`).join(',');
    const lines = filtered.map((r) => columns.map((c) => `"${String(r[c.key] ?? '').replace(/"/g, '""')}"`).join(','));
    const blob = new Blob(['﻿' + [header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${exportName ?? 'table'}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2">
        {searchable && (
          <input
            className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm w-64 bg-white"
            placeholder="Search…"
            value={filter}
            onChange={(e) => { setFilter(e.target.value); setPage(1); }}
            aria-label="Filter table rows"
          />
        )}
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <span>{filtered.length.toLocaleString()} rows</span>
          {exportName && (
            <button type="button" onClick={exportCsv} className="px-2 py-1 rounded-lg border border-slate-300 hover:bg-slate-50 text-slate-700">
              Export CSV
            </button>
          )}
        </div>
      </div>
      <div className="overflow-auto max-h-[32rem] border border-slate-200 rounded-lg">
        <table className="data-table w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-slate-600">
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={`px-3 py-2 font-medium cursor-pointer select-none whitespace-nowrap ${c.numeric ? 'text-right' : 'text-left'} bg-slate-50`}
                  onClick={() => {
                    if (sortKey === c.key) setSortAsc(!sortAsc);
                    else { setSortKey(c.key); setSortAsc(true); }
                  }}
                >
                  {c.label}{sortKey === c.key ? (sortAsc ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((r, i) => (
              <tr key={i} className="border-t border-slate-100 hover:bg-slate-50">
                {columns.map((c) => (
                  <td key={c.key} className={`px-3 py-1.5 whitespace-nowrap ${c.numeric ? 'text-right tabular-nums' : 'text-left'}`}>
                    {c.render ? c.render(r) : typeof r[c.key] === 'number' ? (r[c.key] as number).toLocaleString() : String(r[c.key] ?? '—')}
                  </td>
                ))}
              </tr>
            ))}
            {visible.length === 0 && (
              <tr><td colSpan={columns.length} className="px-3 py-6 text-center text-slate-400">No rows match the current filter.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="flex items-center gap-2 mt-2 text-sm">
          <button type="button" disabled={current <= 1} onClick={() => setPage(current - 1)} className="px-2 py-1 border border-slate-300 rounded-lg disabled:opacity-40">Prev</button>
          <span className="text-slate-500">Page {current} / {pages}</span>
          <button type="button" disabled={current >= pages} onClick={() => setPage(current + 1)} className="px-2 py-1 border border-slate-300 rounded-lg disabled:opacity-40">Next</button>
        </div>
      )}
    </div>
  );
}
