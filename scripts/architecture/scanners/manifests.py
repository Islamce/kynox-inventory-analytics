"""Manifest scanner — the Phase 2 input of record.

Reads `kaaf.repo.json` at the repository root and every `kaaf.module.json`
beneath it, validates them against the KAAF standards, and returns normalized
facts for the generators.

Structure is *declared* here, not inferred. Phase 3 adds discovery from source
and reports drift between the two; until then, a manifest that lies produces
generated context that lies, which is why validation below is strict.
"""

from dataclasses import dataclass, field
from pathlib import Path

from utils.errors import (
    E_DEPENDENCY_CYCLE,
    E_DUPLICATE_ID,
    E_MANIFEST_INVALID,
    E_MISSING_ENTRY_POINT,
    E_UNKNOWN_DEPENDENCY,
    KaafError,
)
from utils.jsonio import digest, read_json
from utils.paths import iter_files, rel, repo_root
from utils.provenance import CONFIDENCE_LEVELS

REPO_MANIFEST_NAME = "kaaf.repo.json"
MODULE_MANIFEST_NAME = "kaaf.module.json"

ID_ALPHABET = set("abcdefghijklmnopqrstuvwxyz0123456789-")

REQUIRED_MODULE_FIELDS = ("id", "purpose", "owner", "publicEntryPoints", "confidence")
REQUIRED_REPO_FIELDS = ("name", "repository", "description", "defaultBranch", "kaafPhase")

LIST_MODULE_FIELDS = (
    "publicEntryPoints",
    "dependsOn",
    "ownedEntities",
    "apis",
    "permissions",
    "externalIntegrations",
    "flows",
    "consumes",
)


@dataclass(frozen=True)
class Module:
    """One declared module, normalized and validated."""

    id: str
    path: str
    manifest_path: str
    purpose: str
    owner: str
    confidence: str
    public_entry_points: list[str]
    depends_on: list[str]
    owned_entities: list[str]
    apis: list[dict]
    permissions: list[dict]
    external_integrations: list[dict]
    flows: list[dict]
    consumes: list[dict]


@dataclass(frozen=True)
class Facts:
    """Everything the generators are allowed to know."""

    repository: dict
    modules: list[Module]
    depended_on_by: dict[str, list[str]] = field(default_factory=dict)
    input_digest: str = ""


def _require(condition: bool, code: str, message: str, evidence: str) -> None:
    if not condition:
        raise KaafError(code, message, evidence)


def _validate_module(raw: dict, manifest_path: Path, root: Path) -> Module:
    evidence = rel(manifest_path, root)

    _require(isinstance(raw, dict), E_MANIFEST_INVALID, "manifest must be a JSON object", evidence)

    for key in REQUIRED_MODULE_FIELDS:
        _require(key in raw, E_MANIFEST_INVALID, f"missing required field '{key}'", evidence)

    module_id = raw["id"]
    _require(
        isinstance(module_id, str) and module_id != "" and set(module_id) <= ID_ALPHABET,
        E_MANIFEST_INVALID,
        f"id must be lowercase kebab-case: {module_id!r}",
        evidence,
    )
    _require(
        isinstance(raw["purpose"], str) and raw["purpose"].strip() != "",
        E_MANIFEST_INVALID,
        "purpose must be a non-empty string",
        evidence,
    )
    _require(
        isinstance(raw["owner"], str) and raw["owner"].strip() != "",
        E_MANIFEST_INVALID,
        "owner must be a non-empty string",
        evidence,
    )
    _require(
        raw["confidence"] in CONFIDENCE_LEVELS,
        E_MANIFEST_INVALID,
        f"confidence must be one of {', '.join(CONFIDENCE_LEVELS)}",
        evidence,
    )

    for key in LIST_MODULE_FIELDS:
        value = raw.get(key, [])
        _require(isinstance(value, list), E_MANIFEST_INVALID, f"'{key}' must be a list", evidence)

    entry_points = list(raw["publicEntryPoints"])
    _require(
        len(entry_points) > 0,
        E_MANIFEST_INVALID,
        "publicEntryPoints must declare at least one entry point",
        evidence,
    )

    # An entry point that does not exist makes every downstream 'verified' claim
    # false, so it fails the scan rather than degrading confidence silently.
    for entry in entry_points:
        _require(
            isinstance(entry, str) and (root / entry).exists(),
            E_MISSING_ENTRY_POINT,
            f"declared public entry point does not exist: {entry}",
            evidence,
        )

    # Flows are optional, but a declared flow drives a generated sequence diagram,
    # so a malformed one would produce a diagram that misrepresents the system.
    for flow in raw.get("flows", []):
        _require(
            isinstance(flow, dict) and isinstance(flow.get("id"), str) and flow.get("id", ""),
            E_MANIFEST_INVALID,
            "each flow needs a non-empty string 'id'",
            evidence,
        )
        _require(
            isinstance(flow.get("title"), str) and flow.get("title", ""),
            E_MANIFEST_INVALID,
            f"flow '{flow.get('id')}' needs a non-empty 'title'",
            evidence,
        )
        steps = flow.get("steps")
        _require(
            isinstance(steps, list) and len(steps) > 0,
            E_MANIFEST_INVALID,
            f"flow '{flow.get('id')}' needs at least one step",
            evidence,
        )
        for step in steps:
            _require(
                isinstance(step, dict)
                and all(isinstance(step.get(key), str) and step.get(key) for key in
                        ("from", "to", "action")),
                E_MANIFEST_INVALID,
                f"each step of flow '{flow.get('id')}' needs 'from', 'to' and 'action'",
                evidence,
            )

    # Cross-repository consumption. Each entry names a contract in another
    # repository; the estate catalogue resolves it. A malformed entry would
    # produce a dangling cross-repository link, so it fails the scan.
    for consumed in raw.get("consumes", []):
        _require(
            isinstance(consumed, dict),
            E_MANIFEST_INVALID,
            "each 'consumes' entry must be an object",
            evidence,
        )
        for key in ("repository", "module"):
            _require(
                isinstance(consumed.get(key), str) and consumed.get(key, ""),
                E_MANIFEST_INVALID,
                f"each 'consumes' entry needs a non-empty '{key}'",
                evidence,
            )
        _require(
            "/" in str(consumed.get("repository", "")),
            E_MANIFEST_INVALID,
            f"'consumes.repository' must be owner/repo, got {consumed.get('repository')!r}",
            evidence,
        )
        kind = consumed.get("kind", "api")
        _require(
            kind in ("api", "permission", "event"),
            E_MANIFEST_INVALID,
            f"'consumes.kind' must be api, permission or event, got {kind!r}",
            evidence,
        )
        _require(
            isinstance(consumed.get("contract"), str) and consumed.get("contract", ""),
            E_MANIFEST_INVALID,
            "each 'consumes' entry needs a non-empty 'contract'",
            evidence,
        )

    return Module(
        id=module_id,
        path=rel(manifest_path.parent, root),
        manifest_path=evidence,
        purpose=raw["purpose"].strip(),
        owner=raw["owner"].strip(),
        confidence=raw["confidence"],
        public_entry_points=sorted(entry_points),
        depends_on=sorted(set(raw.get("dependsOn", []))),
        owned_entities=sorted(set(raw.get("ownedEntities", []))),
        apis=sorted(raw.get("apis", []), key=lambda a: str(a.get("id", ""))),
        permissions=sorted(raw.get("permissions", []), key=lambda p: str(p.get("key", ""))),
        external_integrations=sorted(
            raw.get("externalIntegrations", []), key=lambda i: str(i.get("name", ""))
        ),
        flows=sorted(raw.get("flows", []), key=lambda f: str(f.get("id", ""))),
        consumes=sorted(
            raw.get("consumes", []),
            key=lambda c: (
                str(c.get("repository", "")),
                str(c.get("module", "")),
                str(c.get("contract", "")),
            ),
        ),
    )


def _validate_repository(raw: dict, manifest_path: Path, root: Path) -> dict:
    evidence = rel(manifest_path, root)
    _require(isinstance(raw, dict), E_MANIFEST_INVALID, "manifest must be a JSON object", evidence)
    for key in REQUIRED_REPO_FIELDS:
        _require(key in raw, E_MANIFEST_INVALID, f"missing required field '{key}'", evidence)
    return raw


def _detect_cycle(modules: list[Module]) -> list[str] | None:
    """Return one dependency cycle as a path, or None. Deterministic order."""
    edges = {m.id: m.depends_on for m in modules}
    WHITE, GREY, BLACK = 0, 1, 2
    colour = {m.id: WHITE for m in modules}
    stack: list[str] = []

    def visit(node: str) -> list[str] | None:
        colour[node] = GREY
        stack.append(node)
        for dep in edges[node]:
            if colour[dep] == GREY:
                return stack[stack.index(dep):] + [dep]
            if colour[dep] == WHITE:
                found = visit(dep)
                if found:
                    return found
        stack.pop()
        colour[node] = BLACK
        return None

    for module_id in sorted(edges):
        if colour[module_id] == WHITE:
            cycle = visit(module_id)
            if cycle:
                return cycle
    return None


def scan(root: Path | None = None) -> Facts:
    """Read and validate every KAAF manifest under `root`."""
    root = Path(root or repo_root()).resolve()

    repo_manifest_path = root / REPO_MANIFEST_NAME
    repository = _validate_repository(read_json(repo_manifest_path), repo_manifest_path, root)

    modules: list[Module] = []
    seen: dict[str, str] = {}
    for manifest_path in iter_files(root, MODULE_MANIFEST_NAME):
        module = _validate_module(read_json(manifest_path), manifest_path, root)
        if module.id in seen:
            raise KaafError(
                E_DUPLICATE_ID,
                f"module id '{module.id}' is declared twice",
                f"{seen[module.id]} and {module.manifest_path}",
            )
        seen[module.id] = module.manifest_path
        modules.append(module)

    modules.sort(key=lambda m: m.id)
    known = {m.id for m in modules}

    for module in modules:
        for dep in module.depends_on:
            if dep == module.id:
                raise KaafError(
                    E_UNKNOWN_DEPENDENCY,
                    f"module '{module.id}' depends on itself",
                    module.manifest_path,
                )
            if dep not in known:
                raise KaafError(
                    E_UNKNOWN_DEPENDENCY,
                    f"module '{module.id}' depends on unknown module '{dep}'",
                    module.manifest_path,
                )

    cycle = _detect_cycle(modules)
    if cycle:
        raise KaafError(
            E_DEPENDENCY_CYCLE,
            "dependency cycle: " + " -> ".join(cycle),
            "docs/kaaf/STANDARDS.md §1 — a cycle is a design defect and blocks merge",
        )

    depended_on_by: dict[str, list[str]] = {m.id: [] for m in modules}
    for module in modules:
        for dep in module.depends_on:
            depended_on_by[dep].append(module.id)
    for key in depended_on_by:
        depended_on_by[key].sort()

    input_digest = digest(
        {
            "repository": repository,
            "modules": [
                {
                    "apis": m.apis,
                    "confidence": m.confidence,
                    "dependsOn": m.depends_on,
                    "externalIntegrations": m.external_integrations,
                    "id": m.id,
                    "owner": m.owner,
                    "ownedEntities": m.owned_entities,
                    "path": m.path,
                    "permissions": m.permissions,
                    "publicEntryPoints": m.public_entry_points,
                    "purpose": m.purpose,
                }
                for m in modules
            ],
        }
    )

    return Facts(
        repository=repository,
        modules=modules,
        depended_on_by=depended_on_by,
        input_digest=input_digest,
    )
