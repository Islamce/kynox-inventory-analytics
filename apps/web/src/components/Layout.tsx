import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { apiGet, clearSession, getUser, getWorkspace, setWorkspace, type Workspace } from '../lib/api';
import { Icon, type IconName } from '../design/icons';
import { useTheme, type ThemeMode } from '../design/theme';
import { NAV } from './nav';
import { CommandPalette, type Command } from './CommandPalette';

interface DatasetOption {
  id: number;
  name: string;
  version: number;
  kind: string;
}

const SECTIONS: Array<NavItemSection> = ['Overview', 'Analysis', 'Governance'];
type NavItemSection = 'Overview' | 'Analysis' | 'Governance';

export function Layout() {
  const navigate = useNavigate();
  const user = getUser();
  const { mode, resolved, setThemeMode, cycle } = useTheme();
  const [datasets, setDatasets] = useState<DatasetOption[]>([]);
  const [ws, setWs] = useState<Workspace>(getWorkspace());
  const [navOpen, setNavOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    apiGet<{ datasets: DatasetOption[] }>('/api/datasets')
      .then((r) => setDatasets(r.datasets))
      .catch(() => setDatasets([]));
    const sync = () => setWs(getWorkspace());
    window.addEventListener('kynox-workspace-changed', sync);
    return () => window.removeEventListener('kynox-workspace-changed', sync);
  }, []);

  // Global ⌘K / Ctrl-K to open the command palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const update = (patch: Partial<Workspace>) => {
    const next = { ...getWorkspace(), ...patch };
    setWorkspace(next);
    setWs(next);
  };

  const signOut = () => { clearSession(); navigate('/login'); };

  const stockOptions = datasets.filter((d) => d.kind === 'stock');
  const movementOptions = datasets.filter((d) => d.kind === 'movements');

  const commands: Command[] = useMemo(() => {
    const nav: Command[] = NAV.map((n) => ({
      id: `nav:${n.to}`,
      label: n.label,
      group: 'Navigate',
      icon: n.icon,
      run: () => navigate(n.to),
    }));
    const actions: Command[] = [
      { id: 'theme:light', label: 'Theme: Light', group: 'Preferences', icon: 'sun', run: () => setThemeMode('light') },
      { id: 'theme:dark', label: 'Theme: Dark', group: 'Preferences', icon: 'moon', run: () => setThemeMode('dark') },
      { id: 'theme:system', label: 'Theme: System', group: 'Preferences', icon: 'system', run: () => setThemeMode('system') },
      { id: 'action:signout', label: 'Sign out', group: 'Account', icon: 'logout', run: signOut },
    ];
    return [...nav, ...actions];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate]);

  return (
    <div className="min-h-full flex bg-bg text-body">
      {/* Mobile scrim */}
      {navOpen && (
        <div className="fixed inset-0 z-30 bg-[var(--kx-overlay)] lg:hidden" onClick={() => setNavOpen(false)} aria-hidden />
      )}

      {/* Sidebar — signature brand-tinted surface */}
      <aside
        className={`w-64 shrink-0 flex-col text-[var(--kx-sidebar-fg)] ${navOpen ? 'flex fixed inset-y-0 z-40' : 'hidden'} lg:flex lg:static`}
        style={{ backgroundColor: 'var(--kx-sidebar-bg)', backgroundImage: 'var(--kx-sidebar-grad)' }}
      >
        <div className="px-5 py-5 flex items-center gap-2.5" style={{ borderBottom: '1px solid var(--kx-sidebar-line)' }}>
          <span
            className="grid place-items-center w-8 h-8 rounded-lg font-bold text-white"
            style={{ background: 'linear-gradient(135deg, var(--kx-brand-500), var(--kx-brand-700))' }}
            aria-hidden
          >
            K
          </span>
          <div className="leading-tight">
            <p className="font-semibold text-white">Kynox</p>
            <p className="text-[11px]" style={{ color: 'var(--kx-sidebar-fg-dim)' }}>Supply Chain Intelligence</p>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto py-3" aria-label="Main navigation">
          {SECTIONS.map((section) => (
            <div key={section} className="mb-2">
              <p className="px-5 pt-2 pb-1 text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: 'var(--kx-sidebar-fg-dim)' }}>
                {section}
              </p>
              {NAV.filter((i) => i.section === section).map((item) => (
                <SidebarLink key={item.to} to={item.to} label={item.label} icon={item.icon} onNavigate={() => setNavOpen(false)} />
              ))}
            </div>
          ))}
        </nav>

        <div className="px-4 py-3" style={{ borderTop: '1px solid var(--kx-sidebar-line)' }}>
          <UserMenu name={user?.name} role={user?.role} mode={mode} onMode={setThemeMode} onSignOut={signOut} placement="up" />
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="bg-surface/95 backdrop-blur border-b border-line px-3 sm:px-4 py-2.5 flex items-center gap-2 sm:gap-3 sticky top-0 z-20">
          <button
            type="button"
            className="lg:hidden grid place-items-center w-9 h-9 rounded-lg hover:bg-sunken text-body"
            onClick={() => setNavOpen(!navOpen)}
            aria-label="Toggle navigation"
          >
            <Icon name="menu" />
          </button>

          {/* Command palette trigger */}
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="group flex items-center gap-2 h-9 px-3 rounded-lg border border-line bg-bg hover:border-line-strong text-muted text-sm min-w-0"
            aria-label="Open command palette"
          >
            <Icon name="search" size={16} />
            <span className="hidden sm:inline">Search…</span>
            <kbd className="hidden md:inline ml-2 text-[11px] border border-line rounded px-1 py-0.5 group-hover:border-line-strong">⌘K</kbd>
          </button>

          <div className="flex-1" />

          {/* Workspace dataset selectors */}
          <div className="hidden md:flex items-center gap-2">
            <DatasetSelect
              id="ws-stock" label="Stock" icon="database"
              value={ws.stockDatasetId}
              options={stockOptions}
              onChange={(v) => update({ stockDatasetId: v })}
            />
            <DatasetSelect
              id="ws-mov" label="Movements" icon="consumption"
              value={ws.movementsDatasetId}
              options={movementOptions}
              onChange={(v) => update({ movementsDatasetId: v })}
            />
          </div>

          <button
            type="button"
            onClick={cycle}
            className="grid place-items-center w-9 h-9 rounded-lg border border-line hover:bg-sunken text-body"
            aria-label={`Theme: ${mode} (${resolved}). Click to change.`}
            title={`Theme: ${mode}`}
          >
            <Icon name={mode === 'system' ? 'system' : mode === 'dark' ? 'moon' : 'sun'} />
          </button>
        </header>

        {/* Mobile dataset selectors */}
        <div className="md:hidden flex items-center gap-2 px-3 py-2 border-b border-line bg-surface overflow-x-auto">
          <DatasetSelect id="ws-stock-m" label="Stock" icon="database" value={ws.stockDatasetId} options={stockOptions} onChange={(v) => update({ stockDatasetId: v })} />
          <DatasetSelect id="ws-mov-m" label="Movements" icon="consumption" value={ws.movementsDatasetId} options={movementOptions} onChange={(v) => update({ movementsDatasetId: v })} />
        </div>

        <main className="flex-1 p-4 lg:p-6 max-w-[110rem] w-full mx-auto">
          <div className="kx-animate-fade">
            <Outlet context={{ ws }} />
          </div>
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={commands} />
    </div>
  );
}

function SidebarLink({ to, label, icon, onNavigate }: { to: string; label: string; icon: IconName; onNavigate: () => void }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      onClick={onNavigate}
      className={({ isActive }) =>
        `relative flex items-center gap-3 mx-2 px-3 py-2 rounded-lg text-[13.5px] transition-colors ${
          isActive ? 'text-white' : 'hover:text-white'
        }`
      }
      style={({ isActive }) =>
        isActive
          ? { backgroundColor: 'var(--kx-sidebar-active)' }
          : undefined
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full" style={{ backgroundColor: 'var(--kx-sidebar-accent)' }} aria-hidden />
          )}
          <Icon name={icon} className={isActive ? 'text-[var(--kx-sidebar-accent)]' : ''} />
          <span>{label}</span>
        </>
      )}
    </NavLink>
  );
}

function DatasetSelect({
  id, label, icon, value, options, onChange,
}: {
  id: string; label: string; icon: IconName;
  value: number | null;
  options: DatasetOption[];
  onChange: (v: number | null) => void;
}) {
  return (
    <div className="flex items-center gap-1.5 h-9 px-2.5 rounded-lg border border-line bg-bg text-sm">
      <Icon name={icon} size={15} className="text-subtle shrink-0" />
      <label htmlFor={id} className="text-muted shrink-0">{label}</label>
      <select
        id={id}
        className="bg-transparent text-body outline-none max-w-[9rem] cursor-pointer"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      >
        <option value="">— none —</option>
        {options.map((d) => <option key={d.id} value={d.id}>{d.name} v{d.version}</option>)}
      </select>
    </div>
  );
}

function UserMenu({
  name, role, mode, onMode, onSignOut, placement,
}: {
  name?: string; role?: string;
  mode: ThemeMode; onMode: (m: ThemeMode) => void;
  onSignOut: () => void;
  placement: 'up' | 'down';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);
  const initials = (name ?? '?').split(' ').map((s) => s[0]).slice(0, 2).join('').toUpperCase();
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-[var(--kx-sidebar-hover)]"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="grid place-items-center w-8 h-8 rounded-full text-white text-xs font-semibold shrink-0" style={{ background: 'linear-gradient(135deg, var(--kx-brand-500), var(--kx-brand-700))' }}>
          {initials}
        </span>
        <span className="min-w-0 flex-1 text-left leading-tight">
          <span className="block truncate text-[13px] text-white">{name ?? 'User'}</span>
          <span className="block truncate text-[11px]" style={{ color: 'var(--kx-sidebar-fg-dim)' }}>{role}</span>
        </span>
        <Icon name="chevron-down" size={15} style={{ color: 'var(--kx-sidebar-fg-dim)' }} />
      </button>

      {open && (
        <div
          role="menu"
          className={`absolute ${placement === 'up' ? 'bottom-full mb-2' : 'top-full mt-2'} left-0 right-0 rounded-lg border border-line bg-elevated text-body shadow-[var(--kx-shadow-lg)] p-1.5 kx-animate-rise`}
        >
          <p className="px-2 pt-1 pb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-subtle">Theme</p>
          <div className="grid grid-cols-3 gap-1 px-1 pb-1.5">
            {(['light', 'dark', 'system'] as ThemeMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => onMode(m)}
                className={`flex flex-col items-center gap-1 py-1.5 rounded-md text-[11px] capitalize border ${
                  mode === m ? 'border-brand text-brand bg-brand-soft' : 'border-line text-muted hover:bg-sunken'
                }`}
              >
                <Icon name={m === 'light' ? 'sun' : m === 'dark' ? 'moon' : 'system'} size={16} />
                {m}
              </button>
            ))}
          </div>
          <div className="h-px bg-line my-1" />
          <button
            type="button"
            role="menuitem"
            onClick={onSignOut}
            className="w-full flex items-center gap-2 px-2 py-2 rounded-md text-sm text-body hover:bg-sunken"
          >
            <Icon name="logout" size={16} className="text-muted" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function useWorkspaceIds(): Workspace {
  const [ws, setWs] = useState<Workspace>(getWorkspace());
  useEffect(() => {
    const sync = () => setWs(getWorkspace());
    window.addEventListener('kynox-workspace-changed', sync);
    return () => window.removeEventListener('kynox-workspace-changed', sync);
  }, []);
  return ws;
}
