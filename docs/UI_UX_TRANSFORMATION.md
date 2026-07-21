# UI/UX Transformation — Summary & Verification

Presentation-only redesign of the Kynox frontend into a semantic design
system with a distinctive "intelligence platform" identity and full light/dark
theming. **No** analytics formula, RBAC rule, API contract, database schema or
security control changed. The Hostinger managed-hosting build/serve path
(`app.js` → `apps/api/dist/server.js`, SPA from `apps/web/dist`) is unchanged.

## What changed

| Area | Before | After |
|---|---|---|
| Tokens | 1 unused var; ~330 hardcoded `slate`/`sky` utilities | `--kx-*` primitives → semantic roles → Tailwind utilities |
| Theme | light only | light + dark + system, no-flash bootstrap |
| Identity | emoji nav, flat sidebar | self-hosted SVG icons, signature brand sidebar |
| Navigation | static sidebar only | + ⌘K command palette, account menu, theme switch |
| Primitives | plain | tokenised; added `Button`, `PageHeader` |
| Charts | fixed light chrome | themed chrome; **data palettes unchanged** |

## Where things live
- `apps/web/src/design/` — `tokens.css`, `themes.css`, `theme.ts`, `motion.ts`,
  `icons.tsx`, `design-system.md`.
- `apps/web/src/components/` — `Layout.tsx` (shell), `CommandPalette.tsx`,
  `nav.ts`, `ui.tsx` (primitives), `Chart.tsx`.
- `apps/web/index.html` — pre-paint theme bootstrap.

## Dependencies & footprint
- **Zero new runtime dependencies.** Icons, palette and theme engine are
  in-house. No external font/asset CDNs.
- Production CSS ≈ 33.5 kB (7.4 kB gzip). JS bundle unchanged in composition
  (ECharts remains the dominant chunk).

## Preserved security behaviour
- CSV formula-injection guard (`DataTable.exportCsv`) — byte-for-byte.
- HTML-escaped chart tooltip (`pages/AbcXyz.tsx`).
- Session/401 handling (`lib/api.ts`).

## How to verify
```bash
npm run build -w @kynox/web     # tsc --noEmit + vite build (must pass)
npm run dev  -w @kynox/web       # manual review
```
Manual checks:
1. Sidebar shows SVG icons (no emoji); active item has the accent rail.
2. `⌘K` / `Ctrl-K` opens the palette; arrows + Enter navigate; Esc closes.
3. Account menu → Light/Dark/System flips the whole app, charts included;
   reload preserves the choice with no flash.
4. Tables still sort/filter/paginate; **Export CSV** still neutralises
   formula-leading cells (`=`, `+`, `-`, `@`).
5. Keyboard focus is always visible; OS reduced-motion disables animations.

## Known, intentional limitations
- A few secondary status chips (emerald/amber/red) remain on fixed Tailwind
  status colours; the primary `Badge` and all chrome are tokenised. These stay
  legible in both themes and carry meaning, so they were left as-is.
