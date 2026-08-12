# Public demo mode (`PUBLIC_DEMO_MODE`)

## What it is

An opt-in, off-by-default mode that lets an anonymous marketing-site visitor
open the app, upload their own inventory file, and see real analysis results
(dashboard, ABC/XYZ, consumption, reconciliation, exports) — no signup, no
login screen. It exists to let the platform sell itself: "try it on your own
data" with zero friction.

It is **not** a general-purpose multi-tenant mode. It exposes exactly the
upload → analyze → export workflow, scoped so a visitor only ever sees the
data it itself uploaded.

## How it works

- `PUBLIC_DEMO_MODE=true` (env var, default `false`). When off, the app
  behaves exactly as before this feature existed — every route still requires
  a real login. Turning it back off at any time fully restores that behavior.
- With no `Authorization: Bearer` header, `requireAuth`
  (`apps/api/src/middleware/auth.ts`) falls back to resolving an anonymous
  **`guest`** identity from an `X-Guest-Session` header (a UUID the frontend
  generates once per browser and persists in `localStorage`), instead of
  returning 401. A real `Authorization` header always takes priority and
  behaves exactly as it always has — this only changes what happens when
  there is *no* token at all.
- That identity is backed by a **real row in the `users` table** (role
  `guest`, email `guest-<uuid>@anonymous.local`, an unusable random password
  hash — this account can never be used with `POST /api/auth/login`), created
  on first sight and reused on every later request from the same browser.
  Using a real row — rather than an in-memory/synthetic identity — means every
  existing owner-scoped query (`uploads.user_id`, `datasets.created_by`) and
  the audit trail (`audit_log.user_id`) work correctly for guests with zero
  additional code.
- **Permission scope** (`guest` role in `ROLE_PERMISSIONS`,
  `packages/shared-types/src/index.ts`): `upload`, `view_dataset`,
  `edit_mapping`, `approve_cleansing`, `run_analysis`, `view_financials`,
  `export`. Deliberately **excludes** `use_ai` (cost-bearing), `manage_users`,
  `delete_dataset`, `view_audit`, `change_config` — admin, user management,
  audit log and the AI chat assistant all still require a real login, even
  with demo mode on. The frontend sidebar (`Layout.tsx`) also hides those nav
  items for a guest so the demo experience doesn't dangle a link that only
  ever 403s.
- **Data isolation**: every other role shares one org-wide view of `datasets`
  by design (this is a single-tenant internal tool, not multi-tenant) — but a
  guest must never see another visitor's upload or any real business data
  already in the system. `apps/api/src/middleware/guestScope.ts` enforces
  this two ways:
  - `guardGuestDatasetParam`, registered via `router.param()` for every
    `:id`/`:stockDatasetId`/`:movementsDatasetId`/`:datasetId` path segment
    across the datasets/analytics/exports routers, checks `datasets.created_by`
    against the requester. (A plain `router.use()` middleware cannot do this —
    Express hasn't matched the specific route or parsed its params yet at
    that point in the stack; `router.param()` is the correct hook.)
  - `guardGuestDatasetQueryParams`, a normal `.use()` middleware, covers the
    handful of routes that also accept a secondary dataset id as a query
    string (`?movementsDatasetId=`).
  - `GET /api/datasets` (the list endpoint) is explicitly filtered to
    `created_by = req.user.id` for the guest role only; every other role's
    request is unaffected.
- **Rate limiting**: `guestActionLimiter()` bounds upload, dataset-preview and
  dataset-creation calls for the guest role specifically (keyed by IP, so it
  holds even if one visitor generates many session ids), independent of the
  existing global per-IP `apiLimiter`.
- **Retention**: the existing daily `runCleanup()` job
  (`apps/api/src/services/cleanup.ts`) now also deletes guest-owned datasets
  and uploads older than `GUEST_DATA_RETENTION_HOURS` (default 48h) — unlike
  real uploads, which are kept indefinitely as a traceability record, guest
  demo data is disposable by design. This runs regardless of the current
  `PUBLIC_DEMO_MODE` setting, so anything left over from a period when it was
  on still gets purged after it's turned off. **The guest's `users` row is
  intentionally never deleted** — it's the permanent audit trail of that demo
  session (`audit_log.user_id` still points to it), which is the whole reason
  a real user row is used for guests instead of an anonymous marker.

## What "we can keep log for analysis" gets you

Nothing extra to build: every guest action already flows through the same
`audit()` calls as a real user (upload, dataset creation, per-row
reclassification, analysis runs, exports), tagged with that guest's own
`user_id` and a `guest-<uuid>@anonymous.local` email. `GET /api/admin/audit`
(system_admin/data_admin/auditor only) already shows this — no change needed.
For product-usage analysis specifically, `SELECT * FROM users WHERE role =
'guest'` combined with `audit_log` gives a visit-by-visit funnel (session
created → file uploaded → dataset created → which analysis pages were hit)
without any PII beyond what the visitor themselves uploaded.

## Enabling it

```
PUBLIC_DEMO_MODE=true
GUEST_DATA_RETENTION_HOURS=48   # optional, defaults to 48
```

The server logs a loud one-time warning on startup when this is on
(`apps/api/src/server.ts`) so it's never silently enabled by an unnoticed env
var. **Before enabling this against a production database**, confirm:
- The database does not already contain real business data you would not
  want an anonymous visitor's *file upload UI* to be reachable near (data
  isolation is enforced at the query layer as described above, but the
  environment itself should still be one you're comfortable exposing a
  public write path against).
- `GUEST_DATA_RETENTION_HOURS` matches your actual comfort level for how long
  anonymous uploads sit on disk/in the database.
- The external maintenance scheduler (or `ENABLE_INPROCESS_CLEANUP=true`) is
  actually running, since guest data cleanup rides the same retention job as
  everything else — see `docs/STAGING_DEPLOYMENT.md` /
  `docs/HOSTINGER_MANAGED_DEPLOYMENT.md`.

## Honest scope limits

- **Single-process rate limiting.** `guestActionLimiter` uses an in-memory
  store (the `express-rate-limit` default). It holds correctly for the
  documented single-Node-process Hostinger deployment; a horizontally-scaled,
  multi-instance deployment would need a shared store (e.g. Redis) for guest
  rate limits to hold across instances. Not implemented — flagged here rather
  than silently assumed.
- **No content moderation on uploaded files.** The existing upload validation
  (file type, size, structural parsing) applies exactly as it does for
  authenticated users; there is no additional scanning of anonymous uploads
  for e.g. abusive content. The file only ever becomes visible to the visitor
  who uploaded it (and to staff via direct database/log access, same as any
  other upload), and is purged within `GUEST_DATA_RETENTION_HOURS`.
- **AI chat is off for guests entirely**, not just rate-limited, because it is
  the one feature with a real per-call cost. This was a judgment call made
  while implementing the feature, not something the requester specified
  explicitly — revisit if a rate-limited guest AI experience turns out to be
  wanted for the demo.
