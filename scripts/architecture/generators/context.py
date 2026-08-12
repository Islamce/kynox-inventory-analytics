"""Generate `.ai/ai-context.json` — the agent entry point.

Deliberately small: identity, the module index, conventions and pointers.
Detail lives in `architecture.json` and `modules/<id>.json` so an agent loads
only what the task needs (docs/kaaf/STANDARDS.md §8).
"""

from scanners.facts import RepositoryFacts
from utils.provenance import meta


def _module_entry(facts: RepositoryFacts, module) -> dict:
    found = facts.discovery_for(module.id)
    return {
        "confidence": facts.confidence_for(module.id),
        "declared": True,
        "declaredConfidence": module.confidence,
        "dependsOn": module.depends_on,
        "detail": f"modules/{module.id}.json",
        "hasDiscoveredCode": bool(found and found.has_code),
        "id": module.id,
        "owner": module.owner,
        "path": module.path,
        "publicEntryPoints": module.public_entry_points,
        "purpose": module.purpose,
    }


def _undeclared_entry(facts: RepositoryFacts, found) -> dict:
    """A module discovered from code alone, with no manifest behind it."""
    return {
        "confidence": facts.confidence_for(found.id),
        "declared": False,
        "dependsOn": [],
        "detail": f"modules/{found.id}.json",
        "hasDiscoveredCode": found.has_code,
        "id": found.id,
        "owner": "unknown",
        "path": found.path,
        "publicEntryPoints": list(found.entry_points),
        "purpose": "Not declared — discovered from source. Add a kaaf.module.json to describe it.",
    }


def build(facts: RepositoryFacts) -> dict:
    repository = facts.repository
    declared_ids = {module.id for module in facts.modules}

    modules = [_module_entry(facts, module) for module in facts.modules]
    modules += [
        _undeclared_entry(facts, found)
        for found in facts.discovery.modules
        if found.id not in declared_ids
    ]
    modules.sort(key=lambda entry: entry["id"])

    return {
        "_meta": meta(facts.input_digest, "ai-context.json", confidence="verified"),
        "conventions": repository.get("conventions", {}),
        "counts": {
            "apis": sum(len(m.apis) for m in facts.modules),
            "externalIntegrations": sum(len(m.external_integrations) for m in facts.modules),
            "modules": len(modules),
            "modulesDeclared": len(facts.modules),
            "modulesUndeclared": len(modules) - len(facts.modules),
            "permissions": sum(len(m.permissions) for m in facts.modules),
        },
        "drift": {
            "counts": facts.drift["counts"],
            "detail": ".ai/drift.json",
            "hasErrors": facts.drift["hasErrors"],
        },
        "kaafPhase": repository.get("kaafPhase"),
        "modules": modules,
        "pointers": {
            "architecture": ".ai/architecture.json",
            "drift": ".ai/drift.json",
            "governance": "docs/kaaf/GOVERNANCE.md",
            "moduleDetail": ".ai/modules/<id>.json",
            "prompts": "docs/ai/prompts/",
            "roadmap": "docs/kaaf/ROADMAP.md",
            "standards": "docs/kaaf/STANDARDS.md",
            "summary": ".ai/summary.md",
        },
        "readOrder": [
            ".ai/ai-context.json",
            ".ai/summary.md",
            ".ai/modules/<id>.json for the module the task touches",
            "only the source files those steps referenced",
        ],
        "repository": {
            "defaultBranch": repository.get("defaultBranch"),
            "description": repository.get("description"),
            "name": repository.get("name"),
            "repository": repository.get("repository"),
        },
        "rules": [
            "Never hand-edit anything under .ai/ except README.md and .gitkeep.",
            "If a component is not described here and not in the source, it does not exist — say 'not found'.",
            "Regenerate .ai/ in the same pull request as any structural change.",
            "Tag every architectural claim with a confidence level.",
            "Confidence here is computed from evidence, not copied from a manifest: "
            "'verified' means declared and corroborated by discovered code, 'documented' "
            "means declared with no code to check it against, 'derived' means discovered "
            "with no declaration.",
            "Check drift before trusting this: findings in .ai/drift.json mean the "
            "manifests have fallen behind the code.",
        ],
    }
