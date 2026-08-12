"""Generate `.ai/architecture.json` — the full architecture graph.

Modules, APIs, permissions, dependency edges, external integrations and
deployment, in one document. Everything here traces to a declared manifest;
`sourceManifest` on each entry is that trace.
"""

from scanners.facts import RepositoryFacts
from utils.provenance import meta


def _discovery_block(facts: RepositoryFacts, module_id: str) -> dict:
    found = facts.discovery_for(module_id)
    if found is None:
        return {"discovered": False}
    return {
        "codeFileCount": len(found.code_files),
        "discovered": True,
        "entryPoints": list(found.entry_points),
        "languages": list(found.languages),
        "parseErrors": list(found.parse_errors),
        "publicSymbols": list(found.public_symbols),
        "sourceFileCount": len(found.source_files),
    }


def build(facts: RepositoryFacts) -> dict:
    modules = []
    apis = []
    permissions = []
    integrations = []
    edges = []

    for module in facts.modules:
        modules.append(
            {
                "confidence": facts.confidence_for(module.id),
                "confidenceReason": facts.confidence.get(module.id, {}).get("reason", ""),
                "declared": True,
                "declaredConfidence": module.confidence,
                "dependedOnBy": facts.depended_on_by.get(module.id, []),
                "dependsOn": module.depends_on,
                "discovery": _discovery_block(facts, module.id),
                "id": module.id,
                "owner": module.owner,
                "ownedEntities": module.owned_entities,
                "path": module.path,
                "publicEntryPoints": module.public_entry_points,
                "purpose": module.purpose,
                "sourceManifest": module.manifest_path,
            }
        )

        for api in module.apis:
            entry = dict(api)
            entry["module"] = module.id
            entry["sourceManifest"] = module.manifest_path
            entry.setdefault("confidence", module.confidence)
            apis.append(entry)

        for permission in module.permissions:
            entry = dict(permission)
            entry["module"] = module.id
            entry["sourceManifest"] = module.manifest_path
            entry.setdefault("confidence", module.confidence)
            permissions.append(entry)

        for integration in module.external_integrations:
            entry = dict(integration)
            entry["module"] = module.id
            entry["sourceManifest"] = module.manifest_path
            entry.setdefault("confidence", module.confidence)
            integrations.append(entry)

        for dep in module.depends_on:
            edges.append({"from": module.id, "to": dep})

    declared_ids = {module.id for module in facts.modules}
    for found in facts.discovery.modules:
        if found.id in declared_ids:
            continue
        modules.append(
            {
                "confidence": facts.confidence_for(found.id),
                "confidenceReason": facts.confidence.get(found.id, {}).get("reason", ""),
                "declared": False,
                "dependedOnBy": [],
                "dependsOn": [],
                "discovery": _discovery_block(facts, found.id),
                "id": found.id,
                "owner": "unknown",
                "ownedEntities": [],
                "path": found.path,
                "publicEntryPoints": list(found.entry_points),
                "purpose": (
                    "Not declared — discovered from source. Add a kaaf.module.json to "
                    "describe it."
                ),
                "sourceManifest": None,
            }
        )
    modules.sort(key=lambda entry: entry["id"])

    declared_edges = {(edge["from"], edge["to"]) for edge in edges}
    discovered_edges = [
        {
            "declared": (source, target) in declared_edges,
            "evidence": list(facts.discovery.edge_evidence.get((source, target), ())),
            "from": source,
            "to": target,
        }
        for source, target in facts.discovery.import_edges
    ]

    return {
        "_meta": meta(facts.input_digest, "architecture.json", confidence="verified"),
        "apis": sorted(apis, key=lambda a: (a["module"], str(a.get("id", "")))),
        "dependencies": {
            "declaredEdges": sorted(edges, key=lambda e: (e["from"], e["to"])),
            "discoveredEdges": discovered_edges,
            "edges": sorted(edges, key=lambda e: (e["from"], e["to"])),
            "hasCycles": False,
            "note": (
                "'edges' and 'declaredEdges' come from the manifests; cycles there are "
                "rejected at scan time (KAAF-E004). 'discoveredEdges' come from real "
                "imports — see drift.json where the two disagree."
            ),
        },
        "drift": {
            "counts": facts.drift["counts"],
            "detail": ".ai/drift.json",
            "hasErrors": facts.drift["hasErrors"],
        },
        "deployment": facts.repository.get("deployment", {}),
        "externalIntegrations": sorted(
            integrations, key=lambda i: (i["module"], str(i.get("name", "")))
        ),
        "modules": modules,
        "permissions": sorted(permissions, key=lambda p: (p["module"], str(p.get("key", "")))),
        "repository": {
            "defaultBranch": facts.repository.get("defaultBranch"),
            "kaafPhase": facts.repository.get("kaafPhase"),
            "name": facts.repository.get("name"),
            "repository": facts.repository.get("repository"),
        },
    }
