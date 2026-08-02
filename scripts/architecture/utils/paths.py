"""Repository path handling.

Every path the generator emits is repository-relative with forward slashes, so
generated context is identical regardless of where the repository is checked
out (docs/kaaf/STANDARDS.md §8 — no absolute machine paths).
"""

from pathlib import Path

# utils/ -> architecture/ -> scripts/ -> <repo root>
REPO_ROOT = Path(__file__).resolve().parents[3]

# Directories the scanners never descend into.
#
# Two kinds: KAAF's own generated output, and build artifacts or vendored
# dependencies. Scanning the latter would report a repository's dependencies as
# its own source — thousands of files, none of them written here.
EXCLUDED_DIR_NAMES = frozenset(
    {
        # KAAF and version control
        ".git",
        ".ai",
        # Python
        "__pycache__",
        ".venv",
        "venv",
        ".mypy_cache",
        ".pytest_cache",
        ".tox",
        # JavaScript / TypeScript
        "node_modules",
        "dist",
        "build",
        ".next",
        ".nuxt",
        ".svelte-kit",
        ".turbo",
        ".parcel-cache",
        "coverage",
        "out",
        "storybook-static",
        # Dart / Flutter and native mobile
        ".dart_tool",
        ".flutter-plugins",
        "Pods",
        ".gradle",
        "DerivedData",
        # General
        "vendor",
        ".cache",
        "tmp",
    }
)


def repo_root() -> Path:
    """Absolute path of the repository root."""
    return REPO_ROOT


def rel(path: Path, root: Path | None = None) -> str:
    """Repository-relative POSIX path for `path`."""
    base = root or REPO_ROOT
    return Path(path).resolve().relative_to(Path(base).resolve()).as_posix()


def iter_files(root: Path, filename: str) -> list[Path]:
    """Every file named `filename` under `root`, excluding EXCLUDED_DIR_NAMES.

    Returned sorted by repository-relative path so callers never depend on
    filesystem iteration order (determinism, docs/kaaf/STANDARDS.md §8).
    """
    root = Path(root).resolve()
    found: list[Path] = []
    stack = [root]
    while stack:
        current = stack.pop()
        for entry in sorted(current.iterdir(), key=lambda p: p.name):
            if entry.is_dir():
                if entry.name not in EXCLUDED_DIR_NAMES:
                    stack.append(entry)
            elif entry.name == filename:
                found.append(entry)
    return sorted(found, key=lambda p: rel(p, root))
