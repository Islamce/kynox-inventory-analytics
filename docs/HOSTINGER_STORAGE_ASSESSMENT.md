# Storage Persistence Assessment — Managed Hosting

Analytics ingests uploaded SAP/Excel/CSV files and generates export files.
Managed Node.js deployments **may replace or rebuild the application directory
on redeploy**, which can delete local runtime files.

**Until persistence is verified on the actual plan, do NOT claim durable local
file storage.**

## The risk
- `UPLOAD_DIR=./uploads` and `EXPORT_DIR=./exports` are inside (or beside) the
  app directory.
- If a redeploy replaces that directory, previously uploaded source files and
  generated exports can be lost.
- The platform treats **original uploaded files as the traceability record**
  (source-file immutability). Losing them breaks auditability of past datasets.

## What is safe regardless of file persistence
- **All analysis results, dataset rows, mappings, cleansing logs, quality
  scores, audit trail, and configuration live in MySQL** — durable via the DB,
  independent of the app directory.
- **Exports are regenerable on demand** from the dataset, so losing `exports/`
  is low-impact.
- Temporary parsing files are transient by design.

So the material risk is limited to **original uploaded source files** in
`uploads/`.

## Required verification (owner, on the temporary domain)
1. Upload a file; note the dataset id.
2. Trigger a **Redeploy** in hPanel.
3. Check whether the uploaded file still exists (re-export the dataset / re-open
   the upload). Record the result in the readiness table.

## Decision matrix

| If uploads persist across redeploy | If they do NOT persist |
|---|---|
| Local `uploads/` is acceptable for v1; still schedule DB backups. | Do **not** approve production retention of source files on local disk. Use one of the options below. |

### Options when local storage is not durable
1. **Hostinger persistent/writable storage** — if the plan documents a
   redeploy-persistent directory, point `UPLOAD_DIR` there.
2. **S3-compatible object storage (Backblaze B2)** — already proven elsewhere in
   Kynox. Store original uploads in B2; keep only metadata + results in MySQL.
   **Create separate, scoped B2 credentials for Analytics — do not reuse WMS
   credentials.** (Adapter is a follow-up code change; the data model already
   stores upload metadata separately from bytes.)
3. **Interim policy** — restrict production uploads to controlled UAT, warn
   users that redeploy may remove local files, and back up `uploads/` on a
   schedule until (1) or (2) is in place.

## Current status
- Code uses **relative, configurable** upload/export paths (no absolute
  Hostinger path assumed) and enforces `MAX_UPLOAD_MB`.
- Persistence across redeploys is **UNVERIFIED** on the real plan → treat local
  upload storage as **non-durable** until Step-3 verification passes.
