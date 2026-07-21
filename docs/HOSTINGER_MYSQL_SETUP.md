# Hostinger MySQL Setup — Analytics

Production database is **Hostinger MySQL** with `DB_CLIENT=mysql2`. The schema
and full API test suite are verified on **MySQL 8.4** (CI + local). Hostinger
may provide a different exact MySQL/MariaDB version — **inspect the actual
version after connecting; do not assume 8.4.**

## Create the database (hPanel)

hPanel → **Websites → Manage → Databases → Management**:
1. Create a **dedicated** database, e.g. `kynox_analytics`.
2. Create a **dedicated least-privilege user**, e.g. `kynox_app`, with rights on
   that database only.
3. **Do not reuse** the WMS/website database, user, or the MySQL root account.
4. Record: host, database name, user, port (3306), version if shown. **Never
   record the password in Git or docs.**

Recommended charset/collation: **`utf8mb4`** with a compatible collation
(e.g. `utf8mb4_general_ci` / `utf8mb4_0900_ai_ci`). Knex/mysql2 default to
utf8mb4.

## Connection test (from a hPanel DB tool or terminal, no password echoed)

```bash
mysql -h <DB_HOST> -P 3306 -u <DB_USER> -p <DB_NAME> -e "SELECT VERSION(), CURRENT_USER();"
```

`/api/readiness` also performs a live `SELECT 1` against MySQL and returns 503
if the connection fails.

## Compatibility — verified points

The migrations are MySQL-safe (no PostgreSQL-specific SQL). Verified on 8.4:

| Area | Status / note |
|---|---|
| Unsigned foreign keys | FK columns declared `.unsigned()` to match `increments()` (`INT UNSIGNED`) — MySQL requires this |
| Timestamp / datetime defaults | `datetime` with `knex.fn.now()` default |
| Dates | date columns normalised in code via `toIsoDate()` (driver returns strings/Dates differently) |
| JSON | stored in `TEXT` columns (portable), (de)serialised in code — no engine-specific JSON type |
| Booleans | stored as `0/1`; all checks are truthiness-based |
| Decimal precision | quantities/values use `double` (source-file precision; explicit rounding in analytics) |
| Text index lengths | longest indexed varchar is `email` (255) → within InnoDB DYNAMIC limits on utf8mb4 |
| Unique constraints | only `users.email` (MySQL default collation makes it case-insensitive — acceptable) |
| Transactions | dataset creation runs in one transaction |
| Rollback | `migrate:rollback` verified on MySQL |
| Charset/collation | utf8mb4 |
| Max connections | pool `min 2 / max 10`; keep within the plan’s connection limit |

## After connecting

Run migrations with the **controlled** procedure
(`HOSTINGER_MIGRATION_AND_SEED.md`) — the app never migrates on startup.
Confirm the actual server version and note it in the readiness table.

> MariaDB fallback: if the plan provides MariaDB instead of MySQL, the same
> `mysql2` driver connects. Re-verify unsigned FKs, utf8mb4 collation, and the
> full migration on the actual version before accepting production.
