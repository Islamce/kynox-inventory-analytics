# UI/UX Audit — Kynox Supply Chain Intelligence

Baseline audit of the frontend before the design-system transformation. Scope
is presentation only: **no** analytics formula, RBAC, API contract, database
schema, or security control is in scope for change. Two security-relevant
presentation behaviours are called out as *must-preserve*.

## Method
Static review of `apps/web/src` (13 pages, shared `components/`, `lib/api.ts`,
`styles.css`, Tailwind 4 + Vite setup). Usage of colour utilities was counted
directly from source.

## Findings

### 1. No design token layer (Critical for consistency)
- A single unused `--brand: #0f4c81` custom property; everything else is raw
  Tailwind `slate`/`sky` utilities.
- **~330 hardcoded colour utilities** across pages/components
  (`text-slate-500` ×61, `border-slate-300` ×36, `bg-white` ×22,
  `text-sky-700` ×19, …). No single source of truth; a brand change would be a
  find-and-replace across the whole app.
- **Resolution:** `--kx-*` primitives (`design/tokens.css`) → semantic roles
  (`design/themes.css`) → Tailwind utilities via `@theme inline`
  (`bg-surface`, `text-muted`, `border-line`, `bg-brand`, …).

### 2. Light-only, no theming
- No dark mode, no theme switch, no `prefers-color-scheme` handling, no
  `prefers-reduced-motion` handling.
- **Resolution:** full light + dark parity from semantic tokens; a
  system/light/dark switch with a no-flash pre-paint bootstrap; platform-level
  reduced-motion guard.

### 3. Generic identity
- Emoji navigation icons (📊 📥 ✅ 📦 …) — inconsistent across OSs, not brand
  aligned, and not accessible as meaningful glyphs.
- Flat `slate-900` sidebar and `sky-700` buttons read as a default Tailwind
  starter, not an "intelligence platform".
- **Resolution:** self-hosted SVG line-icon set (`design/icons.tsx`, zero new
  dependencies); signature brand-tinted sidebar; refined surface/elevation
  system.

### 4. Navigation & information architecture
- Static sidebar + two header dataset selectors; no command palette, no
  keyboard-first navigation.
- "Sign out" is a bare text link; there is no user/account menu.
- **Resolution:** ⌘K / Ctrl-K command palette (navigate + quick actions),
  refined workspace selectors, and an account menu with the theme control.

### 5. Primitives are sound but plain
- `Card`, `Kpi`, `DataTable`, `Badge`, `Spinner`, `ErrorState`, `EmptyState`
  are well-factored and reused everywhere — the highest-leverage surface to
  restyle (one change lifts all 13 pages).
- **Resolution:** re-skin primitives against semantic tokens; add `Button`,
  `PageHeader`, `Toolbar`, `Tabs`, `StatTrend` to reach a documented 10+
  component set.

### 6. Charts
- ECharts with a **validated 8-hue categorical palette** and **fixed status
  colours** (`SERIES_COLORS`, `STATUS_COLORS`) — semantically load-bearing.
- **Resolution:** keep the data palette exactly as-is; theme only the chrome
  (axis lines, labels, split lines, tooltip surface) so charts read correctly
  in both light and dark.

## Must-preserve (security-relevant presentation)
| Behaviour | Location | Guarantee |
|---|---|---|
| CSV formula-injection guard | `components/ui.tsx` `DataTable.exportCsv` | Cells beginning `= + - @ TAB CR` are prefixed with `'`; kept byte-for-byte. |
| HTML-escaped chart tooltip | `pages/AbcXyz.tsx` | Material names escaped before injection into ECharts tooltip HTML; unchanged. |
| Auth/session handling | `lib/api.ts` | 401 clears session and redirects; token flow untouched. |

## Non-goals
No route changes, no API shape changes, no new runtime dependencies, no
external font/asset CDNs (keeps Hostinger managed hosting self-contained), and
no change to the `app.js` → `apps/api/dist/server.js` build/serve path.

## Success criteria
1. All colour decisions flow from `--kx-*` tokens.
2. Light + dark parity across shell, primitives, charts and pages.
3. Emoji navigation replaced by the SVG icon set.
4. Keyboard command palette available on every authenticated screen.
5. WCAG-AA focus visibility and reduced-motion respected.
6. Zero new runtime dependencies; CI stays green; build/serve path unchanged.
