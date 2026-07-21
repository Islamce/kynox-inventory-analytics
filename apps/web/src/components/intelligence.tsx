import { useEffect, type ReactNode } from 'react';
import { Icon, type IconName } from '../design/icons';

// ---------------------------------------------------------------------------
// "Intelligence" components — the vocabulary that makes every route read like a
// Kynox intelligence product rather than a generic admin screen: a signature
// page header with live context, contextual recommendation callouts, richer
// stat tiles with trend, a pipeline stepper, confidence meters and a context
// drawer. All token-driven and theme-aware; no new runtime dependencies.
// ---------------------------------------------------------------------------

export interface HeaderMetric { label: string; value: ReactNode; tone?: Tone }

/** Signature page header: eyebrow, title, description, live context chips and an optional metric strip. */
export function IntelligenceHeader({
  eyebrow = 'Intelligence', title, description, context, metrics, actions,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  context?: ReactNode;
  metrics?: HeaderMetric[];
  actions?: ReactNode;
}) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-line bg-surface mb-4">
      <span aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.5]"
        style={{ backgroundImage: 'radial-gradient(120% 140% at 0% 0%, var(--kx-brand-soft) 0%, transparent 45%)' }} />
      <div className="relative p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-brand-soft-fg">{eyebrow}</p>
            <h1 className="text-xl sm:text-2xl font-bold text-body tracking-tight mt-0.5">{title}</h1>
            {description && <p className="text-sm text-muted mt-1 max-w-3xl">{description}</p>}
            {context && <div className="flex flex-wrap items-center gap-1.5 mt-2.5">{context}</div>}
          </div>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </div>
        {metrics && metrics.length > 0 && (
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2.5">
            {metrics.map((m) => (
              <div key={m.label} className="rounded-lg border border-line bg-bg px-3 py-2">
                <p className="text-[10.5px] font-semibold uppercase tracking-wide text-muted truncate">{m.label}</p>
                <p className={`text-lg font-bold tabular-nums mt-0.5 ${toneText(m.tone)}`}>{m.value}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Small labelled context chip for the header (dataset, period, scope, …). */
export function ContextChip({ icon, label, value }: { icon?: IconName; label?: string; value: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-bg px-2.5 py-1 text-xs text-muted">
      {icon && <Icon name={icon} size={13} className="text-subtle" />}
      {label && <span className="text-subtle">{label}</span>}
      <span className="text-body font-medium">{value}</span>
    </span>
  );
}

type Tone = 'info' | 'risk' | 'positive' | 'warning' | 'neutral';

function toneText(tone?: Tone): string {
  switch (tone) {
    case 'risk': return 'text-danger';
    case 'warning': return 'text-warning';
    case 'positive': return 'text-success';
    case 'info': return 'text-link';
    default: return 'text-body';
  }
}
const toneBg: Record<Tone, string> = {
  info: 'bg-info-soft border-info/30',
  risk: 'bg-danger-soft border-danger/30',
  warning: 'bg-warning-soft border-warning/30',
  positive: 'bg-success-soft border-success/30',
  neutral: 'bg-sunken border-line',
};
const toneIcon: Record<Tone, IconName> = {
  info: 'ai', risk: 'audit', warning: 'quality', positive: 'quality', neutral: 'ai',
};

/** Contextual recommendation / narrative callout. */
export function InsightCallout({
  tone = 'info', title, children, action,
}: { tone?: Tone; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className={`rounded-xl border p-3.5 flex items-start gap-3 ${toneBg[tone]}`} role="note">
      <span className={`grid place-items-center w-8 h-8 rounded-lg bg-surface/70 shrink-0 ${toneText(tone)}`}>
        <Icon name={toneIcon[tone]} size={17} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-body text-sm">{title}</p>
        {children && <div className="text-sm text-muted mt-0.5">{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/** Rich metric tile with optional trend and status accent. */
export function StatTile({
  label, value, unit, tone = 'neutral', delta, hint, onClick,
}: {
  label: string; value: ReactNode; unit?: string; tone?: Tone;
  delta?: { value: string; direction: 'up' | 'down' | 'flat'; good?: boolean };
  hint?: string; onClick?: () => void;
}) {
  const El = onClick ? 'button' : 'div';
  return (
    <El
      {...(onClick ? { type: 'button', onClick } : {})}
      className={`relative bg-surface rounded-xl border border-line p-3.5 text-left w-full overflow-hidden ${onClick ? 'hover:border-line-strong hover:shadow-[var(--kx-shadow-sm)] transition-all' : ''}`}
    >
      <span aria-hidden className="absolute left-0 top-0 bottom-0 w-1" style={{ backgroundColor: toneVar(tone) }} />
      <p className="text-[10.5px] font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="text-xl font-bold text-body tabular-nums mt-1">
        {value}{unit && <span className="text-xs font-normal text-muted ms-1">{unit}</span>}
      </p>
      <div className="flex items-center justify-between mt-0.5">
        {hint && <span className="text-[11px] text-subtle">{hint}</span>}
        {delta && (
          <span className={`text-[11px] font-medium inline-flex items-center gap-0.5 ${delta.good === false ? 'text-danger' : delta.good ? 'text-success' : 'text-muted'}`}>
            {delta.direction === 'up' ? '▲' : delta.direction === 'down' ? '▼' : '▬'} {delta.value}
          </span>
        )}
      </div>
    </El>
  );
}

function toneVar(tone: Tone): string {
  switch (tone) {
    case 'risk': return 'var(--kx-danger)';
    case 'warning': return 'var(--kx-warning)';
    case 'positive': return 'var(--kx-success)';
    case 'info': return 'var(--kx-brand)';
    default: return 'var(--kx-line-strong)';
  }
}

export interface Step { key: string; label: string; icon: IconName }

/** Horizontal pipeline stepper with done / active / upcoming states. */
export function Stepper({ steps, current }: { steps: Step[]; current: number }) {
  return (
    <ol className="flex items-center gap-1 overflow-x-auto pb-1" aria-label="Pipeline progress">
      {steps.map((s, i) => {
        const state = i < current ? 'done' : i === current ? 'active' : 'upcoming';
        return (
          <li key={s.key} className="flex items-center gap-1 shrink-0">
            <div
              className={`flex items-center gap-2 rounded-lg px-3 py-1.5 border text-sm ${
                state === 'active' ? 'border-brand bg-brand-soft text-brand-soft-fg font-medium'
                : state === 'done' ? 'border-success/30 bg-success-soft text-success'
                : 'border-line bg-surface text-muted'
              }`}
              aria-current={state === 'active' ? 'step' : undefined}
            >
              <span className={`grid place-items-center w-5 h-5 rounded-full text-[11px] ${
                state === 'done' ? 'bg-success text-white' : state === 'active' ? 'bg-brand text-white' : 'bg-sunken text-subtle'
              }`}>
                {state === 'done' ? '✓' : i + 1}
              </span>
              <Icon name={s.icon} size={15} />
              <span className="whitespace-nowrap">{s.label}</span>
            </div>
            {i < steps.length - 1 && <span className={`w-4 h-px ${i < current ? 'bg-success' : 'bg-line-strong'}`} aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}

/** Confidence / score meter. */
export function Meter({ value, label, tone }: { value: number; label?: string; tone?: Tone }) {
  const pct = Math.max(0, Math.min(100, Math.round(value * (value <= 1 ? 100 : 1))));
  const auto: Tone = pct >= 80 ? 'positive' : pct >= 50 ? 'warning' : 'risk';
  return (
    <div>
      {label && <div className="flex justify-between text-[11px] text-muted mb-1"><span>{label}</span><span className="tabular-nums font-medium text-body">{pct}%</span></div>}
      <div className="h-1.5 rounded-full bg-sunken overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: toneVar(tone ?? auto) }} />
      </div>
    </div>
  );
}

/** Right-side context drawer (evidence, event detail). Accessible + Esc to close. */
export function Drawer({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="presentation" onMouseDown={onClose}>
      <div className="absolute inset-0 bg-[var(--kx-overlay)] kx-animate-fade" aria-hidden />
      <div
        role="dialog" aria-modal="true" aria-label={title}
        className="relative w-full max-w-md h-full bg-elevated border-s border-line shadow-[var(--kx-shadow-lg)] overflow-y-auto kx-animate-rise"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-center justify-between gap-2 px-4 py-3 border-b border-line bg-elevated">
          <h2 className="font-semibold text-body">{title}</h2>
          <button type="button" onClick={onClose} className="grid place-items-center w-8 h-8 rounded-lg hover:bg-sunken text-muted" aria-label="Close">
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}
