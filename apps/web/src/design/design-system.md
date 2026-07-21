# Kynox Design System

The Kynox frontend is built on a small, semantic design-token system. Colour,
type, spacing, radius, elevation and motion all flow from CSS custom
properties, so a single change propagates everywhere and light/dark theming is
automatic. **No component hardcodes a hex value.**

## Layers

```
tokens.css   →  raw primitives            (--kx-brand-600, --kx-neutral-100, --kx-radius-md, …)
themes.css   →  semantic roles + themes    (--kx-surface, --kx-body, --kx-brand, --kx-line, …)
@theme inline → Tailwind utilities         (bg-surface, text-muted, border-line, bg-brand, …)
components   →  consume utilities/tokens    (never raw hex)
```

- **Primitives** (`tokens.css`): the palette and scales. Change a brand hue
  here and it cascades through every role and component.
- **Semantic roles** (`themes.css`): map primitives to intent — `surface`,
  `elevated`, `sunken`, `body`, `muted`, `subtle`, `line`, `line-strong`,
  `brand`, `brand-hover`, `on-brand`, plus `success`/`warning`/`danger`/`info`
  and their `-soft` fills. Light is the default; dark is the same set of roles
  re-pointed at different primitives.
- **Tailwind bridge** (`@theme inline`): registers each role as a Tailwind
  colour so `bg-surface`, `text-muted`, `border-line`, `bg-brand`, etc. resolve
  to the *live* variable and re-theme instantly — no `dark:` variants needed.

## Theming

Three modes, persisted in `localStorage` under `kynox.theme`:

- `light` / `dark` — stamp `data-theme` on `<html>` (explicit override).
- `system` — remove `data-theme`; the CSS `prefers-color-scheme` query decides.

A tiny inline bootstrap in `index.html` applies the stored choice **before
first paint**, so there is no flash of the wrong theme. `design/theme.ts`
(`useTheme`) keeps React in sync and stays reactive to OS changes in `system`
mode. Charts observe `data-theme` and re-theme their chrome.

## Tokens (quick reference)

| Role | Utility | Use |
|---|---|---|
| App canvas | `bg-bg` | page background |
| Card / panel | `bg-surface` | primary content surface |
| Elevated | `bg-elevated` | popovers, palette, menus |
| Sunken | `bg-sunken` | table headers, insets, hovers |
| Body text | `text-body` | primary text |
| Muted / subtle | `text-muted` / `text-subtle` | secondary / tertiary text |
| Hairline | `border-line` / `border-line-strong` | dividers, inputs |
| Brand | `bg-brand` / `text-brand` / `text-on-brand` | primary actions, links |
| Status | `text-success` / `-warning` / `-danger` / `-info` (+ `bg-*-soft`) | semantics |

Radii: `rounded-sm` / `rounded-md` / `rounded-lg` / `rounded-xl`. Shadows: the
`--kx-shadow-sm` / `--kx-shadow-md` / `--kx-shadow-lg` tokens (applied via an
arbitrary shadow utility). Fonts: `font-sans` (UI), `font-mono` (codes).
Numeric cells use `tabular-nums`.

## Motion

`design/motion.ts` exposes `DURATION`, `EASING`, `usePrefersReducedMotion` and
a `transition()` helper. CSS keyframes `kx-animate-rise` / `kx-animate-fade`
cover entrances. A platform-level `prefers-reduced-motion` guard collapses all
animation/transition durations — always honour it for JS-driven motion.

## Icons

`design/icons.tsx` is a self-hosted SVG line-icon set (`<Icon name=… />`),
24×24, `currentColor`, inheriting size/colour from context. It replaced the
previous emoji navigation. **Zero external icon dependency.**

## Component set

| Component | File | Notes |
|---|---|---|
| `Card` | `components/ui.tsx` | titled content surface |
| `PageHeader` | `components/ui.tsx` | title + description + actions |
| `Button` | `components/ui.tsx` | `primary`/`secondary`/`ghost`/`danger`, optional icon |
| `Badge` | `components/ui.tsx` | status + ABC/XYZ classes |
| `Kpi` | `components/ui.tsx` | metric tile with status accent + tooltip |
| `DataTable` | `components/ui.tsx` | sort/filter/paginate + **CSV-injection-safe** export |
| `Spinner` / `ErrorState` / `EmptyState` | `components/ui.tsx` | async states |
| `Chart` | `components/Chart.tsx` | themed chrome; validated data palettes fixed |
| `CommandPalette` | `components/CommandPalette.tsx` | ⌘K navigation + actions |
| `Icon` | `design/icons.tsx` | SVG line-icon set |
| Application shell | `components/Layout.tsx` | sidebar + header + palette + theme |

## Guardrails (do not regress)

1. **CSV formula-injection guard** in `DataTable.exportCsv` — keep byte-for-byte.
2. **HTML-escaped chart tooltip** in `pages/AbcXyz.tsx` — keep the escape.
3. **Validated chart data palettes** — never re-order or recolour
   `SERIES_COLORS` / `STATUS_COLORS`; only chrome is themed.
4. **No new runtime dependencies**; **no external font/asset CDNs** (keeps
   Hostinger managed hosting self-contained).
5. **No colour hardcoding** — add a token, don't inline a hex.

## Accessibility

- WCAG-AA visible focus (`:focus-visible` brand ring, never removed).
- `prefers-reduced-motion` and `prefers-color-scheme` respected.
- Command palette: `role="dialog"`/`listbox`/`option`, arrow + Esc keys.
- Icons are `aria-hidden`; adjacent text carries the accessible label.
