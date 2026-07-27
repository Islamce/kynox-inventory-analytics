# Staging Monitoring — staging-analytics.kynox.io

Lightweight, Hostinger-compatible monitoring: a cron-driven check script plus
the platform's own endpoints and logs. No external agent required; an external
uptime service (e.g. UptimeRobot free tier) is recommended in addition, since
in-host cron cannot see a dead host.

## Checks and thresholds

| Check | How | Alert threshold |
|---|---|---|
| Uptime / HTTP | External uptime monitor + cron `curl -f https://staging-analytics.kynox.io/api/health` every 5 min | 2 consecutive failures |
| Readiness (DB connectivity) | cron `curl -f .../api/readiness` every 5 min | any 503 → alert (DB outage) |
| Response time | `curl -w '%{time_total}'` on `/api/health` | > 2 s sustained over 3 samples |
| Disk space | `df -P $DEPLOY_ROOT` in the cron script | < 2 GB free = warning; < 500 MB = critical |
| Error rate | `grep -c '"level":50' shared/logs/app.out.log` delta per hour | > 20 errors/hour |
| Upload failures | audit log: `login_failed`-style query on 4xx/5xx of `/api/uploads` in app logs | > 10/hour |
| AI provider failures | app logs: `AI provider` / `Anthropic API error` / `OpenAI API error` lines | > 5/hour, or any sustained timeout burst |
| Backup success | `backup-db.sh` cron exit code + newest file age in `shared/backups` | newest backup older than 26 h |
| Process restarts | `pm2 jlist` restart counter | > 3 restarts/hour (crash loop) |
| Certificate | `openssl s_client` expiry check weekly | < 14 days to expiry |

## Suggested cron entries (staging host)

```cron
*/5 * * * *  DEPLOY_ROOT=$HOME/domains/staging-analytics.kynox.io $HOME/domains/staging-analytics.kynox.io/current/scripts/deployment/smoke-test.sh >> $HOME/domains/staging-analytics.kynox.io/shared/logs/monitor.log 2>&1 || echo "SMOKE FAIL $(date -u)" >> $HOME/domains/staging-analytics.kynox.io/shared/logs/alerts.log
15 2 * * *   DEPLOY_ROOT=$HOME/domains/staging-analytics.kynox.io $HOME/domains/staging-analytics.kynox.io/current/scripts/deployment/backup-db.sh >> $HOME/domains/staging-analytics.kynox.io/shared/logs/backup.log 2>&1 || echo "BACKUP FAIL $(date -u)" >> $HOME/domains/staging-analytics.kynox.io/shared/logs/alerts.log
```

`alerts.log` is the single place the staging owner watches (or tails into a
notification channel). Log rotation: pm2's `time: true` files plus
`logrotate` weekly (or pm2-logrotate module) keeping 4 compressed weeks.

## In-app signals

- Every request logs `correlationId, method, path, status, durationMs, userId` (JSON, pino).
- `ai_logs` records provider/model/tokens per AI call — sum daily for cost tracking; limits enforce budget server-side.
- The audit log is the business-level trail (uploads, datasets, config, exports, AI queries).
