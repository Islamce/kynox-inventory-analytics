"""Generate `.ai/modules/<id>.json` — per-module detail, loaded on demand.

Splitting detail per module is what keeps `ai-context.json` small enough for an
agent to read in full while still making the whole architecture available.

Both declared and discovered-only modules get a document: an agent looking up a
module by id should never come away empty because nobody wrote a manifest.
"""

from scanners.facts import RepositoryFacts
from utils.provenance import meta


def _discovery_block(facts: RepositoryFacts, module_id: str) -> dict:
    found = facts.discovery_for(module_id)
    if found is None:
        return {"discovered": False}
    return {
        "codeFiles": list(found.code_files),
        "discovered": True,
        "entryPoints": list(found.entry_points),
        "languages": list(found.languages),
        "parseErrors": list(found.parse_errors),
        "publicSymbols": list(found.public_symbols),
        "sourceFiles": list(found.source_files),
    }


def _findings_for(facts: RepositoryFacts, module_id: str) -> list[dict]:
    return [finding for finding in facts.drift["findings"] if finding["module"] == module_id]


def build(facts: RepositoryFacts) -> dict[str, dict]:
    """Return {relative output path: document} for every module."""
    documents: dict[str, dict] = {}

    for module in facts.modules:
        confidence = facts.confidence.get(module.id, {})
        documents[f"modules/{module.id}.json"] = {
            "_meta": meta(
                facts.input_digest,
                f"modules/{module.id}.json",
                confidence=confidence.get("level", "unknown"),
            ),
            "apis": module.apis,
            "confidence": confidence.get("level", "unknown"),
            "confidenceReason": confidence.get("reason", ""),
            "declared": True,
            "declaredConfidence": module.confidence,
            "dependedOnBy": facts.depended_on_by.get(module.id, []),
            "dependsOn": module.depends_on,
            "discovery": _discovery_block(facts, module.id),
            "driftFindings": _findings_for(facts, module.id),
            "externalIntegrations": module.external_integrations,
            "id": module.id,
            "owner": module.owner,
            "ownedEntities": module.owned_entities,
            "path": module.path,
            "permissions": module.permissions,
            "publicEntryPoints": module.public_entry_points,
            "purpose": module.purpose,
            "readNext": sorted(module.public_entry_points),
            "sourceManifest": module.manifest_path,
        }

    declared_ids = {module.id for module in facts.modules}
    for found in facts.discovery.modules:
        if found.id in declared_ids:
            continue
        confidence = facts.confidence.get(found.id, {})
        documents[f"modules/{found.id}.json"] = {
            "_meta": meta(
                facts.input_digest,
                f"modules/{found.id}.json",
                confidence=confidence.get("level", "unknown"),
            ),
            "apis": [],
            "confidence": confidence.get("level", "unknown"),
            "confidenceReason": confidence.get("reason", ""),
            "declared": False,
            "dependedOnBy": [],
            "dependsOn": [],
            "discovery": _discovery_block(facts, found.id),
            "driftFindings": _findings_for(facts, found.id),
            "externalIntegrations": [],
            "id": found.id,
            "owner": "unknown",
            "ownedEntities": [],
            "path": found.path,
            "permissions": [],
            "publicEntryPoints": list(found.entry_points),
            "purpose": (
                "Not declared — discovered from source. Add a kaaf.module.json to describe it."
            ),
            "readNext": list(found.entry_points),
            "sourceManifest": None,
        }

    return documents
