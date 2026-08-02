# AGENTS.md

Operating instructions for every AI agent working in this repository.

This repository follows the **Kynox AI Architecture Framework (KAAF)**. Authoritative rules
live in [`Islamce/KAAF`](https://github.com/Islamce/KAAF) — `docs/kaaf/GOVERNANCE.md` and
`docs/kaaf/STANDARDS.md`. This file states how they apply here.

## Order of operations

1. **Read the AI context** — `.ai/ai-context.json` → `.ai/summary.md` →
   `.ai/modules/<id>.json` → only the source files those referenced.
2. **Verify git state** — correct repository and branch, upstream set, local `HEAD`
   matching remote, clean working tree, open pull requests and active branches reviewed,
   CI status on the base branch known. If any check fails, **stop and report before
   editing.**
3. **Inspect referenced files** — let `.ai/` bound what you read. Broad speculative reading
   is a defect, not thoroughness.
4. **Perform the change.**
5. **Regenerate the architecture context** if the change was structural (see below).
6. **Update documentation.**

## Read the generated context before trusting a declaration

`.ai/` describes what the `kaaf.module.json` manifests **declare**, cross-checked against
the real source tree. Module confidence is computed from that comparison, never copied from
a manifest. Read `.ai/drift.json` before trusting a declaration — findings there mean the
manifests have fallen behind the code.

Discovery is a static read. Dynamic imports and runtime wiring are invisible to it, so the
absence of a drift finding is not proof that none exists. If source and context disagree,
report it rather than silently trusting either.

## Regenerate after structural changes

Required when a change touches module boundaries, public API surface, permissions,
workflows, deployment topology, data ownership, or architecturally significant
integrations. Not required for comments, formatting, docs-only edits, or implementation
changes behind an unchanged boundary.

```bash
# update the affected kaaf.module.json first — it is the generator's input of record
./scripts/architecture/generate.sh
git add .ai && git commit -m "chore(kaaf): regenerate architecture context"
```

Keep generated output in **its own commit** within the same pull request, so reviewers can
separate intent from machine output.

## Never edit generated output by hand

Everything under `.ai/` except `README.md` and `.gitkeep` is generator output. If it is
wrong, **the generator is wrong** — fix it in `Islamce/KAAF`, let its CI verify the fix,
then re-vendor. A hand-edit is destroyed by the next run and makes agents confidently wrong
in the meantime. The same applies to `scripts/architecture/`; see
[`scripts/architecture/VENDORED.md`](scripts/architecture/VENDORED.md).

## Verify before finishing

CI runs the same four gates:

```bash
python3 ./scripts/architecture/generate.py --check
python3 ./scripts/architecture/validators/validate_generated.py
python3 ./scripts/architecture/validators/validate_drift.py
python3 ./scripts/architecture/validators/validate_index.py
```

A local pass means a CI pass. A stale or hand-edited `.ai/` fails the build, as does
error-severity drift or an index that breaks its schema.

## Confidence and evidence

Tag architectural claims `verified` / `derived` / `documented` / `assumed` / `unknown`, and
cite a repository-relative path for anything `verified`. `unknown` is always acceptable; a
confident wrong answer is not.

## This repository handles customer data

- **Generated context must never contain sample rows, customer identifiers, or secrets.**
  It describes datasets; it does not carry them.
- Uploads, exports and `uat-data/` may contain real or realistic operational data. Do not
  copy their contents into documentation, commit messages, issues, or generated context.
- Permissions are defined once, in `packages/shared-types` (`ROLE_PERMISSIONS`), and
  enforced in `apps/api/src/middleware/auth.ts`. Add a permission in both places or not at
  all — a matrix entry with no enforcement point is a security defect, not a placeholder.

## Protected actions — require human approval

Deployment or rollback to any real environment, production database operations, destructive
migrations, credential creation or rotation, DNS and hosting changes, merging to `main`, and
any external or customer-facing commitment. The scripts under `scripts/deployment/` are
capable of all of the above; possessing them is not authorization to run them.

## Scope discipline

Do exactly what was asked. Surface adjacent problems as findings; do not fix them in the
same pull request. KAAF changes never share a commit or pull request with feature work —
use `chore(kaaf): …` subjects for KAAF commits. Audits are read-only: never delete, close,
or merge a branch, pull request, issue, workflow, or artifact.
