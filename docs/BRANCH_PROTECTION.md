# Recommended Branch Protection — `main`

Configure at GitHub → Settings → Branches → Add branch ruleset (or classic
protection rule) for `main`:

| Setting | Value | Rationale |
|---|---|---|
| Require a pull request before merging | **On** | No direct pushes to `main` |
| Required approvals | **≥ 1** independent approval (not the PR author) | Second pair of eyes on every change |
| Dismiss stale approvals on new commits | On | Re-review after force-of-change |
| Require status checks to pass | **On** — required checks: `Build, type-check and test (Node 20)`, `Build, type-check and test (Node 22)`, `API integration tests on PostgreSQL` | CI is the merge gate |
| Require branches to be up to date before merging | **On** | Prevents semantically conflicting merges that each pass CI alone |
| Require conversation resolution before merging | **On** | No unresolved review threads at merge time |
| Block force pushes | **On** | History integrity, audit trail |
| Block deletions | **On** | `main` cannot be deleted |
| Require signed commits | **On if practical** — enable once all committers have GPG/SSH signing configured; do not enable before, or merges will hard-fail | Provenance |
| Restrict who can push | Admins/maintainers only | Least privilege |

Additional repository settings:

- Actions → General → Workflow permissions: **Read repository contents** (the CI workflow needs nothing more).
- Enable **secret scanning** and **push protection** (Settings → Code security).
- Tag releases (`vX.Y.Z`) from `main` only; deployments check out tags (see `DEPLOYMENT_HOSTINGER.md` rollback plan).
