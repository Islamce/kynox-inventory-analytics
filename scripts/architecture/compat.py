#!/usr/bin/env python3
"""Contract compatibility — what breaks, and for whom.

Compares a baseline index against the current one and classifies every change to
the published contract surface. A breaking change is then resolved against the
estate catalogue to name the consumers it affects, **before** the change merges.

    compat.py --baseline old.json --current .ai/index/repository.json
    compat.py --baseline old.json --current new.json --estate estate/ --fail-on-breaking

Breaking (a consumer written against the baseline stops working):
    api-removed, api-version-changed, api-stability-downgraded,
    permission-removed, module-removed

Non-breaking (additive; old consumers are unaffected):
    api-added, permission-added, module-added

Exit codes: 0 no breaking change (or reporting only), 1 breaking change with
--fail-on-breaking, or invalid input.
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from aggregate import build_catalogue, load_indexes  # noqa: E402
from utils.index_schema import validate  # noqa: E402
from utils.jsonio import canonical_dumps  # noqa: E402

BREAKING = (
    "api-removed",
    "api-version-changed",
    "api-stability-downgraded",
    "permission-removed",
    "module-removed",
)

# Lower is less stable. A move down this scale narrows what a consumer may rely
# on, which breaks them just as surely as removing the contract.
STABILITY_RANK = {"experimental": 0, "beta": 1, "stable": 2, "unknown": 0}


def _by_key(entries: list[dict], key: str) -> dict[str, dict]:
    return {f"{entry.get('module', '')}/{entry.get(key, '')}": entry for entry in entries}


def compare(baseline: dict, current: dict) -> list[dict]:
    """Classify every change to the published contract surface."""
    changes: list[dict] = []

    old_modules = {module["id"]: module for module in baseline.get("modules", [])}
    new_modules = {module["id"]: module for module in current.get("modules", [])}

    for module_id in sorted(set(old_modules) - set(new_modules)):
        changes.append(
            {
                "contract": module_id,
                "detail": f"module '{module_id}' is no longer published",
                "kind": "module-removed",
                "module": module_id,
            }
        )
    for module_id in sorted(set(new_modules) - set(old_modules)):
        changes.append(
            {
                "contract": module_id,
                "detail": f"module '{module_id}' is newly published",
                "kind": "module-added",
                "module": module_id,
            }
        )

    old_apis = _by_key(baseline.get("apis", []), "id")
    new_apis = _by_key(current.get("apis", []), "id")

    for key in sorted(set(old_apis) - set(new_apis)):
        entry = old_apis[key]
        changes.append(
            {
                "contract": entry.get("id", ""),
                "detail": f"API '{entry.get('id')}' is no longer published",
                "kind": "api-removed",
                "module": entry.get("module", ""),
            }
        )
    for key in sorted(set(new_apis) - set(old_apis)):
        entry = new_apis[key]
        changes.append(
            {
                "contract": entry.get("id", ""),
                "detail": f"API '{entry.get('id')}' is newly published",
                "kind": "api-added",
                "module": entry.get("module", ""),
            }
        )

    for key in sorted(set(old_apis) & set(new_apis)):
        old, new = old_apis[key], new_apis[key]

        if str(old.get("version", "")) != str(new.get("version", "")):
            changes.append(
                {
                    "contract": new.get("id", ""),
                    "detail": (
                        f"version {old.get('version')!r} -> {new.get('version')!r}; a "
                        "consumer pinned to the old version no longer resolves"
                    ),
                    "kind": "api-version-changed",
                    "module": new.get("module", ""),
                }
            )

        old_rank = STABILITY_RANK.get(str(old.get("stability", "unknown")), 0)
        new_rank = STABILITY_RANK.get(str(new.get("stability", "unknown")), 0)
        if new_rank < old_rank:
            changes.append(
                {
                    "contract": new.get("id", ""),
                    "detail": (
                        f"stability {old.get('stability')} -> {new.get('stability')}; "
                        "consumers may rely on less than before"
                    ),
                    "kind": "api-stability-downgraded",
                    "module": new.get("module", ""),
                }
            )

    old_permissions = _by_key(baseline.get("permissions", []), "key")
    new_permissions = _by_key(current.get("permissions", []), "key")

    for key in sorted(set(old_permissions) - set(new_permissions)):
        entry = old_permissions[key]
        changes.append(
            {
                "contract": entry.get("key", ""),
                "detail": f"permission '{entry.get('key')}' is no longer published",
                "kind": "permission-removed",
                "module": entry.get("module", ""),
            }
        )
    for key in sorted(set(new_permissions) - set(old_permissions)):
        entry = new_permissions[key]
        changes.append(
            {
                "contract": entry.get("key", ""),
                "detail": f"permission '{entry.get('key')}' is newly published",
                "kind": "permission-added",
                "module": entry.get("module", ""),
            }
        )

    for change in changes:
        change["breaking"] = change["kind"] in BREAKING

    return sorted(changes, key=lambda c: (not c["breaking"], c["kind"], c["module"], c["contract"]))


def affected_consumers(
    repository: str, changes: list[dict], catalogue: dict | None
) -> list[dict]:
    """Who in the estate consumes a contract this change breaks?"""
    if not catalogue:
        return []

    affected: list[dict] = []
    breaking = [change for change in changes if change["breaking"]]

    for module in catalogue.get("modules", []):
        for consumed in module.get("consumes", []) or []:
            if consumed.get("repository") != repository:
                continue
            for change in breaking:
                if (
                    consumed.get("module") == change["module"]
                    and consumed.get("contract") == change["contract"]
                ):
                    affected.append(
                        {
                            "change": change["kind"],
                            "consumer": module.get("qualifiedId", module.get("id", "")),
                            "consumerRepository": module.get("repository", ""),
                            "contract": change["contract"],
                            "detail": change["detail"],
                            "producerModule": change["module"],
                        }
                    )

    return sorted(
        affected, key=lambda entry: (entry["consumerRepository"], entry["consumer"], entry["contract"])
    )


def _load(path: Path, label: str) -> dict:
    document = json.loads(path.read_text(encoding="utf-8"))
    problems = validate(document, source=label)
    if problems:
        raise ValueError(f"{label} is not a valid index:\n  - " + "\n  - ".join(problems))
    return document


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Check contract compatibility between indexes.")
    parser.add_argument("--baseline", required=True, help="the previously published index")
    parser.add_argument("--current", required=True, help="the index proposed by this change")
    parser.add_argument("--estate", default=None, help="directory of indexes, to name consumers")
    parser.add_argument(
        "--fail-on-breaking",
        action="store_true",
        help="exit non-zero when a breaking change is found",
    )
    parser.add_argument("--json", action="store_true", help="emit the report as JSON")
    args = parser.parse_args(argv)

    try:
        baseline = _load(Path(args.baseline), "baseline")
        current = _load(Path(args.current), "current")
    except (OSError, json.JSONDecodeError, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1

    catalogue = None
    if args.estate:
        indexes, errors, _ = load_indexes(Path(args.estate))
        if errors:
            print("error: estate could not be read", file=sys.stderr)
            for problem in errors:
                print(f"  - {problem}", file=sys.stderr)
            return 1
        catalogue = build_catalogue(indexes)

    repository = current["repository"]["repository"]
    changes = compare(baseline, current)
    breaking = [change for change in changes if change["breaking"]]
    consumers = affected_consumers(repository, changes, catalogue)

    report = {
        "affectedConsumers": consumers,
        "breakingCount": len(breaking),
        "changes": changes,
        "estateChecked": catalogue is not None,
        "repository": repository,
        "totalChanges": len(changes),
    }

    if args.json:
        print(canonical_dumps(report), end="")
    else:
        print(f"contract compatibility — {repository}")
        print(f"  changes:  {len(changes)}")
        print(f"  breaking: {len(breaking)}")
        print()
        for change in changes:
            marker = "BREAKING" if change["breaking"] else "ok      "
            print(f"  {marker} [{change['kind']}] {change['module']}/{change['contract']}")
            print(f"           {change['detail']}")
        if not changes:
            print("  no change to the published contract surface")
        print()
        if catalogue is None:
            print(
                "  No estate supplied, so affected consumers were NOT checked.\n"
                "  This is 'not checked', not 'nothing affected'."
            )
        elif consumers:
            print(f"  {len(consumers)} affected consumer(s):")
            for entry in consumers:
                print(f"    - {entry['consumer']} uses {entry['producerModule']}/{entry['contract']}")
        else:
            print("  No consumer in the estate declares any contract this change breaks.")

    if breaking and args.fail_on_breaking:
        print(
            f"\nerror: {len(breaking)} breaking change(s) to the published contract surface.",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
