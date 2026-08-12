"""Mermaid rendering helpers.

Diagram *text* is deterministic even though diagram *layout* is not: the
renderer decides where nodes land, but the emitted source is byte-identical for
identical inputs because everything here is sorted and escaped the same way
every time (docs/kaaf/STANDARDS.md §8).

Size guards live here too. A 60-node graph is not a diagram, it is a hairball —
docs/kaaf/STANDARDS.md §5 says split rather than shrink the font, so `partition`
splits an oversized graph along its own connected components before falling back
to alphabetical chunks.
"""

# docs/kaaf/STANDARDS.md §5: keep any single diagram under ~20 nodes.
MAX_NODES_PER_DIAGRAM = 20

_ID_SAFE = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_")

# Mermaid treats these as syntax inside labels; the HTML entities render as the
# original character.
_LABEL_REPLACEMENTS = (
    ("&", "&amp;"),
    ('"', "&quot;"),
    ("<", "&lt;"),
    (">", "&gt;"),
    ("[", "&#91;"),
    ("]", "&#93;"),
    ("(", "&#40;"),
    (")", "&#41;"),
    ("{", "&#123;"),
    ("}", "&#125;"),
    ("|", "&#124;"),
)


def node_id(raw: str) -> str:
    """A Mermaid-safe node identifier derived from `raw`."""
    cleaned = "".join(character if character in _ID_SAFE else "_" for character in raw)
    while "__" in cleaned:
        cleaned = cleaned.replace("__", "_")
    cleaned = cleaned.strip("_")
    if not cleaned:
        return "node"
    if cleaned[0].isdigit():
        cleaned = f"n_{cleaned}"
    return cleaned


def escape(text: str) -> str:
    """Escape `text` for use inside a Mermaid label."""
    escaped = str(text)
    for character, replacement in _LABEL_REPLACEMENTS:
        escaped = escaped.replace(character, replacement)
    return escaped


def label(*lines: str) -> str:
    """A quoted multi-line Mermaid label."""
    return '"' + "<br/>".join(escape(line) for line in lines if line) + '"'


def _components(nodes: list[str], edges: list[tuple[str, str]]) -> list[list[str]]:
    """Connected components of the undirected graph, deterministically ordered."""
    adjacency: dict[str, set[str]] = {node: set() for node in nodes}
    for source, target in edges:
        if source in adjacency and target in adjacency:
            adjacency[source].add(target)
            adjacency[target].add(source)

    seen: set[str] = set()
    components: list[list[str]] = []
    for node in sorted(nodes):
        if node in seen:
            continue
        stack = [node]
        component: list[str] = []
        seen.add(node)
        while stack:
            current = stack.pop()
            component.append(current)
            for neighbour in sorted(adjacency[current]):
                if neighbour not in seen:
                    seen.add(neighbour)
                    stack.append(neighbour)
        components.append(sorted(component))
    return sorted(components, key=lambda component: component[0])


def partition(
    nodes: list[str],
    edges: list[tuple[str, str]],
    limit: int = MAX_NODES_PER_DIAGRAM,
) -> list[list[str]]:
    """Split `nodes` into groups no larger than `limit`.

    Splits along connected components first, so related nodes stay together and
    the split follows the architecture rather than cutting across it. A single
    component larger than the limit is chunked alphabetically — at that size the
    graph needs a human decision, and an arbitrary-but-stable split is more
    useful than an unreadable diagram.

    Returns a single group when everything fits.
    """
    if len(nodes) <= limit:
        return [sorted(nodes)] if nodes else []

    groups: list[list[str]] = []
    pending: list[str] = []

    for component in _components(nodes, edges):
        if len(component) > limit:
            if pending:
                groups.append(pending)
                pending = []
            for start in range(0, len(component), limit):
                groups.append(component[start:start + limit])
            continue

        if len(pending) + len(component) > limit:
            groups.append(pending)
            pending = []
        pending.extend(component)

    if pending:
        groups.append(pending)
    return groups


def document(title: str, caption: str, diagram: str, notes: list[str] | None = None) -> str:
    """Wrap a Mermaid diagram in the Markdown KAAF publishes.

    A fenced ```mermaid block renders natively on GitHub, so the committed file
    is the reviewable artifact — no separate rendering step, no image to fall out
    of date.
    """
    from .provenance import MARKDOWN_MARKER

    lines = [MARKDOWN_MARKER, "", f"# {title}", "", caption, "", "```mermaid", diagram, "```"]
    if notes:
        lines += [""] + notes
    lines.append("")
    return "\n".join(lines)
