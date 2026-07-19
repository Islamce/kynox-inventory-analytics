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

## Exact GitHub UI steps (not yet applied — the repository owner must do this)

1. GitHub → `Islamce/kynox-inventory-analytics` → **Settings → Branches → Add classic branch protection rule** (or **Rules → Rulesets → New branch ruleset**).
2. Branch name pattern: `main`.
3. Tick **Require a pull request before merging** → Required approvals: **1**; tick **Dismiss stale pull request approvals when new commits are pushed**.
4. Tick **Require status checks to pass before merging** and **Require branches to be up to date before merging**, then add these three checks **by their exact job names** (they appear after the first CI run on `main`):
   - `Build, type-check and test (Node 20)`
   - `Build, type-check and test (Node 22)`
   - `API integration tests on PostgreSQL`
5. Tick **Require conversation resolution before merging**.
6. Leave **Allow force pushes** and **Allow deletions** UNTICKED (blocked).
7. Do **not** tick "Do not require status checks for administrators"-style bypasses; if using rulesets, leave the bypass list empty so administrators are not exempt (recommended where practical).
8. Optional: **Require signed commits** — only after every committer has commit signing configured; enabling it earlier hard-blocks merges.

## Equivalent API call

```bash
gh api -X PUT repos/Islamce/kynox-inventory-analytics/branches/main/protection \
  -f 'required_status_checks[strict]=true' \
  -f 'required_status_checks[contexts][]=Build, type-check and test (Node 20)' \
  -f 'required_status_checks[contexts][]=Build, type-check and test (Node 22)' \
  -f 'required_status_checks[contexts][]=API integration tests on PostgreSQL' \
  -f 'enforce_admins=true' \
  -f 'required_pull_request_reviews[required_approving_review_count]=1' \
  -f 'required_pull_request_reviews[dismiss_stale_reviews]=true' \
  -f 'restrictions=null' \
  -f 'allow_force_pushes=false' \
  -f 'allow_deletions=false' \
  -f 'required_conversation_resolution=true'
```

Additional repository settings:

- Actions → General → Workflow permissions: **Read repository contents** (the CI workflow needs nothing more).
- Enable **secret scanning** and **push protection** (Settings → Code security).
- Tag releases (`vX.Y.Z`) from `main` only; deployments check out tags (see `DEPLOYMENT_HOSTINGER.md` rollback plan).
