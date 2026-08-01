"""Drift — declared structure versus discovered reality.

Phase 2 trusted the manifests. Phase 3 checks them against the source tree and
reports every disagreement, so a manifest that has fallen behind is visible
instead of quietly producing confident, wrong context.

Two things happen here:

1. **Findings.** Each disagreement becomes a finding with a stable type, a
   severity, evidence, and a recommendation. Errors block; warnings and
   information do not.
2. **Confidence.** A module's effective confidence is *computed* from evidence,
   not taken from its manifest. Declaration alone is `documented`; declaration
   corroborated by discovered code is `verified`; code with no declaration is
   `derived` (docs/kaaf/GOVERNANCE.md §5).

A manifest can never talk its way up: `confidence` in a manifest is an input to
this calculation, never the output.
"""

from dataclasses import dataclass

from scanners.discovery import Discovery
from scanners.manifests import Module

# docs/kaaf/STANDARDS.md §1: more than ~10 exported symbols suggests the module
# is really two.
PUBLIC_SURFACE_LIMIT = 10

SEVERITY_ERROR = "error"
SEVERITY_WARNING = "warning"
SEVERITY_INFO = "info"

SEVERITY_ORDER = {SEVERITY_ERROR: 0, SEVERITY_WARNING: 1, SEVERITY_INFO: 2}


@dataclass(frozen=True)
class Finding:
    """One disagreement between what is declared and what is on disk."""

    type: str
    severity: str
    module: str
    summary: str
    evidence: tuple[str, ...]
    recommendation: str

    def as_dict(self) -> dict:
        return {
            "evidence": list(self.evidence),
            "module": self.module,
            "recommendation": self.recommendation,
            "severity": self.severity,
            "summary": self.summary,
            "type": self.type,
        }


def _sort_key(finding: Finding) -> tuple:
    return (SEVERITY_ORDER[finding.severity], finding.type, finding.module, finding.summary)


def _detect_discovered_cycle(edges: list[tuple[str, str]]) -> list[str] | None:
    """Return one cycle in the discovered import graph, or None."""
    graph: dict[str, list[str]] = {}
    for source, target in edges:
        graph.setdefault(source, []).append(target)
        graph.setdefault(target, [])
    for key in graph:
        graph[key].sort()

    WHITE, GREY, BLACK = 0, 1, 2
    colour = {node: WHITE for node in graph}
    stack: list[str] = []

    def visit(node: str) -> list[str] | None:
        colour[node] = GREY
        stack.append(node)
        for neighbour in graph[node]:
            if colour[neighbour] == GREY:
                return stack[stack.index(neighbour):] + [neighbour]
            if colour[neighbour] == WHITE:
                found = visit(neighbour)
                if found:
                    return found
        stack.pop()
        colour[node] = BLACK
        return None

    for node in sorted(graph):
        if colour[node] == WHITE:
            cycle = visit(node)
            if cycle:
                return cycle
    return None


def confidence_for(module_id: str, discovery: Discovery, declared: bool) -> tuple[str, str]:
    """Compute effective confidence and the reason for it."""
    found = discovery.by_id(module_id)

    if not declared:
        return "derived", "Discovered from source; no manifest declares this module."
    if found is None or not found.has_code:
        return (
            "documented",
            "Declared in a manifest and its entry points exist, but there is no code to "
            "corroborate the declaration against.",
        )
    if found.parse_errors:
        return (
            "assumed",
            "Declared, but source could not be fully parsed — discovery is incomplete.",
        )
    return (
        "verified",
        f"Declared and corroborated by {len(found.code_files)} discovered code file(s).",
    )


def analyse(modules: list[Module], discovery: Discovery) -> dict:
    """Compare declarations against discovery. Returns the drift report body."""
    findings: list[Finding] = []
    declared_ids = {module.id for module in modules}
    declared_by_id = {module.id: module for module in modules}

    # 1. Code that no manifest claims.
    for found in discovery.modules:
        if found.declared:
            continue
        findings.append(
            Finding(
                type="undeclared-module",
                severity=SEVERITY_WARNING,
                module=found.id,
                summary=(
                    f"{len(found.code_files)} code file(s) under '{found.path}' belong to no "
                    "declared module."
                ),
                evidence=found.code_files[:10],
                recommendation=(
                    f"Add {found.path}/kaaf.module.json declaring this module, or move the code "
                    "into an existing module."
                ),
            )
        )

    # 2. Imports that cross a module boundary without a declared dependency.
    for source, target in discovery.import_edges:
        if source not in declared_ids or target not in declared_ids:
            continue  # covered by undeclared-module
        if target in declared_by_id[source].depends_on:
            continue
        findings.append(
            Finding(
                type="undeclared-dependency",
                severity=SEVERITY_ERROR,
                module=source,
                summary=f"'{source}' imports '{target}' but does not declare the dependency.",
                evidence=discovery.edge_evidence.get((source, target), ())[:10],
                recommendation=(
                    f"Add '{target}' to dependsOn in {declared_by_id[source].manifest_path}, or "
                    "remove the import (docs/kaaf/STANDARDS.md §1)."
                ),
            )
        )

    # 3. Declared dependencies with no import evidence.
    discovered_edges = set(discovery.import_edges)
    for module in modules:
        for dependency in module.depends_on:
            if (module.id, dependency) in discovered_edges:
                continue
            findings.append(
                Finding(
                    type="unsupported-dependency",
                    severity=SEVERITY_INFO,
                    module=module.id,
                    summary=(
                        f"'{module.id}' declares a dependency on '{dependency}' that no discovered "
                        "import corroborates."
                    ),
                    evidence=(module.manifest_path,),
                    recommendation=(
                        "Expected for documentation or process dependencies. If it was meant to be "
                        "a code dependency, the import is missing."
                    ),
                )
            )

    # 4. Cycles in the discovered graph — a real cycle the manifests do not show.
    cycle = _detect_discovered_cycle(list(discovery.import_edges))
    if cycle:
        findings.append(
            Finding(
                type="discovered-import-cycle",
                severity=SEVERITY_ERROR,
                module=cycle[0],
                summary="Discovered imports form a cycle: " + " -> ".join(cycle),
                evidence=tuple(
                    evidence
                    for index in range(len(cycle) - 1)
                    for evidence in discovery.edge_evidence.get((cycle[index], cycle[index + 1]), ())
                )[:10],
                recommendation=(
                    "Break the cycle. A cycle is a design defect and blocks merge "
                    "(docs/kaaf/STANDARDS.md §1)."
                ),
            )
        )

    # 5. Source that could not be parsed — discovery is blind there.
    for found in discovery.modules:
        for parse_error in found.parse_errors:
            findings.append(
                Finding(
                    type="source-parse-error",
                    severity=SEVERITY_ERROR,
                    module=found.id,
                    summary=f"Source could not be parsed: {parse_error}",
                    evidence=(parse_error.split(":", 1)[0],),
                    recommendation="Fix the syntax error; discovery cannot see past it.",
                )
            )

    # 6. Public surface size, measured at the declared entry points.
    for found in discovery.modules:
        if len(found.public_symbols) > PUBLIC_SURFACE_LIMIT:
            findings.append(
                Finding(
                    type="large-public-surface",
                    severity=SEVERITY_INFO,
                    module=found.id,
                    summary=(
                        f"{len(found.public_symbols)} public symbols at the entry points "
                        f"(guideline is {PUBLIC_SURFACE_LIMIT})."
                    ),
                    evidence=found.public_symbols[:10],
                    recommendation=(
                        "Consider whether this module is really two "
                        "(docs/kaaf/STANDARDS.md §1)."
                    ),
                )
            )

    # 7. Declared modules with no discoverable code — confidence is capped.
    for module in modules:
        found = discovery.by_id(module.id)
        if found is not None and not found.has_code:
            findings.append(
                Finding(
                    type="module-without-code",
                    severity=SEVERITY_INFO,
                    module=module.id,
                    summary=(
                        "No code discovered; the declaration cannot be corroborated against "
                        "source."
                    ),
                    evidence=(module.manifest_path,),
                    recommendation=(
                        "Expected for documentation modules. Confidence is capped at "
                        "'documented' rather than 'verified'."
                    ),
                )
            )

    ordered = sorted(findings, key=_sort_key)
    counts = {
        SEVERITY_ERROR: sum(1 for f in ordered if f.severity == SEVERITY_ERROR),
        SEVERITY_INFO: sum(1 for f in ordered if f.severity == SEVERITY_INFO),
        SEVERITY_WARNING: sum(1 for f in ordered if f.severity == SEVERITY_WARNING),
    }

    return {
        "counts": counts,
        "declaredModules": sorted(declared_ids),
        "discoveredImportEdges": [
            {
                "evidence": list(discovery.edge_evidence.get((source, target), ())),
                "from": source,
                "to": target,
            }
            for source, target in discovery.import_edges
        ],
        "discoveredModules": sorted(found.id for found in discovery.modules),
        "findings": [finding.as_dict() for finding in ordered],
        "hasErrors": counts[SEVERITY_ERROR] > 0,
        "undeclaredCode": list(discovery.unattributed_code),
    }
