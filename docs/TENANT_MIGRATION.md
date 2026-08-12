# Tenant Foundation Migration Strategy

This document describes the backward-compatible migration introduced by
`20260812000004_tenant_foundation.js`. It is migration preparation, not
authorization to run against production.

## Compatibility contract

- Existing user, upload, dataset, row, export, AI-log and audit IDs remain unchanged.
- Existing non-guest records are backfilled to the deterministic `legacy-default` tenant.
- Existing guest records are backfilled to the isolated `public-demo` tenant.
- Existing API clients do not submit a tenant ID. Login resolves the default active membership server-side.
- JWTs issued before this change remain compatible: when no tenant claim exists, the server resolves the user's default active membership.
- Membership role is authoritative in authenticated requests; a tenant claim is accepted only after a live membership and active-tenant lookup.
- New writes attach `tenant_id` from authenticated server context. Foreign or absent objects return the same 404 response.

## Staged rollout

1. Capture the deployed branch/SHA and database engine/version.
2. Back up the database and prove restore into a separate rehearsal environment.
3. Run the migration against the restored copy.
4. Verify unchanged row counts, complete backfill, parent/child tenant equality, memberships, indexes and application startup.
5. Run the full API suite and tenant isolation suite against the migrated copy.
6. Deploy migration and application only in an explicitly approved window.
7. Observe authentication, upload, dataset, export, audit and AI-log error rates.
8. Make tenant columns database-level non-null in a later hardening migration only after production backfill evidence proves no nulls. Until then, application reads fail closed and all new tenant-owned writes require tenant context.

## Rollback and forward-fix

The migration's `down` removes only the additive tenant columns/tables and preserves legacy row IDs/data. The automated migration test rehearses this rollback on a disposable SQLite copy. Production rollback still requires engine-specific rehearsal and approval. If tenant-owned writes occur after rollout, prefer a forward fix; removing tenant columns would discard newly recorded scope metadata.

## Required production gates

- Hostinger/runtime authority is captured rather than inferred.
- Backup and separate restore rehearsal succeeds.
- Migration-copy row-count and parent/child assertions succeed.
- Cross-tenant dataset, upload, export, AI, admin, audit and guest tests pass.
- No production migration is executed by this implementation branch.
