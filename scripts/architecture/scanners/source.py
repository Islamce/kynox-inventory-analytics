"""Source scanner — Phase 3 discovery, Phase 7 language coverage.

Reads the actual source tree and reports what is *there*, independent of what
any manifest claims.

The work is split three ways:

    languages.py   text  → imports, exports, entry points   (per language)
    resolve.py     specifier → repository path              (per repository)
    source.py      walk the tree and put the two together

This scanner never decides what a module is — that is `discovery.py`'s job — and
it never compares against declarations — that is `drift.py`'s job. It reports
facts with the file they came from, and nothing else.

Everything it emits is `derived` confidence at best: a static read cannot see
dynamic imports, runtime registration, or bundler aliases it was not told about.
"""

from dataclasses import dataclass, field
from pathlib import Path

from scanners.languages import (  # noqa: F401  (re-exported for callers)
    CODE_LANGUAGES,
    LANGUAGE_BY_SUFFIX,
    extract,
)
from scanners.resolve import Resolver
from utils.paths import EXCLUDED_DIR_NAMES, rel, repo_root


@dataclass(frozen=True)
class SourceFile:
    """One file, as discovered on disk."""

    path: str
    language: str
    imports: tuple[str, ...] = ()
    resolved_imports: tuple[str, ...] = ()
    public_symbols: tuple[str, ...] = ()
    is_entry_point: bool = False
    parse_error: str | None = None

    @property
    def is_code(self) -> bool:
        return self.language in CODE_LANGUAGES


@dataclass(frozen=True)
class SourceTree:
    """Every source file in the repository, sorted by path."""

    files: tuple[SourceFile, ...] = ()
    by_path: dict[str, SourceFile] = field(default_factory=dict)


def _walk(root: Path) -> list[Path]:
    """Every file with a language KAAF understands, sorted by repository path."""
    paths: list[Path] = []
    stack = [root]
    while stack:
        current = stack.pop()
        try:
            entries = sorted(current.iterdir(), key=lambda path: path.name)
        except OSError:
            continue
        for entry in entries:
            if entry.is_dir():
                if entry.name not in EXCLUDED_DIR_NAMES:
                    stack.append(entry)
            elif entry.suffix in LANGUAGE_BY_SUFFIX:
                paths.append(entry)
    return sorted(paths, key=lambda path: rel(path, root))


def scan(root: Path | None = None) -> SourceTree:
    """Walk the repository and describe every source file found."""
    root = Path(root or repo_root()).resolve()
    resolver = Resolver.load(root)

    files: list[SourceFile] = []
    for path in _walk(root):
        language = LANGUAGE_BY_SUFFIX[path.suffix]
        relative = rel(path, root)

        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError as error:
            files.append(
                SourceFile(path=relative, language=language.name, parse_error=str(error))
            )
            continue

        found = extract(path.suffix, text, relative)

        resolved = sorted(
            {
                target
                for target in (
                    resolver.resolve(language.name, specifier, path)
                    for specifier in found.imports
                )
                if target is not None and target != relative  # ignore self-imports
            }
        )

        files.append(
            SourceFile(
                path=relative,
                language=language.name,
                imports=found.imports,
                resolved_imports=tuple(resolved),
                public_symbols=found.public_symbols,
                # A file named as a package entry point is an entry point even
                # without a shebang — that is what `main` and `bin` mean.
                is_entry_point=found.is_entry_point
                or relative in resolver.declared_entry_points,
                parse_error=found.parse_error,
            )
        )

    ordered = tuple(sorted(files, key=lambda source: source.path))
    return SourceTree(files=ordered, by_path={source.path: source for source in ordered})
