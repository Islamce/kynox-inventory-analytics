"""Generate `.ai/diagrams/` — the architecture, drawn.

Every diagram is derived from the same facts as `architecture.json`, so there is
no second source of truth to fall out of date: a module boundary change shows up
as a diagram change in the same commit.

Diagrams are committed as Markdown with a fenced ```mermaid block, which GitHub
renders natively. The reviewable artifact is the file itself — no rendering
step, no image to go stale.

Levels follow C4 (docs/kaaf/STANDARDS.md §5):

    context.md              L1 — the system and what it talks to
    container.md            L2 — modules and their dependencies
    component-<id>.md       L3 — one module, its entry points and its neighbours
    flow-<id>-<flow>.md     sequence diagrams for declared flows
    index.md                what exists and how to read it

L4 (code level) is deliberately absent: STANDARDS §5 says it is generated on
demand, never committed.
"""

from scanners.facts import RepositoryFacts
from utils.mermaid import MAX_NODES_PER_DIAGRAM, document, label, node_id, partition

# Confidence drives the stroke, so an unverifiable module looks different from a
# corroborated one at a glance.
CONFIDENCE_STYLE = {
    "verified": "stroke-width:2px",
    "documented": "stroke-dasharray:4 2",
    "derived": "stroke-dasharray:2 3",
    "assumed": "stroke-dasharray:1 4",
    "unknown": "stroke-dasharray:1 6",
}

LEGEND = [
    "**Reading this diagram**",
    "",
    "- Solid arrow: a dependency declared in a `kaaf.module.json` manifest.",
    "- Dotted arrow: a real import discovered in the source that no manifest declares —"
    " see `.ai/drift.json`.",
    "- Node outline reflects confidence: solid = `verified`, dashed = `documented` or"
    " `derived`.",
]


def _all_modules(facts: RepositoryFacts) -> list[dict]:
    """Declared and discovered-only modules, in one sorted list."""
    declared_ids = {module.id for module in facts.modules}
    entries = [
        {
            "confidence": facts.confidence_for(module.id),
            "declared": True,
            "dependsOn": module.depends_on,
            "id": module.id,
            "owner": module.owner,
            "path": module.path,
        }
        for module in facts.modules
    ]
    entries += [
        {
            "confidence": facts.confidence_for(found.id),
            "declared": False,
            "dependsOn": [],
            "id": found.id,
            "owner": "unknown",
            "path": found.path,
        }
        for found in facts.discovery.modules
        if found.id not in declared_ids
    ]
    return sorted(entries, key=lambda entry: entry["id"])


def _edges(facts: RepositoryFacts) -> tuple[list[tuple[str, str]], set[tuple[str, str]]]:
    """All edges (declared ∪ discovered), and the subset that is declared."""
    declared = {(module.id, dep) for module in facts.modules for dep in module.depends_on}
    discovered = set(facts.discovery.import_edges)
    return sorted(declared | discovered), declared


def _node_line(entry: dict) -> str:
    return (
        f"  {node_id(entry['id'])}[{label(entry['id'], entry['path'], entry['confidence'])}]"
    )


def _style_line(entry: dict) -> str:
    style = CONFIDENCE_STYLE.get(entry["confidence"], CONFIDENCE_STYLE["unknown"])
    return f"  style {node_id(entry['id'])} {style}"


def _edge_line(source: str, target: str, declared: bool) -> str:
    arrow = "-->" if declared else "-.->"
    return f"  {node_id(source)} {arrow} {node_id(target)}"


def build_context(facts: RepositoryFacts) -> str:
    """C4 L1 — the system and the external systems it depends on."""
    repository = facts.repository
    system = node_id(str(repository.get("name", "system")))

    lines = ["graph TB", f"  {system}[{label(str(repository.get('name', 'System')), str(repository.get('repository', '')))}]"]

    integrations = sorted(
        (
            (module.id, integration)
            for module in facts.modules
            for integration in module.external_integrations
        ),
        key=lambda pair: (str(pair[1].get("name", "")), pair[0]),
    )

    if integrations:
        lines.append("  subgraph external[External systems]")
        for _, integration in integrations:
            name = str(integration.get("name", "unknown"))
            lines.append(
                f"    {node_id('ext_' + name)}"
                f"[{label(name, str(integration.get('kind', '')), str(integration.get('criticality', '')))}]"
            )
        lines.append("  end")
        for module_id, integration in integrations:
            name = str(integration.get("name", "unknown"))
            lines.append(f"  {system} -->|via {module_id}| {node_id('ext_' + name)}")

    caption = (
        f"What {repository.get('name', 'this system')} is and what it depends on. "
        f"{len(integrations)} external integration(s)."
    )
    notes = []
    if not integrations:
        notes = ["No external integrations are declared in any manifest."]
    return document("Context (C4 L1)", caption, "\n".join(lines), notes)


def build_container(facts: RepositoryFacts) -> dict[str, str]:
    """C4 L2 — modules and their dependencies, split if oversized."""
    entries = _all_modules(facts)
    by_id = {entry["id"]: entry for entry in entries}
    all_edges, declared_edges = _edges(facts)

    groups = partition([entry["id"] for entry in entries], all_edges)
    documents: dict[str, str] = {}

    for index, group in enumerate(groups, start=1):
        members = set(group)
        lines = ["graph LR"]
        for module_id in group:
            lines.append(_node_line(by_id[module_id]))
        for source, target in all_edges:
            if source in members and target in members:
                lines.append(_edge_line(source, target, (source, target) in declared_edges))
        for module_id in group:
            lines.append(_style_line(by_id[module_id]))

        crossing = [
            f"- `{source}` → `{target}`"
            for source, target in all_edges
            if (source in members) != (target in members)
        ]

        if len(groups) == 1:
            name, title = "container.md", "Containers (C4 L2)"
            caption = f"Every module and the dependencies between them. {len(entries)} module(s)."
            notes = list(LEGEND)
        else:
            name = f"container-{index}.md"
            title = f"Containers (C4 L2) — part {index} of {len(groups)}"
            caption = (
                f"{len(group)} of {len(entries)} modules. Split because the whole graph "
                f"exceeds {MAX_NODES_PER_DIAGRAM} nodes (docs/kaaf/STANDARDS.md §5)."
            )
            notes = list(LEGEND)
            if crossing:
                notes += ["", "**Edges to other parts**", ""] + crossing

        documents[f"diagrams/{name}"] = document(title, caption, "\n".join(lines), notes)

    return documents


def build_components(facts: RepositoryFacts) -> dict[str, str]:
    """C4 L3 — one diagram per module: its entry points and its neighbours."""
    entries = _all_modules(facts)
    by_id = {entry["id"]: entry for entry in entries}
    all_edges, declared_edges = _edges(facts)
    documents: dict[str, str] = {}

    declared_by_id = {module.id: module for module in facts.modules}

    for entry in entries:
        module_id = entry["id"]
        declared_module = declared_by_id.get(module_id)

        # A module's public surface is what its manifest declares, not every file
        # that happens to be executable (docs/kaaf/STANDARDS.md §1). Modules with
        # no manifest have nothing declared, so discovery is all there is.
        if declared_module is not None:
            entry_points = sorted(declared_module.public_entry_points)
            surface = "declared public entry point"
        else:
            found = facts.discovery_for(module_id)
            entry_points = sorted(found.entry_points) if found else []
            surface = "discovered entry point"

        dependencies = sorted({target for source, target in all_edges if source == module_id})
        dependents = sorted({source for source, target in all_edges if target == module_id})

        # Size guard: the neighbours are the point of a component diagram, so the
        # entry-point list is what gets elided if the whole thing would exceed the
        # limit (docs/kaaf/STANDARDS.md §5).
        budget = MAX_NODES_PER_DIAGRAM - len(dependencies) - len(dependents)
        shown = entry_points[: max(budget, 1)]
        elided = len(entry_points) - len(shown)

        lines = ["graph TB", f"  subgraph {node_id(module_id)}_box[{label(module_id)}]"]
        if shown:
            for path in shown:
                lines.append(f"    {node_id('ep_' + path)}[{label(path)}]")
            if elided:
                lines.append(
                    f"    {node_id(module_id)}_more[{label(f'+{elided} more')}]"
                )
        else:
            lines.append(f"    {node_id(module_id)}_self[{label('no entry points')}]")
        lines.append("  end")

        for neighbour in dependencies:
            lines.append(_node_line(by_id[neighbour]))
            lines.append(
                f"  {node_id(module_id)}_box "
                f"{'-->' if (module_id, neighbour) in declared_edges else '-.->'} "
                f"{node_id(neighbour)}"
            )
        for neighbour in dependents:
            lines.append(_node_line(by_id[neighbour]))
            lines.append(
                f"  {node_id(neighbour)} "
                f"{'-->' if (neighbour, module_id) in declared_edges else '-.->'} "
                f"{node_id(module_id)}_box"
            )

        caption = (
            f"`{module_id}` at `{entry['path']}` — confidence `{entry['confidence']}`. "
            f"{len(entry_points)} {surface}(s), {len(dependencies)} dependency(ies), "
            f"{len(dependents)} dependent(s)."
        )
        notes = list(LEGEND)
        if elided:
            notes += [
                "",
                f"{elided} entry point(s) are not drawn: the diagram would otherwise exceed "
                f"{MAX_NODES_PER_DIAGRAM} nodes (docs/kaaf/STANDARDS.md §5). The full list is "
                f"in `../modules/{module_id}.json`.",
            ]
        documents[f"diagrams/component-{module_id}.md"] = document(
            f"Component — {module_id} (C4 L3)", caption, "\n".join(lines), notes
        )

    return documents


def build_flows(facts: RepositoryFacts) -> dict[str, str]:
    """Sequence diagrams for flows declared in the manifests."""
    documents: dict[str, str] = {}

    for module in facts.modules:
        for flow in module.flows:
            flow_id = str(flow.get("id"))
            participants: list[str] = []
            for step in flow.get("steps", []):
                for role in (step["from"], step["to"]):
                    if role not in participants:
                        participants.append(role)

            lines = ["sequenceDiagram", "  autonumber"]
            for participant in participants:
                lines.append(f"  participant {node_id(participant)} as {participant}")
            for step in flow.get("steps", []):
                arrow = "-->>" if step.get("kind") == "response" else "->>"
                lines.append(
                    f"  {node_id(step['from'])}{arrow}{node_id(step['to'])}: {step['action']}"
                )

            caption = f"{flow.get('title')} — declared by `{module.id}` in `{module.manifest_path}`."
            documents[f"diagrams/flow-{module.id}-{flow_id}.md"] = document(
                f"Flow — {flow.get('title')}", caption, "\n".join(lines)
            )

    return documents


def build_index(facts: RepositoryFacts, names: list[str]) -> str:
    """A table of contents, so an agent can find the right diagram without listing files."""
    rows = []
    for name in sorted(names):
        base = name.split("/", 1)[1]
        if base.startswith("container"):
            kind = "Container (L2)"
        elif base.startswith("component-"):
            kind = "Component (L3)"
        elif base.startswith("flow-"):
            kind = "Flow (sequence)"
        elif base.startswith("context"):
            kind = "Context (L1)"
        else:
            kind = "Other"
        rows.append(f"| [{base}]({base}) | {kind} |")

    lines = [
        "Generated from the same facts as `../architecture.json`. There is no separate",
        "diagram source to keep in step — a module boundary change appears here in the",
        "same commit that makes it.",
        "",
        "| Diagram | Level |",
        "|---|---|",
        *rows,
        "",
        f"Diagrams are split above {MAX_NODES_PER_DIAGRAM} nodes rather than shrunk",
        "(docs/kaaf/STANDARDS.md §5). Code-level (L4) diagrams are generated on demand and",
        "never committed.",
        "",
        *LEGEND,
    ]

    from utils.provenance import MARKDOWN_MARKER

    return "\n".join([MARKDOWN_MARKER, "", "# Generated diagrams", "", *lines, ""])


def build(facts: RepositoryFacts) -> dict[str, str]:
    """Return {relative output path: Markdown} for every diagram."""
    documents: dict[str, str] = {"diagrams/context.md": build_context(facts)}
    documents.update(build_container(facts))
    documents.update(build_components(facts))
    documents.update(build_flows(facts))
    documents["diagrams/index.md"] = build_index(facts, list(documents))
    return dict(sorted(documents.items()))
