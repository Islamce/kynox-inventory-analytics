# Database Compatibility — Executed Validation

Claimed support: SQLite (dev only), PostgreSQL (preferred), MySQL (Hostinger fallback).
All three were **actually executed** during hardening, not inferred.

## Executed results

| Database | Migrations | Rollback + re-migrate | Full API suite (44 tests) | Notes |
|---|---|---|---|---|
| SQLite (better-sqlite3 12) | ✅ | ✅ | ✅ 44/44 | dev/test default |
| PostgreSQL 16 | ✅ | ✅ | ✅ 44/44 | local cluster, `DB_CLIENT=pg`; also runs on every CI push via a service container |
| MySQL 8.4 (InnoDB, utf8mb4) | ✅ | ✅ | ✅ 44/44 | Docker container, `DB_CLIENT=mysql2` |

Two real incompatibilities were found by executing (both fixed in this branch):

1. **MySQL FK type mismatch** — `increments()` creates `INT UNSIGNED`, while FK
   columns were signed `INT`; MySQL rejects the constraint. All FK columns now
   declare `.unsigned()` (no-op on PostgreSQL/SQLite).
2. **PostgreSQL date hydration** — `pg` returns `date` columns as JS `Date`
   objects, while SQLite/MySQL return strings. `String(new Date()).slice(0,10)`
   produced garbage (`"Sat Jul 1"`). All DB-date reads now pass through a
   `toIsoDate()` normaliser; a portable `insertGetId()` helper handles the
   three drivers' different insert-return shapes (pg/SQLite `returning`,
   MySQL `insertId`).

## Risk-by-risk assessment

| Risk area | Status |
|---|---|
| JSON columns | Not used — JSON is stored in `TEXT` columns and (de)serialised in code; identical behaviour on all three engines. |
| Boolean handling | `boolean` → SQLite/MySQL `0/1`, pg `true/false`. All checks are truthiness-based; verified by the suites. |
| Dates & timestamps | `date` columns normalised via `toIsoDate()`; `datetime` defaults use `knex.fn.now()`. Verified on all three. |
| Decimal precision | Quantities/values use `double` (matches source-file precision; analytical rounding is explicit). Financial-grade `decimal` is a documented follow-up if ledger-exact aggregation is required. |
| Foreign keys | Enforced on pg/MySQL; enabled in SQLite via better-sqlite3 defaults. Cascade deletes verified by the dataset-delete test. |
| Index lengths | Longest indexed varchar is `email` 255 → 1020 bytes utf8mb4, within InnoDB DYNAMIC's 3072-byte limit (MySQL ≥ 5.7.9/8.x). Composite indexes use short columns (80/40 chars). |
| Unique constraints | Only `users.email`; MySQL's case-insensitive default collation makes it case-insensitive there — acceptable (stricter than pg, not weaker) since emails are normalised at login lookup by exact match. |
| Transaction isolation | Dataset creation runs in a single transaction (default isolation per engine); no cross-transaction read-modify-write patterns. |
| Case sensitivity | Material codes are compared exactly as stored in application code (JS `Map` keys), not via DB collation — identical across engines. |
| Migration rollback | `migrate:rollback` + re-migrate executed on all three engines; also verified in CI. |
