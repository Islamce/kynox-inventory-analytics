import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { apiGet, getPublicConfig, getToken, setGuestUser, type SessionUser } from './lib/api';
import { Spinner } from './components/ui';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/Login';
import { DashboardPage } from './pages/Dashboard';
import { WorkspacePage } from './pages/Workspace';
import { QualityPage } from './pages/Quality';
import { InventoryPage } from './pages/Inventory';
import { ReconciliationPage } from './pages/Reconciliation';
import { AbcXyzPage } from './pages/AbcXyz';
import { ConsumptionPage } from './pages/Consumption';
import { Material360Page } from './pages/Material360';
import { PlanningPage } from './pages/Planning';
import { AiCenterPage } from './pages/AiCenter';
import { ReportsPage } from './pages/Reports';
import { AdminPage } from './pages/Admin';
import { AuditPage } from './pages/Audit';

type AuthGate = 'checking' | 'allow' | 'deny';

/**
 * Real logins pass through instantly (unchanged fast path — no network wait).
 * With no token, this checks GET /api/config/public: when PUBLIC_DEMO_MODE is
 * on, it resolves (and caches for display) the anonymous guest identity via
 * GET /api/auth/me — which apiGet already sends with the X-Guest-Session
 * fallback header — and lets the visitor through with no login at all.
 * Everything server-side still enforces the guest permission scope; this is
 * purely about not forcing a login screen in front of the public demo.
 */
function RequireAuth({ children }: { children: JSX.Element }) {
  const [gate, setGate] = useState<AuthGate>(getToken() ? 'allow' : 'checking');

  useEffect(() => {
    if (getToken()) { setGate('allow'); return; }
    let cancelled = false;
    getPublicConfig().then(({ publicDemoMode }) => {
      if (cancelled) return;
      if (!publicDemoMode) { setGate('deny'); return; }
      apiGet<{ user: SessionUser }>('/api/auth/me')
        .then((r) => { if (!cancelled) { setGuestUser(r.user); setGate('allow'); } })
        .catch(() => { if (!cancelled) setGate('deny'); });
    });
    return () => { cancelled = true; };
  }, []);

  if (gate === 'checking') return <div className="min-h-full grid place-items-center"><Spinner /></div>;
  return gate === 'allow' ? children : <Navigate to="/login" replace />;
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAuth><Layout /></RequireAuth>}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/workspace" element={<WorkspacePage />} />
          <Route path="/quality" element={<QualityPage />} />
          <Route path="/inventory" element={<InventoryPage />} />
          <Route path="/reconciliation" element={<ReconciliationPage />} />
          <Route path="/abc-xyz" element={<AbcXyzPage />} />
          <Route path="/consumption" element={<ConsumptionPage />} />
          <Route path="/materials" element={<Material360Page />} />
          <Route path="/planning" element={<PlanningPage />} />
          <Route path="/ai" element={<AiCenterPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/audit" element={<AuditPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
