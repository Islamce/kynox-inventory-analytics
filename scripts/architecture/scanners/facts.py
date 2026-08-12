"""Composed repository facts — what every generator reads.

Brings the three scanners together: what the manifests *declare*, what the
source tree *shows*, and where the two disagree. Generators consume this and
nothing else.

The input digest covers **all** of it. In Phase 2 it fingerprinted the
manifests alone; now that generated output also reflects the source tree, a
source change must move the digest too, or `validate_generated.py` would call
stale output current.
"""

from dataclasses import dataclass
from pathlib import Path

from scanners import discovery as discovery_scanner
from scanners import drift as drift_analyser
from scanners import manifests as manifest_scanner
from scanners import source as source_scanner
from scanners.discovery import Discovery
from scanners.manifests import Facts, Module
from utils.jsonio import digest


@dataclass(frozen=True)
class RepositoryFacts:
    """Declared manifests, discovered source, and the drift between them."""

    manifests: Facts
    discovery: Discovery
    drift: dict
    confidence: dict[str, dict]
    input_digest: str

    # Declared-side accessors, so generators read naturally.
    @property
    def repository(self) -> dict:
        return self.manifests.repository

    @property
    def modules(self) -> list[Module]:
        return self.manifests.modules

    @property
    def depended_on_by(self) -> dict[str, list[str]]:
        return self.manifests.depended_on_by

    def discovery_for(self, module_id: str):
        return self.discovery.by_id(module_id)

    def confidence_for(self, module_id: str) -> str:
        return self.confidence.get(module_id, {}).get("level", "unknown")


def _source_fingerprint(tree: source_scanner.SourceTree) -> list[dict]:
    """The parts of the source tree that can change generated output."""
    return [
        {
            "entryPoint": source_file.is_entry_point,
            "imports": list(source_file.resolved_imports),
            "language": source_file.language,
            "parseError": source_file.parse_error,
            "path": source_file.path,
            "publicSymbols": list(source_file.public_symbols),
        }
        for source_file in tree.files
    ]


def gather(root: Path) -> RepositoryFacts:
    """Run every scanner over `root` and compose the result."""
    manifests = manifest_scanner.scan(root)
    tree = source_scanner.scan(root)
    discovery = discovery_scanner.discover(manifests.modules, tree)
    drift = drift_analyser.analyse(manifests.modules, discovery)

    declared_ids = {module.id for module in manifests.modules}
    confidence: dict[str, dict] = {}
    for found in discovery.modules:
        level, reason = drift_analyser.confidence_for(
            found.id, discovery, found.id in declared_ids
        )
        confidence[found.id] = {"level": level, "reason": reason}

    input_digest = digest(
        {
            "modules": [
                {
                    "apis": module.apis,
                    "consumes": module.consumes,
                    "declaredConfidence": module.confidence,
                    "dependsOn": module.depends_on,
                    "externalIntegrations": module.external_integrations,
                    "flows": module.flows,
                    "id": module.id,
                    "owner": module.owner,
                    "ownedEntities": module.owned_entities,
                    "path": module.path,
                    "permissions": module.permissions,
                    "publicEntryPoints": module.public_entry_points,
                    "purpose": module.purpose,
                }
                for module in manifests.modules
            ],
            "repository": manifests.repository,
            "source": _source_fingerprint(tree),
        }
    )

    return RepositoryFacts(
        manifests=manifests,
        discovery=discovery,
        drift=drift,
        confidence=confidence,
        input_digest=input_digest,
    )
