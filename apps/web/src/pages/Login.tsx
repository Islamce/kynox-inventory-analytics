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
    <div className="min-h-full flex items-center justify-center bg-slate-900 p-4">
      <form onSubmit={submit} className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-sm">
        <h1 className="text-xl font-bold text-slate-900">Kynox</h1>
        <p className="text-sm text-slate-500 mb-6">Supply Chain Intelligence</p>
        {error && <div className="mb-4"><ErrorState message={error} /></div>}
        <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="email">Email</label>
        <input
          id="email" type="email" required autoComplete="username"
          className="w-full border border-slate-300 rounded-lg px-3 py-2 mb-4"
          value={email} onChange={(e) => setEmail(e.target.value)}
        />
        <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="password">Password</label>
        <input
          id="password" type="password" required autoComplete="current-password"
          className="w-full border border-slate-300 rounded-lg px-3 py-2 mb-6"
          value={password} onChange={(e) => setPassword(e.target.value)}
        />
        <button
          type="submit" disabled={busy}
          className="w-full bg-sky-700 hover:bg-sky-800 disabled:opacity-60 text-white rounded-lg py-2 font-medium"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
