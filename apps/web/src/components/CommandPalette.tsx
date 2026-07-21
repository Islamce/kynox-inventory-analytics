import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon, type IconName } from '../design/icons';

/**
 * Keyboard-first command palette (⌘K / Ctrl-K). Dependency-free: a filterable,
 * arrow-navigable list of commands grouped by section. Consumers build the
 * command list (navigation, quick actions, theme) and pass it in.
 */

export interface Command {
  id: string;
  label: string;
  hint?: string;
  icon?: IconName;
  group: string;
  keywords?: string;
  run: () => void;
}

export function CommandPalette({
  open,
  onClose,
  commands,
}: {
  open: boolean;
  onClose: () => void;
  commands: Command[];
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) =>
      `${c.label} ${c.group} ${c.keywords ?? ''}`.toLowerCase().includes(q),
    );
  }, [commands, query]);

  // Reset state each time the palette opens.
  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      // Focus after the element is painted.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => setActive(0), [query]);

  // Keep the active row in view.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  if (!open) return null;

  const runAt = (i: number) => {
    const cmd = filtered[i];
    if (!cmd) return;
    onClose();
    cmd.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runAt(active);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  // Flatten for index mapping while rendering group headers.
  let rendered = -1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]"
      role="presentation"
      onMouseDown={onClose}
    >
      <div className="absolute inset-0 bg-[var(--kx-overlay)] kx-animate-fade" aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="relative w-full max-w-xl rounded-xl border border-line bg-elevated shadow-[var(--kx-shadow-lg)] kx-animate-rise overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-2 px-4 border-b border-line">
          <Icon name="search" className="text-subtle shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search pages and actions…"
            aria-label="Search commands"
            className="w-full bg-transparent py-3.5 text-body placeholder:text-subtle outline-none text-md"
          />
          <kbd className="hidden sm:inline text-[11px] text-subtle border border-line rounded px-1.5 py-0.5">Esc</kbd>
        </div>

        <div ref={listRef} className="max-h-[52vh] overflow-y-auto py-2" role="listbox" aria-label="Commands">
          {filtered.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-muted">No matching commands.</p>
          )}
          {groupOrder(filtered).map((group) => (
            <div key={group}>
              <p className="px-4 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-subtle">
                {group}
              </p>
              {filtered
                .filter((c) => c.group === group)
                .map((c) => {
                  rendered += 1;
                  const index = rendered;
                  const isActive = index === active;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      data-index={index}
                      onMouseMove={() => setActive(index)}
                      onClick={() => runAt(index)}
                      className={`w-full flex items-center gap-3 px-4 py-2 text-left text-sm ${
                        isActive ? 'bg-brand-soft text-brand-soft-fg' : 'text-body'
                      }`}
                    >
                      {c.icon && <Icon name={c.icon} className={isActive ? 'text-brand' : 'text-muted'} />}
                      <span className="flex-1">{c.label}</span>
                      {c.hint && <span className="text-xs text-subtle">{c.hint}</span>}
                    </button>
                  );
                })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Distinct groups in first-seen order. */
function groupOrder(commands: Command[]): string[] {
  const seen: string[] = [];
  for (const c of commands) if (!seen.includes(c.group)) seen.push(c.group);
  return seen;
}
