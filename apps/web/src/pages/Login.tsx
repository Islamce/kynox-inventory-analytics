import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiSend, setSession, type SessionUser } from '../lib/api';
import { ErrorState } from '../components/ui';

export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await apiSend<{ token: string; user: SessionUser }>('POST', '/api/auth/login', { email, password });
      setSession(res.token, res.user);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-full grid lg:grid-cols-2">
      {/* Brand panel */}
      <div
        className="hidden lg:flex flex-col justify-between p-10 text-white relative overflow-hidden"
        style={{ backgroundColor: 'var(--kx-neutral-950)', backgroundImage: 'radial-gradient(120% 80% at 100% 0%, #1b2a5c 0%, transparent 55%), radial-gradient(90% 70% at 0% 100%, #12aac2 0%, transparent 45%)' }}
      >
        <div className="flex items-center gap-2.5">
          <span className="grid place-items-center w-9 h-9 rounded-lg font-bold" style={{ background: 'linear-gradient(135deg, var(--kx-brand-500), var(--kx-brand-700))' }}>K</span>
          <span className="font-semibold text-lg">Kynox</span>
        </div>
        <div className="max-w-md">
          <h2 className="text-3xl font-bold leading-tight tracking-tight">Supply Chain &amp; Materials Intelligence</h2>
          <p className="mt-4 text-white/70 leading-relaxed">
            Governed analytics for SAP inventory and movements — detection,
            validation, versioned datasets and deterministic insight, with a
            human in the loop.
          </p>
        </div>
        <p className="text-xs text-white/40">Analytics workspace · source data protected · fully auditable</p>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center bg-bg p-6">
        <form onSubmit={submit} className="bg-surface rounded-2xl shadow-[var(--kx-shadow-lg)] border border-line p-8 w-full max-w-sm">
          <div className="lg:hidden flex items-center gap-2.5 mb-6">
            <span className="grid place-items-center w-9 h-9 rounded-lg font-bold text-white" style={{ background: 'linear-gradient(135deg, var(--kx-brand-500), var(--kx-brand-700))' }}>K</span>
            <span className="font-semibold text-lg text-body">Kynox</span>
          </div>
          <h1 className="text-xl font-bold text-body">Sign in</h1>
          <p className="text-sm text-muted mb-6">Access your intelligence workspace</p>
          {error && <div className="mb-4"><ErrorState message={error} /></div>}
          <label className="block text-sm font-medium text-body mb-1" htmlFor="email">Email</label>
          <input
            id="email" type="email" required autoComplete="username"
            className="w-full border border-line rounded-lg px-3 py-2 mb-4 bg-bg text-body placeholder:text-subtle focus:border-brand"
            value={email} onChange={(e) => setEmail(e.target.value)}
          />
          <label className="block text-sm font-medium text-body mb-1" htmlFor="password">Password</label>
          <input
            id="password" type="password" required autoComplete="current-password"
            className="w-full border border-line rounded-lg px-3 py-2 mb-6 bg-bg text-body placeholder:text-subtle focus:border-brand"
            value={password} onChange={(e) => setPassword(e.target.value)}
          />
          <button
            type="submit" disabled={busy}
            className="w-full bg-brand hover:bg-brand-hover disabled:opacity-60 text-on-brand rounded-lg py-2.5 font-medium transition-colors"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
