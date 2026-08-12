"""Language extraction — text in, facts out.

One handler per language. A handler reads a file's text and reports what it
imports, what it exports, and whether it is an entry point. It does **not**
resolve anything: turning `'./thing'` into `src/thing.ts` needs repository
context and lives in `resolve.py`.

That split is what makes adding a language cheap. Extraction is local and
textual; resolution is global and repository-shaped. Conflating them is why the
Python-only scanner could not be extended without rewriting.

Python is parsed with `ast`. Everything else is regex over comment-stripped
source — a deliberate trade: no parser for TypeScript or Dart exists in the
standard library, and `STANDARDS.md` §4 forbids adding a dependency without an
explicit decision. Regex extraction is why discovery never exceeds `derived`
confidence: it sees what is written literally, not what a bundler or a runtime
would resolve.
"""

import ast
import re
from dataclasses import dataclass, field

# --------------------------------------------------------------------------
# Result
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class Extraction:
    """What a language handler found in one file."""

    imports: tuple[str, ...] = ()
    public_symbols: tuple[str, ...] = ()
    is_entry_point: bool = False
    parse_error: str | None = None


# --------------------------------------------------------------------------
# Shared helpers
# --------------------------------------------------------------------------

_LINE_COMMENT = re.compile(r"//[^\n]*")
_BLOCK_COMMENT = re.compile(r"/\*.*?\*/", re.DOTALL)
_DART_DOC_COMMENT = re.compile(r"///[^\n]*")


def _strip_c_comments(text: str) -> str:
    """Remove // and /* */ comments.

    Without this a commented-out import is reported as a real dependency, which
    would produce drift findings for code that does not exist. Block comments go
    first so a `//` inside one is not mistaken for a line comment.
    """
    return _LINE_COMMENT.sub("", _BLOCK_COMMENT.sub("", text))


def _has_shebang(text: str) -> bool:
    return text.startswith("#!")


# --------------------------------------------------------------------------
# Python
# --------------------------------------------------------------------------


def _python_public_symbols(tree: ast.Module) -> list[str]:
    return sorted(
        node.name
        for node in tree.body
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))
        and not node.name.startswith("_")
    )


def _python_has_main_guard(tree: ast.Module) -> bool:
    for node in tree.body:
        if not isinstance(node, ast.If):
            continue
        test = node.test
        if (
            isinstance(test, ast.Compare)
            and isinstance(test.left, ast.Name)
            and test.left.id == "__name__"
            and any(
                isinstance(comparator, ast.Constant) and comparator.value == "__main__"
                for comparator in test.comparators
            )
        ):
            return True
    return False


def extract_python(text: str, filename: str) -> Extraction:
    try:
        tree = ast.parse(text, filename=filename)
    except SyntaxError as error:
        return Extraction(parse_error=f"line {error.lineno}: {error.msg}")

    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                names.add(alias.name)
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            names.add("." * node.level + module if node.level else module)

    return Extraction(
        imports=tuple(sorted(name for name in names if name)),
        public_symbols=tuple(_python_public_symbols(tree)),
        is_entry_point=_python_has_main_guard(tree),
    )


# --------------------------------------------------------------------------
# TypeScript / JavaScript
# --------------------------------------------------------------------------

# import x from 'y' | import 'y' | import type {a} from 'y' | export * from 'y'
_TS_STATIC = re.compile(
    r"""(?:^|\s)(?:import|export)\s+(?:type\s+)?
        (?:[^'"()]*?\bfrom\s*)?          # optional binding clause
        ['"]([^'"]+)['"]""",
    re.VERBOSE | re.MULTILINE,
)
_TS_REQUIRE = re.compile(r"""\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)""")
_TS_DYNAMIC = re.compile(r"""\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)""")

_TS_EXPORT_NAMED = re.compile(
    r"^\s*export\s+(?:async\s+)?(?:function\*?|class|const|let|var|type|interface|enum)\s+"
    r"([A-Za-z_$][\w$]*)",
    re.MULTILINE,
)
_TS_EXPORT_LIST = re.compile(r"^\s*export\s*\{([^}]*)\}", re.MULTILINE)
_TS_EXPORT_DEFAULT = re.compile(r"^\s*export\s+default\b", re.MULTILINE)


def extract_typescript(text: str, filename: str) -> Extraction:
    source = _strip_c_comments(text)

    specifiers: set[str] = set()
    for pattern in (_TS_STATIC, _TS_REQUIRE, _TS_DYNAMIC):
        specifiers.update(match.group(1) for match in pattern.finditer(source))

    symbols: set[str] = {match.group(1) for match in _TS_EXPORT_NAMED.finditer(source)}
    for match in _TS_EXPORT_LIST.finditer(source):
        for part in match.group(1).split(","):
            name = part.strip()
            if not name:
                continue
            # `export { internal as public }` publishes the alias.
            if " as " in name:
                name = name.split(" as ")[-1].strip()
            if name and name != "default":
                symbols.add(name)
    if _TS_EXPORT_DEFAULT.search(source):
        symbols.add("default")

    return Extraction(
        imports=tuple(sorted(specifier for specifier in specifiers if specifier)),
        public_symbols=tuple(sorted(symbols)),
        # A shebang is the only entry-point marker visible in the file itself.
        # package.json `main`/`bin` targets are marked by the resolver, which can
        # see the whole repository.
        is_entry_point=_has_shebang(text),
    )


# --------------------------------------------------------------------------
# Dart
# --------------------------------------------------------------------------

_DART_DIRECTIVE = re.compile(
    r"""^\s*(?:import|export|part)\s+['"]([^'"]+)['"]""", re.MULTILINE
)
_DART_DECLARATION = re.compile(
    r"^\s*(?:abstract\s+|final\s+|sealed\s+|base\s+|interface\s+)*"
    r"(?:class|mixin|enum|extension|typedef)\s+([A-Za-z_$][\w$]*)",
    re.MULTILINE,
)
_DART_MAIN = re.compile(r"^\s*(?:void\s+|Future<void>\s+)?main\s*\(", re.MULTILINE)


def extract_dart(text: str, filename: str) -> Extraction:
    source = _strip_c_comments(_DART_DOC_COMMENT.sub("", text))

    specifiers = {match.group(1) for match in _DART_DIRECTIVE.finditer(source)}
    symbols = {
        match.group(1)
        for match in _DART_DECLARATION.finditer(source)
        if not match.group(1).startswith("_")
    }

    return Extraction(
        imports=tuple(sorted(specifier for specifier in specifiers if specifier)),
        public_symbols=tuple(sorted(symbols)),
        is_entry_point=bool(_DART_MAIN.search(source)),
    )


# --------------------------------------------------------------------------
# Shell
# --------------------------------------------------------------------------


def extract_shell(text: str, filename: str) -> Extraction:
    # Sourcing another script is a real dependency, but the specifier is usually
    # built from a variable ($SCRIPT_DIR/...) and cannot be resolved statically.
    # Reporting nothing is more honest than reporting a path that does not exist.
    return Extraction(is_entry_point=_has_shebang(text))


# --------------------------------------------------------------------------
# Registry
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class Language:
    """One language KAAF can read."""

    name: str
    suffixes: tuple[str, ...]
    extract: object
    is_code: bool = True
    # Directories that hold this language's build output or dependencies.
    excluded_dirs: tuple[str, ...] = field(default_factory=tuple)


LANGUAGES: tuple[Language, ...] = (
    Language(
        name="python",
        suffixes=(".py",),
        extract=extract_python,
        excluded_dirs=("__pycache__", ".venv", "venv", ".mypy_cache", ".pytest_cache", ".tox"),
    ),
    Language(
        name="typescript",
        suffixes=(".ts", ".tsx", ".mts", ".cts"),
        extract=extract_typescript,
        excluded_dirs=("node_modules", "dist", "build", ".next", ".turbo", "coverage", "out"),
    ),
    Language(
        name="javascript",
        suffixes=(".js", ".jsx", ".mjs", ".cjs"),
        extract=extract_typescript,  # same syntax for what we extract
        excluded_dirs=("node_modules", "dist", "build", ".next", ".turbo", "coverage", "out"),
    ),
    Language(
        name="dart",
        suffixes=(".dart",),
        extract=extract_dart,
        excluded_dirs=(".dart_tool", "Pods", ".gradle"),
    ),
    Language(name="shell", suffixes=(".sh",), extract=extract_shell),
    # Classified but not code: present in the file listing, never a reason for a
    # directory to be considered a module.
    Language(name="yaml", suffixes=(".yml", ".yaml"), extract=None, is_code=False),
    Language(name="json", suffixes=(".json",), extract=None, is_code=False),
    Language(name="markdown", suffixes=(".md",), extract=None, is_code=False),
)

LANGUAGE_BY_SUFFIX: dict[str, Language] = {
    suffix: language for language in LANGUAGES for suffix in language.suffixes
}

CODE_LANGUAGES: frozenset[str] = frozenset(
    language.name for language in LANGUAGES if language.is_code
)

BUILD_OUTPUT_DIRS: frozenset[str] = frozenset(
    directory for language in LANGUAGES for directory in language.excluded_dirs
)


def extract(suffix: str, text: str, filename: str) -> Extraction:
    """Extract facts from `text` using the handler for `suffix`."""
    language = LANGUAGE_BY_SUFFIX.get(suffix)
    if language is None or language.extract is None:
        return Extraction()
    return language.extract(text, filename)
