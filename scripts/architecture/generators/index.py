"""Generate `.ai/index/repository.json` — the publishable index.

This is what leaves the repository. `architecture.json` is for agents working
inside this repository and may change shape as KAAF evolves; the index is for
consumers outside it — the central catalogue, other repositories' impact
analysis — so it carries its own version and changes under a compatibility rule
(see `utils/index_schema.py`).

Everything here is namespaced by repository, so a catalogue can merge indexes
from many repositories without id collisions: `Islamce/KAAF#kaaf-tooling`.

Deliberately absent: a publication timestamp. It would change on every run and
break byte-identical regeneration (docs/kaaf/GOVERNANCE.md §6). Time-based
staleness is computed at aggregation time from publication metadata the
aggregator is given; what the index carries in-band is *health* — ownership
coverage, confidence distribution and drift — which is deterministic.
"""

from scanners.facts import RepositoryFacts
from utils.index_schema import INDEX_SCHEMA_VERSION
from utils.provenance import GENERATOR_VERSION, meta


def qualified(repository: str, module_id: str) -> str:
    """A globally unique module reference: `owner/repo#module`."""
    return f"{repository}#{module_id}"


def build(facts: RepositoryFacts) -> dict:
    repository_id = str(facts.repository.get("repository", "unknown/unknown"))
    declared_ids = {module.id for module in facts.modules}

    modules = []
    for module in facts.modules:
        modules.append(
            {
                "confidence": facts.confidence_for(module.id),
                "consumes": module.consumes,
                "declared": True,
                "dependsOn": module.depends_on,
                "id": module.id,
                "owner": module.owner,
                "ownedEntities": module.owned_entities,
                "path": module.path,
                "purpose": module.purpose,
                "qualifiedId": qualified(repository_id, module.id),
            }
        )
    for found in facts.discovery.modules:
        if found.id in declared_ids:
            continue
        modules.append(
            {
                "confidence": facts.confidence_for(found.id),
                "consumes": [],
                "declared": False,
                "dependsOn": [],
                "id": found.id,
                "owner": "unknown",
                "ownedEntities": [],
                "path": found.path,
                "purpose": "Not declared — discovered from source.",
                "qualifiedId": qualified(repository_id, found.id),
            }
        )
    modules.sort(key=lambda entry: entry["id"])

    apis = sorted(
        (
            {
                "confidence": facts.confidence_for(module.id),
                "id": str(api.get("id", "")),
                "kind": str(api.get("kind", "unknown")),
                "module": module.id,
                "path": str(api.get("path", api.get("topic", ""))),
                "qualifiedId": f"{repository_id}#{module.id}/{api.get('id', '')}",
                "stability": str(api.get("stability", "unknown")),
                "version": str(api.get("version", "")),
            }
            for module in facts.modules
            for api in module.apis
        ),
        key=lambda entry: (entry["module"], entry["id"]),
    )

    permissions = sorted(
        (
            {
                "confidence": facts.confidence_for(module.id),
                "key": str(permission.get("key", "")),
                "module": module.id,
                "roles": list(permission.get("roles", [])),
            }
            for module in facts.modules
            for permission in module.permissions
        ),
        key=lambda entry: (entry["module"], entry["key"]),
    )

    integrations = sorted(
        (
            {
                "criticality": str(integration.get("criticality", "unknown")),
                "kind": str(integration.get("kind", "unknown")),
                "module": module.id,
                "name": str(integration.get("name", "")),
            }
            for module in facts.modules
            for integration in module.external_integrations
        ),
        key=lambda entry: (entry["module"], entry["name"]),
    )

    confidence_counts: dict[str, int] = {}
    for entry in modules:
        level = entry["confidence"]
        confidence_counts[level] = confidence_counts.get(level, 0) + 1

    unowned = sorted(
        entry["id"] for entry in modules if entry["owner"] in ("", "unknown")
    )

    return {
        "_meta": meta(facts.input_digest, "index/repository.json", confidence="derived"),
        "apis": apis,
        "externalIntegrations": integrations,
        "health": {
            "confidenceByLevel": dict(sorted(confidence_counts.items())),
            "driftCounts": facts.drift["counts"],
            "hasDriftErrors": facts.drift["hasErrors"],
            "moduleCount": len(modules),
            "modulesUndeclared": sum(1 for entry in modules if not entry["declared"]),
            "modulesWithoutOwner": unowned,
            "note": (
                "No publication timestamp is embedded: it would break byte-identical "
                "regeneration. Time-based staleness is computed at aggregation time from "
                "publication metadata supplied to the aggregator."
            ),
            "ownershipCoverage": (
                round((len(modules) - len(unowned)) / len(modules), 4) if modules else 0.0
            ),
        },
        "indexSchemaVersion": INDEX_SCHEMA_VERSION,
        "kaafGeneratorVersion": GENERATOR_VERSION,
        "modules": modules,
        "permissions": permissions,
        "repository": {
            "defaultBranch": str(facts.repository.get("defaultBranch", "")),
            "description": str(facts.repository.get("description", "")),
            "kaafPhase": int(facts.repository.get("kaafPhase", 0)),
            "name": str(facts.repository.get("name", "")),
            "repository": repository_id,
        },
    }
