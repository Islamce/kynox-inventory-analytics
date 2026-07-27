# Hostinger UAT Checklist (temporary domain, then custom domain)

Run on the Hostinger **temporary domain** first, then repeat the platform
checks on `https://analytics.kynox.io` after cutover. Record Actual/Status/
Evidence/Tester/Date per row when executing (left blank here — do not pre-fill).
Full analytics scenarios + expected values: `docs/UAT_DATA_PACKAGE.md` and
`docs/STAGING_UAT_PLAN.md`. UAT data: `uat-data/`.

## Platform
| Check | Expected |
|---|---|
| Node.js Web App created | app online in hPanel |
| Build log | install + build succeed |
| Runtime log | server started, MySQL connected, no secrets printed |
| Temporary domain reachable | HTTPS loads the SPA |
| Env vars loaded | `/api/version` shows environment + release SHA |
| Redeploy works | change an env var → redeploy → effect visible |

## Application
| Check | Expected |
|---|---|
| SPA root | app loads |
| SPA deep route (e.g. `/inventory`) | loads (no 404 from proxy) |
| `/api/health` | 200 `{"status":"ok"}` |
| `/api/readiness` | 200 `{"status":"ready"}` |
| `/api/version` | correct version + release SHA + environment |
| Login | works; audit `login` recorded |
| Failed login / lockout | 401; lock after 5 fails |
| RBAC | read-only user denied upload/admin (403) |
| Upload IDOR | user B cannot open user A’s upload (403) |
| File upload | accepted; original stored |
| SAP detection | MB52/MB51/master/PI detected with confidence |
| Smart mapping | Arabic + SAP technical headers mapped |
| Cleansing approval | proposals applied only when approved; source file unchanged (SHA-256) |
| Dataset creation + versioning | dataset saved; re-import → v2 |
| Analytics reconcile | position value, shortage, excess, categories match hand calc |
| Exports | XLSX/CSV/PDF download; formula-injection neutralised |
| Audit log | upload/dataset/export/config entries present |
| AI disabled | `/api/ai/status` configured=false; `/api/ai/chat` → 503, no fake output |

## Database
| Check | Expected |
|---|---|
| MySQL connection | readiness 200 |
| Migrations | applied via controlled command |
| Seed | admin created once; temp password changed after login |
| Decimals/dates | values correct in exports |
| Foreign keys | dataset delete cascades |
| Backup created | SQL dump exists, gzip valid |
| Restore tested | restored into a separate validation DB; rows readable; temp DB dropped |

## Storage
| Check | Expected |
|---|---|
| Upload path writable | upload succeeds |
| Export path writable | export succeeds |
| Size limit | oversize upload → 413 |
| **Redeploy persistence** | verify whether `uploads/` survives a redeploy (record result) |
| Retention | cleanup removes only unreferenced/old files |
| Source-file immutability | original never overwritten |

## Security
| Check | Expected |
|---|---|
| No secrets in repo/logs | confirmed |
| CORS restricted | only the intended origin(s); never `*` |
| Rate limiting | login + API limits active |
| Sanitised errors | no stack traces / internal paths to clients |
| Production config validation | app refuses to start on unsafe config |
| Temp admin password | changed after first login |

Exit: all applicable rows PASS with evidence, and no Critical/High defect open.
