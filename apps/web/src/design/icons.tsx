import type { SVGProps } from 'react';

/**
 * Kynox icon system — a small, self-hosted set of stroke line icons that
 * replaces the previous emoji navigation. Every glyph inherits `currentColor`
 * and a 24×24 viewBox, so size and colour come from the surrounding text.
 * No external icon dependency: zero added bundle weight and no supply chain.
 */

export type IconName =
  | 'dashboard'
  | 'workspace'
  | 'quality'
  | 'inventory'
  | 'abcxyz'
  | 'consumption'
  | 'materials'
  | 'planning'
  | 'ai'
  | 'reports'
  | 'admin'
  | 'audit'
  | 'search'
  | 'command'
  | 'sun'
  | 'moon'
  | 'system'
  | 'menu'
  | 'close'
  | 'chevron-down'
  | 'chevron-right'
  | 'arrow-right'
  | 'logout'
  | 'user'
  | 'database';

const PATHS: Record<IconName, JSX.Element> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </>
  ),
  workspace: (
    <>
      <path d="M4 4h16v12H4z" />
      <path d="M4 16l2.5 4h11L20 16" />
      <path d="M12 6v6m0 0-2.5-2.5M12 12l2.5-2.5" />
    </>
  ),
  quality: (
    <>
      <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
      <path d="M9 11.5l2 2 4-4" />
    </>
  ),
  inventory: (
    <>
      <path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5z" />
      <path d="M3.5 7.5 12 12l8.5-4.5M12 12v9" />
    </>
  ),
  abcxyz: (
    <>
      <path d="M4 20V4" />
      <path d="M4 20h16" />
      <rect x="7" y="12" width="3" height="5" rx="0.6" />
      <rect x="12" y="8" width="3" height="9" rx="0.6" />
      <rect x="17" y="5" width="3" height="12" rx="0.6" />
    </>
  ),
  consumption: (
    <>
      <path d="M4 19V5" />
      <path d="M4 19h16" />
      <path d="M6 15l4-5 3.5 3L20 6" />
      <path d="M20 10V6h-4" />
    </>
  ),
  materials: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="M11 8v6M8 11h6" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  planning: (
    <>
      <rect x="3.5" y="5" width="17" height="16" rx="2" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" />
      <path d="M7.5 13.5h3v3h-3z" />
    </>
  ),
  ai: (
    <>
      <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z" />
      <path d="M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z" />
    </>
  ),
  reports: (
    <>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4" />
      <path d="M9 12h6M9 15.5h6M9 8.5h2" />
    </>
  ),
  admin: (
    <>
      <path d="M4 7h16M4 12h16M4 17h16" />
      <circle cx="9" cy="7" r="2" />
      <circle cx="15" cy="12" r="2" />
      <circle cx="8" cy="17" r="2" />
    </>
  ),
  audit: (
    <>
      <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
      <circle cx="12" cy="10.5" r="2" />
      <path d="M12 12.5v3" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-3.8-3.8" />
    </>
  ),
  command: (
    <path d="M8 6a2 2 0 1 0 2 2h4a2 2 0 1 0 2-2 2 2 0 0 0-2 2v4a2 2 0 1 0 2 2 2 2 0 0 0-2-2h-4a2 2 0 1 0-2 2 2 2 0 0 0 2-2V8a2 2 0 0 0-2-2z" />
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  moon: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />,
  system: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  'chevron-down': <path d="m6 9 6 6 6-6" />,
  'chevron-right': <path d="m9 6 6 6-6 6" />,
  'arrow-right': <path d="M5 12h14M13 6l6 6-6 6" />,
  logout: (
    <>
      <path d="M15 4h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-3" />
      <path d="M10 12H3M6 8l-3 4 3 4" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="6" rx="7" ry="3" />
      <path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6" />
      <path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" />
    </>
  ),
};

export function Icon({
  name,
  size = 18,
  strokeWidth = 1.7,
  ...props
}: { name: IconName; size?: number; strokeWidth?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {PATHS[name]}
    </svg>
  );
}
