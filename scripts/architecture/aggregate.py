#!/usr/bin/env python3
"""KAAF enterprise catalogue — aggregate and query indexes across repositories.

Takes the indexes published by any number of KAAF repositories and answers
questions that no single repository can: who owns this, who calls that API,
which systems use this permission, what has gone quiet.

The point is that these questions are answerable **without cloning anything**.
Each repository publishes `.ai/index/repository.json`; the aggregator reads a
directory of them.

Usage:
    aggregate.py --input DIR [--output catalogue.json]
    aggregate.py --input DIR --query <query>
    aggregate.py --input DIR --metadata publications.json   # for staleness

Queries:
    modules                       every module, with its owner and confidence
    module:<id>                   one module, wherever it lives
    owner:<name>                  everything owned by someone
    api:<id>                      an API and the repositories exposing it
    permission:<key>              which systems use a permission
    integration:<name>            which systems depend on an external system
    depends-on:<qualified-id>     what depends on a module
    consumers:<qualified-id>      who consumes a module's contracts, cross-repository
    impact:<qualified-id>         what breaks if this module changes
    context:<owner/repo>          another repository's published context, unfetched
    vocabulary                    permission keys across the estate, and collisions
    health                        ownership, confidence and drift across the estate
    stale                         repositories that have gone quiet (needs --metadata)

Exit codes: 0 success, 1 invalid input or an index that cannot be read.
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from utils.index_schema import INDEX_SCHEMA_VERSION, validate  # noqa: E402
from utils.jsonio import canonical_dumps  # noqa: E402


def looks_like_index(document) -> bool:
    """Is this file trying to be a KAAF index at all?

    A directory of indexes will accumulate other JSON — a catalogue written back
    into it, notes, publication metadata. Those are skipped. Anything that
    *claims* to be an index and is malformed still fails, because silently
    dropping a broken index would quietly shrink the estate.
    """
    if not isinstance(document, dict):
        return False
    if "catalogueSchemaVersion" in document:
        return False  # a catalogue, not an index
    return "indexSchemaVersion" in document or (
        "repository" in document and "modules" in document
    )


def load_indexes(directory: Path) -> tuple[list[dict], list[str], list[str]]:
    """Read and validate every index under `directory`.

    Returns (indexes, errors, skipped).
    """
    indexes: list[dict] = []
    errors: list[str] = []
    skipped: list[str] = []

    for path in sorted(directory.rglob("*.json")):
        try:
            document = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as error:
            errors.append(f"{path}: not valid JSON: {error.msg}")
            continue

        if not looks_like_index(document):
            skipped.append(str(path))
            continue

        problems = validate(document, source=path.name)
        if problems:
            errors.extend(f"{path}: {problem}" for problem in problems)
            continue
        indexes.append(document)

    seen: dict[str, str] = {}
    for document in indexes:
        repository = document["repository"]["repository"]
        if repository in seen:
            errors.append(f"{repository}: appears in more than one index")
        seen[repository] = repository

    return (
        sorted(indexes, key=lambda d: d["repository"]["repository"]),
        errors,
        sorted(skipped),
    )


def build_catalogue(indexes: list[dict], metadata: dict | None = None) -> dict:
    """Merge indexes into one catalogue, namespaced by repository."""
    metadata = metadata or {}

    repositories = []
    modules = []
    apis = []
    permissions = []
    integrations = []

    for index in indexes:
        repository = index["repository"]["repository"]
        repositories.append(
            {
                "indexSchemaVersion": index["indexSchemaVersion"],
                "kaafGeneratorVersion": index.get("kaafGeneratorVersion", "unknown"),
                "kaafPhase": index["repository"].get("kaafPhase"),
                "moduleCount": index["health"].get("moduleCount", 0),
                "name": index["repository"].get("name"),
                "ownershipCoverage": index["health"].get("ownershipCoverage"),
                "publication": metadata.get(repository, {}),
                "repository": repository,
            }
        )
        for module in index["modules"]:
            modules.append({**module, "repository": repository})
        for api in index.get("apis", []):
            apis.append({**api, "repository": repository})
        for permission in index.get("permissions", []):
            permissions.append({**permission, "repository": repository})
        for integration in index.get("externalIntegrations", []):
            integrations.append({**integration, "repository": repository})

    confidence: dict[str, int] = {}
    for module in modules:
        confidence[module["confidence"]] = confidence.get(module["confidence"], 0) + 1

    unowned = sorted(
        module["qualifiedId"] for module in modules if module.get("owner") in ("", "unknown")
    )

    return {
        "apis": sorted(apis, key=lambda entry: (entry["repository"], entry["module"], entry["id"])),
        "catalogueSchemaVersion": INDEX_SCHEMA_VERSION,
        "externalIntegrations": sorted(
            integrations, key=lambda entry: (entry["name"], entry["repository"])
        ),
        "health": {
            "confidenceByLevel": dict(sorted(confidence.items())),
            "moduleCount": len(modules),
            "modulesWithoutOwner": unowned,
            "ownershipCoverage": (
                round((len(modules) - len(unowned)) / len(modules), 4) if modules else 0.0
            ),
            "repositoriesWithDriftErrors": sorted(
                index["repository"]["repository"]
                for index in indexes
                if index["health"].get("hasDriftErrors")
            ),
            "repositoryCount": len(repositories),
        },
        "modules": sorted(modules, key=lambda entry: entry["qualifiedId"]),
        "permissions": sorted(
            permissions, key=lambda entry: (entry["key"], entry["repository"])
        ),
        "repositories": sorted(repositories, key=lambda entry: entry["repository"]),
    }


def _matching(entries: list[dict], field: str, value: str) -> list[dict]:
    return [entry for entry in entries if str(entry.get(field, "")) == value]


def query(catalogue: dict, expression: str) -> dict:
    """Answer a cross-estate question. Returns {'query', 'results', 'summary'}."""
    kind, _, value = expression.partition(":")
    kind = kind.strip()
    value = value.strip()

    if kind == "modules":
        results = [
            {
                "confidence": module["confidence"],
                "owner": module["owner"],
                "qualifiedId": module["qualifiedId"],
                "repository": module["repository"],
            }
            for module in catalogue["modules"]
        ]
        summary = f"{len(results)} module(s) across {catalogue['health']['repositoryCount']} repositories"

    elif kind == "module":
        results = _matching(catalogue["modules"], "id", value)
        summary = f"'{value}' found in {len(results)} repositor(y/ies)"

    elif kind == "owner":
        results = _matching(catalogue["modules"], "owner", value)
        summary = f"{len(results)} module(s) owned by '{value}'"

    elif kind == "api":
        results = _matching(catalogue["apis"], "id", value)
        summary = f"API '{value}' exposed by {len(results)} module(s)"

    elif kind == "permission":
        results = _matching(catalogue["permissions"], "key", value)
        summary = f"permission '{value}' used by {len(results)} module(s)"

    elif kind == "integration":
        results = _matching(catalogue["externalIntegrations"], "name", value)
        summary = f"'{value}' used by {len(results)} module(s)"

    elif kind == "depends-on":
        results = [
            {
                "qualifiedId": module["qualifiedId"],
                "repository": module["repository"],
            }
            for module in catalogue["modules"]
            if value in module.get("dependsOn", [])
            or value.split("#")[-1] in module.get("dependsOn", [])
        ]
        summary = f"{len(results)} module(s) depend on '{value}'"

    elif kind == "consumers":
        producer_repository, _, producer_module = value.partition("#")
        results = [
            {
                "consumer": module["qualifiedId"],
                "contract": consumed.get("contract"),
                "kind": consumed.get("kind", "api"),
                "repository": module["repository"],
                "version": consumed.get("version", ""),
            }
            for module in catalogue["modules"]
            for consumed in module.get("consumes", []) or []
            if consumed.get("repository") == producer_repository
            and consumed.get("module") == producer_module
        ]
        summary = f"{len(results)} cross-repository consumer(s) of '{value}'"

    elif kind == "impact":
        producer_repository, _, producer_module = value.partition("#")

        # Two ways a change here reaches somebody else: a module in the same
        # repository that declares a dependency, or a module anywhere that
        # declares it consumes one of this module's contracts.
        internal = [
            {
                "path": "declared dependency",
                "qualifiedId": module["qualifiedId"],
                "repository": module["repository"],
            }
            for module in catalogue["modules"]
            if module["repository"] == producer_repository
            and producer_module in module.get("dependsOn", [])
        ]
        external = [
            {
                "contract": consumed.get("contract"),
                "path": "cross-repository consumption",
                "qualifiedId": module["qualifiedId"],
                "repository": module["repository"],
            }
            for module in catalogue["modules"]
            for consumed in module.get("consumes", []) or []
            if consumed.get("repository") == producer_repository
            and consumed.get("module") == producer_module
        ]
        results = sorted(
            internal + external, key=lambda entry: (entry["repository"], entry["qualifiedId"])
        )
        summary = (
            f"{len(results)} module(s) would be affected by a change to '{value}' "
            f"({len(internal)} in-repository, {len(external)} cross-repository). "
            "Only declared relationships are visible: an undeclared consumer is invisible here."
        )

    elif kind == "context":
        # Federated read: an agent working in one repository sees another's
        # published context without cloning it.
        results = [
            {
                "apis": [api for api in catalogue["apis"] if api["repository"] == value],
                "modules": [
                    module for module in catalogue["modules"] if module["repository"] == value
                ],
                "permissions": [
                    permission
                    for permission in catalogue["permissions"]
                    if permission["repository"] == value
                ],
                "repository": entry,
            }
            for entry in catalogue["repositories"]
            if entry["repository"] == value
        ]
        summary = (
            f"published context for '{value}'"
            if results
            else f"'{value}' publishes no index in this estate"
        )

    elif kind == "vocabulary":
        by_key: dict[str, list[dict]] = {}
        for permission in catalogue["permissions"]:
            by_key.setdefault(permission["key"], []).append(permission)

        results = []
        for key in sorted(by_key):
            entries = by_key[key]
            parts = key.split(".")
            roles = {tuple(sorted(entry.get("roles", []) or [])) for entry in entries}
            results.append(
                {
                    "conformsToConvention": len(parts) == 3 and all(parts),
                    "definedIn": sorted({entry["repository"] for entry in entries}),
                    "key": key,
                    # The same key meaning different things in different systems
                    # is the failure this query exists to surface.
                    "roleDivergence": len(roles) > 1,
                }
            )
        nonconforming = sum(1 for entry in results if not entry["conformsToConvention"])
        divergent = sum(1 for entry in results if entry["roleDivergence"])
        summary = (
            f"{len(results)} permission key(s); {nonconforming} not of the form "
            f"<domain>.<resource>.<action>; {divergent} with divergent roles across repositories"
        )

    elif kind == "health":
        results = [catalogue["health"]]
        summary = (
            f"{catalogue['health']['repositoryCount']} repositories, "
            f"{catalogue['health']['moduleCount']} modules, "
            f"ownership coverage {catalogue['health']['ownershipCoverage']}"
        )

    elif kind == "stale":
        results = [
            {
                "publication": entry.get("publication", {}),
                "repository": entry["repository"],
            }
            for entry in catalogue["repositories"]
            if not entry.get("publication")
        ]
        summary = (
            f"{len(results)} repositor(y/ies) with no publication metadata — supply "
            "--metadata to compute time-based staleness"
        )

    else:
        raise ValueError(
            f"unknown query '{expression}'. Try: modules, module:<id>, owner:<name>, "
            "api:<id>, permission:<key>, integration:<name>, depends-on:<id>, "
            "consumers:<id>, impact:<id>, context:<owner/repo>, vocabulary, health, stale"
        )

    return {"query": expression, "results": results, "summary": summary}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Aggregate and query KAAF indexes.")
    parser.add_argument("--input", required=True, help="directory containing index JSON files")
    parser.add_argument("--output", default=None, help="write the merged catalogue here")
    parser.add_argument("--query", default=None, help="answer a cross-estate question")
    parser.add_argument(
        "--metadata",
        default=None,
        help="JSON mapping repository -> {commit, publishedAt} for staleness reporting",
    )
    args = parser.parse_args(argv)

    directory = Path(args.input)
    if not directory.is_dir():
        print(f"error: --input is not a directory: {directory}", file=sys.stderr)
        return 1

    indexes, errors, skipped = load_indexes(directory)
    if errors:
        print("error: one or more indexes could not be read", file=sys.stderr)
        for problem in errors:
            print(f"  - {problem}", file=sys.stderr)
        return 1
    if not indexes:
        print(f"error: no index files found under {directory}", file=sys.stderr)
        if skipped:
            print(f"  ({len(skipped)} non-index JSON file(s) skipped)", file=sys.stderr)
        return 1
    for path in skipped:
        print(f"note: skipped non-index file {path}", file=sys.stderr)

    metadata = {}
    if args.metadata:
        metadata = json.loads(Path(args.metadata).read_text(encoding="utf-8"))

    catalogue = build_catalogue(indexes, metadata)

    if args.query:
        try:
            answer = query(catalogue, args.query)
        except ValueError as error:
            print(f"error: {error}", file=sys.stderr)
            return 1
        print(canonical_dumps(answer), end="")
        return 0

    if args.output:
        Path(args.output).write_text(canonical_dumps(catalogue), encoding="utf-8")
        print(
            f"catalogue written to {args.output}: "
            f"{catalogue['health']['repositoryCount']} repositories, "
            f"{catalogue['health']['moduleCount']} modules"
        )
        return 0

    print(canonical_dumps(catalogue), end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
