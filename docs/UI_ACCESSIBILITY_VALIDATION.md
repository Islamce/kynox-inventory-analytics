# UI Accessibility Validation — Kynox Supply Chain Intelligence

Automated and manual accessibility validation of the redesigned frontend.
**No blanket WCAG-compliance claim is made** — this records what was tested,
the tool used, the measured results, and the known limits of that evidence.

## Automated tool + scope
- **axe-core 4.10** (rulesets `wcag2a` + `wcag2aa`) run in a real Chromium
  browser against the running application seeded with the UAT datasets.
- Coverage: **all 13 routes × {light, dark} = 26 page states.**
  Login (unauthenticated) plus the 12 authenticated routes; Material 360 and
  Planning were exercised with a real material loaded.

## Result
**0 serious or critical violations across all 26 route×theme states** after the
fixes below (baseline had contrast, chart-name and scroll-region issues).

| Issue class | Baseline | After fixes |
|---|---|---|
| `color-contrast` (serious) | present on most routes, worst in dark mode | 0 |
| `role-img-alt` (charts) | charts had no accessible name | 0 |
| `scrollable-region-focusable` | scroll containers not keyboard-focusable | 0 |

### Fixes applied
- Raised `--kx-muted` / `--kx-subtle` to AA-contrast neutrals in both themes.
- Added a dedicated **link token** (`--kx-link`, lighter on dark surfaces) so
  text links meet AA where a single brand colour could not serve both button
  fills and on-dark text.
- Darkened the light-theme `success` / `warning` semantic colours so badge text
  on soft backgrounds meets AA.
- Gave `Chart` an `aria-label` (default + per-use overrides available).
- Made `DataTable` and the mapping table scroll regions `tabIndex=0` with a
  `role="region"` accessible name.
- Tied ABC–XYZ matrix text colour to the actual cell fill so ink/paper contrast
  stays AA.
- Tokenised the last hardcoded status colours (Quality scores, Material 360).

## Manual checks (performed)
| Check | Result |
|---|---|
| Keyboard-only navigation of shell (sidebar links, header, selectors) | Reachable and operable |
| Visible focus | `:focus-visible` brand ring on all interactive elements; never removed |
| Command palette | `role="dialog"` + `listbox`/`option`; open (⌘K), arrow keys, Enter, Esc |
| Context drawer / modal | `role="dialog"`, `aria-modal`, Esc to close, overlay click to dismiss |
| Charts | `role="img"` with accessible name; underlying figures also available as tables |
| Tables | Keyboard-scrollable regions; sortable headers are buttons-in-effect |
| Form errors | `role="alert"` error state; inputs have associated `<label>`s |
| Reduced motion | Platform-level `prefers-reduced-motion` guard collapses animation/transition |
| Dark / light / system theme | Honoured; no flash; contrast validated in both |

## Limits of this evidence (honest scope)
- Automated scanning catches a subset of WCAG (notably contrast, names, roles).
  It does **not** replace a full manual audit with real assistive technology.
- **Not yet done:** screen-reader pass (NVDA/VoiceOver), 200% zoom reflow
  verification on every route, and full keyboard traversal of every deep
  interaction. These are recommended before a formal conformance statement.
- Therefore: this is **"0 automated axe A/AA violations + targeted manual
  checks"**, not a certified WCAG 2.1 AA conformance claim.

## How to reproduce
Build and start the app, then run axe against each route in a headless browser
(the review tooling used `playwright-core` + `axe-core` with a bypass-CSP test
context so the scanner can be injected — the app's own strict CSP is unchanged).
The committed Playwright smoke suite (`apps/web/e2e/smoke.spec.ts`) additionally
asserts render, dark mode, mobile navigation, the command palette, and **no
horizontal overflow at mobile width** on every main route.
