import { useEffect, useState, type FormEvent } from 'react';
import { apiGet, apiSend, getUser } from '../lib/api';
import { Card, DataTable, ErrorState, Spinner } from '../components/ui';

interface User { id: number; email: string; name: string; role: string; active: number | boolean; created_at: string }

const ROLES = [
  'system_admin', 'data_admin', 'supply_chain_director', 'supply_chain_manager',
  'inventory_manager', 'warehouse_manager', 'material_planner', 'inventory_controller',
  'data_analyst', 'auditor', 'executive_viewer', 'read_only',
];

export function AdminPage() {
  const me = getUser();
  const canManageUsers = me?.role === 'system_admin';
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Administration</h1>
      {canManageUsers ? <UsersSection /> : <p className="text-sm text-slate-500">User management requires the System Administrator role.</p>}
      <ConfigSection readOnly={me?.role !== 'system_admin'} />
    </div>
  );
}

function UsersSection() {
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ email: '', name: '', password: '', role: 'read_only' });

  const reload = () => {
    apiGet<{ users: User[] }>('/api/admin/users')
      .then((r) => setUsers(r.users))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load users'))
      .finally(() => setLoading(false));
  };
  useEffect(reload, []);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await apiSend('POST', '/api/admin/users', form);
      setForm({ email: '', name: '', password: '', role: 'read_only' });
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    }
  };

  const update = async (id: number, patch: Record<string, unknown>) => {
    setError(null);
    try {
      await apiSend('PATCH', `/api/admin/users/${id}`, patch);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    }
  };

  if (loading) return <Spinner />;

  return (
    <Card title="Users & roles" subtitle="All changes are recorded in the audit log">
      {error && <div className="mb-3"><ErrorState message={error} /></div>}
      <form onSubmit={create} className="grid md:grid-cols-5 gap-2 mb-4 text-sm">
        <input required type="email" placeholder="Email" className="border border-slate-300 rounded-lg px-3 py-1.5" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <input required placeholder="Name" className="border border-slate-300 rounded-lg px-3 py-1.5" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input required type="password" placeholder="Password (min 10 chars)" minLength={10} className="border border-slate-300 rounded-lg px-3 py-1.5" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        <select className="border border-slate-300 rounded-lg px-2 py-1.5 bg-white" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} aria-label="Role for new user">
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <button type="submit" className="bg-sky-700 hover:bg-sky-800 text-white rounded-lg px-3 py-1.5 font-medium">Add user</button>
      </form>
      <DataTable
        searchable={false}
        columns={[
          { key: 'id', label: 'ID', numeric: true },
          { key: 'email', label: 'Email' },
          { key: 'name', label: 'Name' },
          {
            key: 'role', label: 'Role',
            render: (r) => (
              <select
                className="border border-slate-300 rounded-lg px-2 py-1 bg-white text-xs"
                value={String(r.role)}
                onChange={(e) => void update(Number(r.id), { role: e.target.value })}
                aria-label={`Role for ${r.email}`}
              >
                {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
              </select>
            ),
          },
          {
            key: 'active', label: 'Active',
            render: (r) => (
              <button
                type="button"
                className={`text-xs px-2 py-0.5 rounded-full ${r.active ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}
                onClick={() => void update(Number(r.id), { active: !r.active })}
              >
                {r.active ? 'active' : 'inactive'}
              </button>
            ),
          },
        ]}
        rows={users as unknown as Record<string, unknown>[]}
      />
    </Card>
  );
}

function ConfigSection({ readOnly }: { readOnly: boolean }) {
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<{ config: Record<string, unknown> }>('/api/admin/config')
      .then((r) => setConfig(r.config))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load configuration'))
      .finally(() => setLoading(false));
  }, []);

  const save = async (key: string, raw: string) => {
    setError(null);
    setSaved(null);
    let value: unknown = raw;
    try { value = JSON.parse(raw); } catch { /* plain string stays a string */ }
    try {
      await apiSend('PUT', `/api/admin/config/${key}`, { value });
      setConfig((c) => ({ ...c, [key]: value }));
      setSaved(key);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    }
  };

  if (loading) return <Spinner />;

  return (
    <Card
      title="Analytical configuration"
      subtitle="Thresholds and weights used by every analysis module. Values are JSON. All changes are audited and take effect on the next analysis run."
    >
      {error && <div className="mb-3"><ErrorState message={error} /></div>}
      <div className="space-y-3">
        {Object.entries(config).map(([key, value]) => (
          <ConfigRow key={key} name={key} value={value} readOnly={readOnly} saved={saved === key} onSave={save} />
        ))}
      </div>
    </Card>
  );
}

function ConfigRow({ name, value, readOnly, saved, onSave }: {
  name: string; value: unknown; readOnly: boolean; saved: boolean;
  onSave: (key: string, raw: string) => Promise<void>;
}) {
  const [raw, setRaw] = useState(JSON.stringify(value));
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="w-56 font-medium text-slate-700">{name}</span>
      <input
        className="flex-1 min-w-64 border border-slate-300 rounded-lg px-3 py-1.5 font-mono text-xs"
        value={raw}
        readOnly={readOnly}
        onChange={(e) => setRaw(e.target.value)}
        aria-label={`Configuration ${name}`}
      />
      {!readOnly && (
        <button type="button" className="px-3 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-50" onClick={() => void onSave(name, raw)}>
          Save
        </button>
      )}
      {saved && <span className="text-emerald-700 text-xs">saved ✓</span>}
    </div>
  );
}
