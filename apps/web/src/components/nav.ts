import type { IconName } from '../design/icons';

/** Primary navigation — shared by the sidebar and the command palette. */
export interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  section: 'Overview' | 'Analysis' | 'Governance';
}

export const NAV: NavItem[] = [
  { to: '/', label: 'Executive Dashboard', icon: 'dashboard', section: 'Overview' },
  { to: '/workspace', label: 'Data Workspace', icon: 'workspace', section: 'Overview' },
  { to: '/quality', label: 'Data Quality Center', icon: 'quality', section: 'Overview' },
  { to: '/inventory', label: 'Inventory Intelligence', icon: 'inventory', section: 'Analysis' },
  { to: '/reconciliation', label: 'Inventory Reconciliation', icon: 'database', section: 'Analysis' },
  { to: '/abc-xyz', label: 'ABC–XYZ Analysis', icon: 'abcxyz', section: 'Analysis' },
  { to: '/consumption', label: 'Consumption Analytics', icon: 'consumption', section: 'Analysis' },
  { to: '/materials', label: 'Material 360', icon: 'materials', section: 'Analysis' },
  { to: '/planning', label: 'Planning & Forecasting', icon: 'planning', section: 'Analysis' },
  { to: '/ai', label: 'AI Insights Center', icon: 'ai', section: 'Analysis' },
  { to: '/reports', label: 'Reports & Exports', icon: 'reports', section: 'Governance' },
  { to: '/admin', label: 'Administration', icon: 'admin', section: 'Governance' },
  { to: '/audit', label: 'Audit & Governance', icon: 'audit', section: 'Governance' },
];
