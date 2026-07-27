import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { getToken } from './lib/api';
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

function RequireAuth({ children }: { children: JSX.Element }) {
  return getToken() ? children : <Navigate to="/login" replace />;
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
