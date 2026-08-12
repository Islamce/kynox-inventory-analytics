"""Generate `.ai/summary.md` — the narrative overview.

Kept deliberately short (docs/kaaf/STANDARDS.md §8 targets under ~2,000 words):
orientation, not detail. Detail belongs in the JSON artifacts.
"""

from scanners.facts import RepositoryFacts
from utils.provenance import GENERATOR_VERSION, MARKDOWN_MARKER


def _table(headers: list[str], rows: list[list[str]]) -> list[str]:
    lines = ["| " + " | ".join(headers) + " |", "|" + "|".join(["---"] * len(headers)) + "|"]
    lines += ["| " + " | ".join(row) + " |" for row in rows]
    return lines


def build(facts: RepositoryFacts) -> str:
    repository = facts.repository
    declared_ids = {module.id for module in facts.modules}
    undeclared = [found for found in facts.discovery.modules if found.id not in declared_ids]
    counts = facts.drift["counts"]

    lines: list[str] = [
        MARKDOWN_MARKER,
        "",
        f"# {repository.get('name', 'Repository')} — Architecture Summary",
        "",
        str(repository.get("description", "")).strip(),
        "",
        f"- Repository: `{repository.get('repository')}`",
        f"- Default branch: `{repository.get('defaultBranch')}`",
        f"- KAAF phase: {repository.get('kaafPhase')}",
        f"- Modules: {len(facts.modules)} declared, {len(undeclared)} discovered only",
        f"- Drift: {counts['error']} error, {counts['warning']} warning, {counts['info']} info",
        f"- Generator: `kaaf` v{GENERATOR_VERSION}",
        f"- Input digest: `{facts.input_digest[:16]}…`",
        "",
        "## Modules",
        "",
        "Confidence is computed from evidence, not copied from the manifest: `verified` =",
        "declared and corroborated by discovered code, `documented` = declared with no code to",
        "check against, `derived` = discovered with no declaration.",
        "",
    ]

    rows = [
        [
            f"`{m.id}`",
            f"`{m.path}`",
            m.owner,
            m.purpose,
            f"`{facts.confidence_for(m.id)}`",
        ]
        for m in facts.modules
    ]
    rows += [
        [
            f"`{found.id}`",
            f"`{found.path}`",
            "unknown",
            "Not declared — discovered from source.",
            f"`{facts.confidence_for(found.id)}`",
        ]
        for found in undeclared
    ]
    lines += _table(["Module", "Path", "Owner", "Purpose", "Confidence"], sorted(rows))

    lines += ["", "## Dependencies", ""]
    edges = [(m.id, dep) for m in facts.modules for dep in m.depends_on]
    discovered_edges = list(facts.discovery.import_edges)
    if edges or discovered_edges:
        declared_set = set(edges)
        lines += ["```mermaid", "graph LR"]
        for module in facts.modules:
            lines.append(f'  {module.id.replace("-", "_")}["{module.id}"]')
        for found in undeclared:
            lines.append(f'  {found.id.replace("-", "_")}["{found.id} (undeclared)"]')
        for source, target in sorted(set(edges) | set(discovered_edges)):
            arrow = "-->" if (source, target) in declared_set else "-.->"
            lines.append(f'  {source.replace("-", "_")} {arrow} {target.replace("-", "_")}')
        lines.append("```")
        lines += [
            "",
            "Solid edges are declared in the manifests. Dotted edges were discovered from real",
            "imports but are not declared — see the drift section below.",
        ]
    else:
        lines.append("No dependencies, declared or discovered.")

    apis = [(m.id, api) for m in facts.modules for api in m.apis]
    lines += ["", "## Public contracts", ""]
    if apis:
        lines += _table(
            ["Contract", "Kind", "Module", "Path", "Stability"],
            [
                [
                    f"`{api.get('id', '?')}`",
                    str(api.get("kind", "unknown")),
                    f"`{module_id}`",
                    f"`{api.get('path', api.get('topic', '—'))}`",
                    str(api.get("stability", "unknown")),
                ]
                for module_id, api in sorted(apis, key=lambda p: (p[0], str(p[1].get("id", ""))))
            ],
        )
    else:
        lines.append("No declared public contracts.")

    permissions = [(m.id, p) for m in facts.modules for p in m.permissions]
    lines += ["", "## Permissions", ""]
    if permissions:
        lines += _table(
            ["Key", "Module", "Roles", "Enforced at"],
            [
                [
                    f"`{permission.get('key', '?')}`",
                    f"`{module_id}`",
                    ", ".join(permission.get("roles", [])) or "—",
                    ", ".join(f"`{p}`" for p in permission.get("enforcedAt", [])) or "—",
                ]
                for module_id, permission in sorted(
                    permissions, key=lambda p: (p[0], str(p[1].get("key", "")))
                )
            ],
        )
    else:
        lines.append("No declared permissions.")

    integrations = [(m.id, i) for m in facts.modules for i in m.external_integrations]
    lines += ["", "## External integrations", ""]
    if integrations:
        lines += _table(
            ["Integration", "Module", "Criticality", "On unavailability"],
            [
                [
                    str(integration.get("name", "?")),
                    f"`{module_id}`",
                    str(integration.get("criticality", "unknown")),
                    str(integration.get("onUnavailable", "unknown")),
                ]
                for module_id, integration in sorted(
                    integrations, key=lambda p: (p[0], str(p[1].get("name", "")))
                )
            ],
        )
    else:
        lines.append("No declared external integrations.")

    lines += ["", "## Drift — declared versus discovered", ""]
    findings = facts.drift["findings"]
    if findings:
        lines += [
            f"{counts['error']} error, {counts['warning']} warning, {counts['info']} info. "
            "Errors block CI; warnings and information do not.",
            "",
        ]
        lines += _table(
            ["Severity", "Type", "Module", "Finding"],
            [
                [
                    f"`{finding['severity']}`",
                    f"`{finding['type']}`",
                    f"`{finding['module']}`",
                    finding["summary"],
                ]
                for finding in findings
            ],
        )
        lines += ["", "Full detail, with evidence and recommendations, in `.ai/drift.json`."]
    else:
        lines.append("No drift: every declaration matches what discovery found in the source.")

    lines += [
        "",
        "## How to use this",
        "",
        "1. Read `.ai/ai-context.json` for the module index and conventions.",
        "2. Read this summary for orientation.",
        "3. Read `.ai/modules/<id>.json` for the module your task touches.",
        "4. Check `.ai/drift.json` before trusting a declaration.",
        "5. Open only the source files those steps referenced.",
        "",
        "Declarations come from `kaaf.repo.json` and `kaaf.module.json`. Discovery is a static",
        "read of the source: dynamic imports and runtime wiring are invisible to it, so the",
        "absence of a drift finding is not proof that none exists.",
        "",
    ]

    return "\n".join(lines)
