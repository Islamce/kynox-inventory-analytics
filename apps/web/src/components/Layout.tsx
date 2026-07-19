import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { apiGet, clearSession, getUser, getWorkspace, setWorkspace, type Workspace } from '../lib/api';

interface DatasetOption {
  id: number;
  name: string;
  version: number;
  kind: string;
}

const NAV = [
  { to: '/', label: 'Executive Dashboard', icon: '📊' },
  { to: '/workspace', label: 'Data Workspace', icon: '📥' },
  { to: '/quality', label: 'Data Quality Center', icon: '✅' },
  { to: '/inventory', label: 'Inventory Intelligence', icon: '📦' },
  { to: '/abc-xyz', label: 'ABC–XYZ Analysis', icon: '🧮' },
  { to: '/consumption', label: 'Consumption Analytics', icon: '📈' },
  { to: '/materials', label: 'Material 360', icon: '🔍' },
  { to: '/planning', label: 'Planning & Forecasting', icon: '🗓️' },
  { to: '/ai', label: 'AI Insights Center', icon: '🤖' },
  { to: '/reports', label: 'Reports & Exports', icon: '📄' },
  { to: '/admin', label: 'Administration', icon: '⚙️' },
  { to: '/audit', label: 'Audit & Governance', icon: '🛡️' },
];

export function Layout() {
  const navigate = useNavigate();
  const user = getUser();
  const [datasets, setDatasets] = useState<DatasetOption[]>([]);
  const [ws, setWs] = useState<Workspace>(getWorkspace());
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    apiGet<{ datasets: DatasetOption[] }>('/api/datasets')
      .then((r) => setDatasets(r.datasets))
      .catch(() => setDatasets([]));
    const sync = () => setWs(getWorkspace());
    window.addEventListener('kynox-workspace-changed', sync);
    return () => window.removeEventListener('kynox-workspace-changed', sync);
  }, []);

  const update = (patch: Partial<Workspace>) => {
    const next = { ...getWorkspace(), ...patch };
    setWorkspace(next);
    setWs(next);
  };

  const stockOptions = datasets.filter((d) => d.kind === 'stock');
  const movementOptions = datasets.filter((d) => d.kind === 'movements');

  return (
    <div className="min-h-full flex">
      <aside className={`bg-slate-900 text-slate-200 w-64 shrink-0 flex-col ${navOpen ? 'flex fixed inset-y-0 z-30' : 'hidden'} lg:flex lg:static`}>
        <div className="px-4 py-4 border-b border-slate-700">
          <p className="font-bold text-white leading-tight">Kynox</p>
          <p className="text-xs text-slate-400">Supply Chain Intelligence</p>
        </div>
        <nav className="flex-1 overflow-y-auto py-2" aria-label="Main navigation">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              onClick={() => setNavOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-2 px-4 py-2 text-sm hover:bg-slate-800 ${isActive ? 'bg-slate-800 text-white border-s-2 border-sky-400' : ''}`}
            >
              <span aria-hidden>{item.icon}</span>{item.label}
            </NavLink>
          ))}
        </nav>
        <div className="px-4 py-3 border-t border-slate-700 text-xs">
          <p className="text-slate-300">{user?.name}</p>
          <p className="text-slate-500">{user?.role}</p>
          <button
            type="button"
            className="mt-2 text-sky-400 hover:text-sky-300"
            onClick={() => { clearSession(); navigate('/login'); }}
          >
            Sign out
          </button>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="bg-white border-b border-slate-200 px-4 py-2 flex flex-wrap items-center gap-3 sticky top-0 z-20">
          <button type="button" className="lg:hidden text-xl" onClick={() => setNavOpen(!navOpen)} aria-label="Toggle navigation">☰</button>
          <div className="flex items-center gap-2 text-sm">
            <label className="text-slate-500" htmlFor="ws-stock">Stock dataset</label>
            <select
              id="ws-stock"
              className="border border-slate-300 rounded-lg px-2 py-1 bg-white max-w-48"
              value={ws.stockDatasetId ?? ''}
              onChange={(e) => update({ stockDatasetId: e.target.value ? Number(e.target.value) : null })}
            >
              <option value="">— none —</option>
              {stockOptions.map((d) => <option key={d.id} value={d.id}>{d.name} v{d.version}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <label className="text-slate-500" htmlFor="ws-mov">Movements dataset</label>
            <select
              id="ws-mov"
              className="border border-slate-300 rounded-lg px-2 py-1 bg-white max-w-48"
              value={ws.movementsDatasetId ?? ''}
              onChange={(e) => update({ movementsDatasetId: e.target.value ? Number(e.target.value) : null })}
            >
              <option value="">— none —</option>
              {movementOptions.map((d) => <option key={d.id} value={d.id}>{d.name} v{d.version}</option>)}
            </select>
          </div>
        </header>
        <main className="flex-1 p-4 lg:p-6 max-w-[110rem] w-full mx-auto">
          <Outlet context={{ ws }} />
        </main>
      </div>
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
