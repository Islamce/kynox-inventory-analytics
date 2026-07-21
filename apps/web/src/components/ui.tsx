import { useMemo, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Icon, type IconName } from '../design/icons';

// ---------------------------------------------------------------------------
// Shared UI primitives for the Kynox design system. Everything here is driven
// by semantic tokens (surface/body/muted/line/brand/status) so light and dark
// themes are handled automatically. Security-relevant behaviour preserved:
// the DataTable CSV export keeps its formula-injection guard byte-for-byte.
// ---------------------------------------------------------------------------

export function Card({ title, subtitle, children, actions, className }: {
  title?: string; subtitle?: string; children: ReactNode; actions?: ReactNode; className?: string;
}) {
  return (
    <section className={`bg-surface rounded-xl shadow-[var(--kx-shadow-sm)] border border-line p-4 ${className ?? ''}`}>
      {(title || actions) && (
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            {title && <h3 className="font-semibold text-body">{title}</h3>}
            {subtitle && <p className="text-xs text-muted mt-0.5">{subtitle}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

/** Page header with title, optional description and trailing actions. */
export function PageHeader({ title, description, actions }: {
  title: string; description?: ReactNode; actions?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
      <div>
        <h1 className="text-xl font-bold text-body tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted mt-1">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const variantClasses: Record<Variant, string> = {
  primary: 'bg-brand text-on-brand hover:bg-brand-hover border-transparent',
  secondary: 'bg-surface text-body border-line hover:bg-sunken',
  ghost: 'bg-transparent text-body border-transparent hover:bg-sunken',
  danger: 'bg-danger text-white border-transparent hover:opacity-90',
};

export function Button({
  variant = 'secondary', icon, children, className, ...props
}: { variant?: Variant; icon?: IconName } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 h-9 px-3.5 rounded-lg border text-sm font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none ${variantClasses[variant]} ${className ?? ''}`}
      {...props}
    >
      {icon && <Icon name={icon} size={16} />}
      {children}
    </button>
  );
}

const badgeColors: Record<string, string> = {
  critical: 'bg-danger-soft text-danger',
  high: 'bg-warning-soft text-warning',
  medium: 'bg-warning-soft text-warning',
  low: 'bg-info-soft text-info',
  info: 'bg-sunken text-muted',
  good: 'bg-success-soft text-success',
  A: 'bg-danger-soft text-danger',
  B: 'bg-warning-soft text-warning',
  C: 'bg-success-soft text-success',
  X: 'bg-success-soft text-success',
  Y: 'bg-warning-soft text-warning',
  Z: 'bg-danger-soft text-danger',
};

export function Badge({ value, label }: { value: string; label?: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${badgeColors[value] ?? 'bg-sunken text-muted'}`}>
      {label ?? value}
    </span>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-muted text-sm py-8 justify-center" role="status">
      <span className="inline-block w-4 h-4 border-2 border-line-strong border-t-brand rounded-full animate-spin" />
      {label}
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="bg-danger-soft border border-danger/30 text-danger rounded-lg p-4 text-sm flex items-start gap-2" role="alert">
      <Icon name="close" size={16} className="mt-0.5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

export function EmptyState({ title, hint, icon = 'search' }: { title: string; hint?: string; icon?: IconName }) {
  return (
    <div className="text-center py-12 text-muted">
      <span className="mx-auto mb-3 grid place-items-center w-11 h-11 rounded-full bg-sunken text-subtle">
        <Icon name={icon} size={20} />
      </span>
      <p className="font-medium text-body">{title}</p>
      {hint && <p className="text-sm mt-1 max-w-sm mx-auto">{hint}</p>}
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
  const accent = {
    good: 'var(--kx-success)', warning: 'var(--kx-warning)', critical: 'var(--kx-danger)', neutral: 'var(--kx-line-strong)',
  }[status ?? 'neutral'];
  return (
    <button
      type="button"
      onClick={onClick}
      title={definition ? `${definition}${formula ? `\nFormula: ${formula}` : ''}` : undefined}
      className="group relative bg-surface rounded-xl shadow-[var(--kx-shadow-sm)] border border-line p-4 text-left w-full hover:border-line-strong hover:shadow-[var(--kx-shadow-md)] transition-all cursor-pointer overflow-hidden"
    >
      <span className="absolute inset-x-0 top-0 h-0.5" style={{ backgroundColor: accent }} aria-hidden />
      <p className="text-[11px] text-muted font-semibold uppercase tracking-wide">{name}</p>
      <p className="text-2xl font-bold text-body mt-1.5 tabular-nums">
        {value === null || value === undefined ? '—' : typeof value === 'number' ? value.toLocaleString() : value}
        {unit && <span className="text-sm font-normal text-muted ms-1">{unit}</span>}
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
    // Prefix formula-triggering characters so Excel treats them as text (CSV injection protection).
    const cell = (v: unknown) => {
      let s = String(v ?? '');
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return `"${s.replace(/"/g, '""')}"`;
    };
    const header = columns.map((c) => cell(c.label)).join(',');
    const lines = filtered.map((r) => columns.map((c) => cell(r[c.key])).join(','));
    const blob = new Blob(['﻿' + [header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${exportName ?? 'table'}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2.5">
        {searchable && (
          <div className="relative w-64 max-w-full">
            <Icon name="search" size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-subtle" />
            <input
              className="w-full border border-line rounded-lg pl-8 pr-3 py-1.5 text-sm bg-bg text-body placeholder:text-subtle focus:border-brand"
              placeholder="Search…"
              value={filter}
              onChange={(e) => { setFilter(e.target.value); setPage(1); }}
              aria-label="Filter table rows"
            />
          </div>
        )}
        <div className="flex items-center gap-2 text-sm text-muted">
          <span className="tabular-nums">{filtered.length.toLocaleString()} rows</span>
          {exportName && (
            <Button variant="secondary" icon="reports" onClick={exportCsv} className="h-8 px-3">Export CSV</Button>
          )}
        </div>
      </div>
      <div className="overflow-auto max-h-[32rem] border border-line rounded-xl">
        <table className="data-table w-full text-sm">
          <thead>
            <tr className="bg-sunken text-muted">
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={`px-3 py-2.5 font-semibold cursor-pointer select-none whitespace-nowrap bg-sunken ${c.numeric ? 'text-right' : 'text-left'}`}
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
              <tr key={i} className="border-t border-line hover:bg-sunken/60">
                {columns.map((c) => (
                  <td key={c.key} className={`px-3 py-2 whitespace-nowrap text-body ${c.numeric ? 'text-right tabular-nums' : 'text-left'}`}>
                    {c.render ? c.render(r) : typeof r[c.key] === 'number' ? (r[c.key] as number).toLocaleString() : String(r[c.key] ?? '—')}
                  </td>
                ))}
              </tr>
            ))}
            {visible.length === 0 && (
              <tr><td colSpan={columns.length} className="px-3 py-6 text-center text-subtle">No rows match the current filter.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="flex items-center gap-2 mt-2.5 text-sm">
          <Button variant="secondary" className="h-8 px-3" disabled={current <= 1} onClick={() => setPage(current - 1)}>Prev</Button>
          <span className="text-muted tabular-nums">Page {current} / {pages}</span>
          <Button variant="secondary" className="h-8 px-3" disabled={current >= pages} onClick={() => setPage(current + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
}
