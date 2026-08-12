"""Discovery — attribute discovered source to modules, declared or not.

Turns a `SourceTree` into a per-module view: which files belong to which
module, which imports cross a module boundary, and which code belongs to no
declared module at all.

That last case is what makes the Phase 3 exit criterion work — a new module
appears in `.ai/` from its code alone, with no manifest edit — while still
being reported as drift so it cannot land silently.
"""

from dataclasses import dataclass, field

from scanners.manifests import Module
from scanners.source import SourceTree

# A directory of documents is not a module. Only executable code makes a
# directory a discovery candidate.
MIN_CODE_FILES_FOR_CANDIDATE = 1


@dataclass(frozen=True)
class ModuleDiscovery:
    """What the source tree says about one module."""

    id: str
    path: str
    declared: bool
    source_files: tuple[str, ...] = ()
    code_files: tuple[str, ...] = ()
    entry_points: tuple[str, ...] = ()
    public_symbols: tuple[str, ...] = ()
    languages: tuple[str, ...] = ()
    parse_errors: tuple[str, ...] = ()

    @property
    def has_code(self) -> bool:
        return len(self.code_files) > 0


@dataclass(frozen=True)
class Discovery:
    """The discovered view of the repository."""

    modules: tuple[ModuleDiscovery, ...] = ()
    import_edges: tuple[tuple[str, str], ...] = ()
    edge_evidence: dict[tuple[str, str], tuple[str, ...]] = field(default_factory=dict)
    unattributed_code: tuple[str, ...] = ()

    def by_id(self, module_id: str) -> ModuleDiscovery | None:
        for module in self.modules:
            if module.id == module_id:
                return module
        return None


def _slugify(path: str) -> str:
    """Derive a stable module id from a repository-relative directory path."""
    cleaned = []
    for character in path.lower():
        if character.isalnum():
            cleaned.append(character)
        elif character in "/._- ":
            cleaned.append("-")
    slug = "".join(cleaned).strip("-")
    while "--" in slug:
        slug = slug.replace("--", "-")
    return slug or "root"


def _owning_path(file_path: str, module_paths: list[str]) -> str | None:
    """Longest declared module path that contains `file_path`, or None.

    Longest-prefix wins, so a module nested inside another is attributed to the
    nested one — the more specific declaration is the more accurate one.
    """
    best: str | None = None
    for module_path in module_paths:
        prefix = "" if module_path == "." else module_path + "/"
        if module_path == "." or file_path.startswith(prefix):
            if best is None or len(module_path) > len(best):
                best = module_path
    return best


def _top_level_directory(file_path: str) -> str:
    parent = file_path.rsplit("/", 1)[0] if "/" in file_path else "."
    return parent


def discover(modules: list[Module], tree: SourceTree) -> Discovery:
    """Attribute source files to modules and derive real import edges."""
    declared_by_path = {module.path: module for module in modules}
    module_paths = sorted(declared_by_path)

    attribution: dict[str, list[str]] = {module.id: [] for module in modules}
    path_owner: dict[str, str] = {}
    unattributed: list[str] = []

    for source_file in tree.files:
        owning_path = _owning_path(source_file.path, module_paths)
        if owning_path is None:
            if source_file.is_code:
                unattributed.append(source_file.path)
            continue
        module_id = declared_by_path[owning_path].id
        attribution[module_id].append(source_file.path)
        path_owner[source_file.path] = module_id

    # Undeclared candidates: group unattributed code by its directory. Each
    # group becomes a module discovered from code alone.
    candidates: dict[str, list[str]] = {}
    for file_path in unattributed:
        candidates.setdefault(_top_level_directory(file_path), []).append(file_path)

    discovered: list[ModuleDiscovery] = []

    for module in modules:
        files = sorted(attribution[module.id])
        discovered.append(_build(module.id, module.path, True, files, tree, module))

    for directory, files in sorted(candidates.items()):
        if len(files) < MIN_CODE_FILES_FOR_CANDIDATE:
            continue
        module_id = _slugify(directory)
        for file_path in files:
            path_owner[file_path] = module_id
        discovered.append(_build(module_id, directory, False, sorted(files), tree, None))

    # Import edges between modules, with the importing file as evidence.
    edges: dict[tuple[str, str], set[str]] = {}
    for source_file in tree.files:
        importer = path_owner.get(source_file.path)
        if importer is None:
            continue
        for target_path in source_file.resolved_imports:
            imported = path_owner.get(target_path)
            if imported is None or imported == importer:
                continue
            edges.setdefault((importer, imported), set()).add(source_file.path)

    ordered_edges = tuple(sorted(edges))
    return Discovery(
        modules=tuple(sorted(discovered, key=lambda m: m.id)),
        import_edges=ordered_edges,
        edge_evidence={edge: tuple(sorted(edges[edge])) for edge in ordered_edges},
        unattributed_code=tuple(sorted(unattributed)),
    )


def _build(
    module_id: str,
    path: str,
    declared: bool,
    files: list[str],
    tree: SourceTree,
    module: Module | None,
) -> ModuleDiscovery:
    source_files = [tree.by_path[file_path] for file_path in files]
    code_files = [f for f in source_files if f.is_code]

    # Public surface is measured at the declared entry points, not across every
    # file — an internal helper is not part of a module's public surface
    # (docs/kaaf/STANDARDS.md §1).
    entry_point_paths = set(module.public_entry_points) if module else set()
    public_symbols: set[str] = set()
    for source_file in source_files:
        if source_file.path in entry_point_paths or (module is None and source_file.is_entry_point):
            public_symbols.update(source_file.public_symbols)

    return ModuleDiscovery(
        id=module_id,
        path=path,
        declared=declared,
        source_files=tuple(f.path for f in source_files),
        code_files=tuple(f.path for f in code_files),
        entry_points=tuple(sorted(f.path for f in source_files if f.is_entry_point)),
        public_symbols=tuple(sorted(public_symbols)),
        languages=tuple(sorted({f.language for f in source_files})),
        parse_errors=tuple(
            sorted(f"{f.path}: {f.parse_error}" for f in source_files if f.parse_error)
        ),
    )
