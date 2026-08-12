"""Import resolution — specifier in, repository path out.

Extraction (`languages.py`) is local and textual. Resolution is global: turning
`'./thing'`, `'@/lib/db'` or `'package:wms/api.dart'` into a repository-relative
path needs to know how the repository is laid out.

A `Resolver` reads that layout once — TypeScript path aliases, workspace package
names, declared entry points, Dart package names — and answers every subsequent
question from memory. It never guesses: a specifier it cannot resolve to a file
inside the repository returns `None`, which is the correct answer for a
third-party dependency and an honest one for anything else.
"""

import json
import re
from dataclasses import dataclass, field
from pathlib import Path

from utils.paths import EXCLUDED_DIR_NAMES, rel

# Tried in order when a specifier omits its extension. `.d.ts` last: a hand-written
# declaration file is a weaker match than the implementation it describes.
TS_EXTENSIONS = (".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".d.ts")
TS_INDEX_FILES = tuple(f"index{suffix}" for suffix in TS_EXTENSIONS)

# `import './x.js'` in a TypeScript project usually means `./x.ts` — the ESM
# convention is to write the emitted extension.
_JS_TO_TS = {".js": (".ts", ".tsx"), ".mjs": (".mts",), ".cjs": (".cts",)}

_TRAILING_COMMA = re.compile(r",(\s*[}\]])")

_PUBSPEC_NAME = re.compile(r"^name:\s*['\"]?([A-Za-z_][\w]*)['\"]?\s*$", re.MULTILINE)


def strip_jsonc_comments(text: str) -> str:
    """Remove // and /* */ comments, leaving string literals untouched.

    A regex cannot do this. `"include": ["**/*.ts", "**/*.tsx"]` — the shape every
    Next.js `tsconfig.json` has — contains `/*` inside one glob and `*/` inside
    the next, so a naive block-comment pattern eats the text between them and
    produces invalid JSON. This walks the text instead, tracking whether it is
    inside a string and honouring backslash escapes.
    """
    out: list[str] = []
    index = 0
    length = len(text)
    in_string = False

    while index < length:
        character = text[index]

        if in_string:
            out.append(character)
            if character == "\\" and index + 1 < length:
                out.append(text[index + 1])
                index += 2
                continue
            if character == '"':
                in_string = False
            index += 1
            continue

        if character == '"':
            in_string = True
            out.append(character)
            index += 1
            continue

        if character == "/" and index + 1 < length:
            following = text[index + 1]
            if following == "/":
                index = text.find("\n", index)
                if index == -1:
                    break
                continue
            if following == "*":
                end = text.find("*/", index + 2)
                index = length if end == -1 else end + 2
                continue

        out.append(character)
        index += 1

    return "".join(out)


def read_jsonc(path: Path):
    """Parse JSON that may carry comments and trailing commas.

    `tsconfig.json` is JSON-with-comments by convention and `json.loads` rejects
    it. A malformed file yields None rather than failing the scan — a repository
    with one broken config should still be describable.
    """
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
    cleaned = _TRAILING_COMMA.sub(r"\1", strip_jsonc_comments(text))
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        return None


@dataclass(frozen=True)
class Alias:
    """One `tsconfig.json` path mapping, e.g. `@/*` → `./*`."""

    prefix: str
    suffix: str
    targets: tuple[str, ...]
    base: Path

    @property
    def specificity(self) -> int:
        return len(self.prefix) + len(self.suffix)


@dataclass
class Resolver:
    """Everything needed to turn an import specifier into a repository path."""

    root: Path
    aliases: list[Alias] = field(default_factory=list)
    workspace_packages: dict[str, Path] = field(default_factory=dict)
    dart_packages: dict[str, Path] = field(default_factory=dict)
    declared_entry_points: set[str] = field(default_factory=set)

    # ---------------------------------------------------------------- loading

    @classmethod
    def load(cls, root: Path) -> "Resolver":
        root = Path(root).resolve()
        resolver = cls(root=root)
        for path in _walk_config_files(root):
            name = path.name
            if name.startswith("tsconfig") and name.endswith(".json"):
                resolver._load_tsconfig(path)
            elif name == "package.json":
                resolver._load_package_json(path)
            elif name == "pubspec.yaml":
                resolver._load_pubspec(path)

        # Longest alias wins, so `@/lib/*` beats `@/*`.
        resolver.aliases.sort(key=lambda alias: (-alias.specificity, alias.prefix))
        return resolver

    def _load_tsconfig(self, path: Path) -> None:
        config = read_jsonc(path)
        if not isinstance(config, dict):
            return
        options = config.get("compilerOptions")
        if not isinstance(options, dict):
            return
        paths = options.get("paths")
        if not isinstance(paths, dict):
            return

        base = path.parent
        base_url = options.get("baseUrl")
        if isinstance(base_url, str):
            base = (path.parent / base_url).resolve()

        for pattern, targets in sorted(paths.items()):
            if not isinstance(targets, list):
                continue
            prefix, _, suffix = str(pattern).partition("*")
            self.aliases.append(
                Alias(
                    prefix=prefix,
                    suffix=suffix,
                    targets=tuple(str(target) for target in targets),
                    base=base,
                )
            )

    def _load_package_json(self, path: Path) -> None:
        package = read_jsonc(path)
        if not isinstance(package, dict):
            return

        name = package.get("name")
        if isinstance(name, str) and name:
            self.workspace_packages.setdefault(name, path.parent)

        # `main` and `bin` name the files the outside world executes or imports —
        # the JavaScript equivalent of a `__main__` guard.
        for value in _entry_point_candidates(package):
            candidate = (path.parent / value).resolve()
            resolved = _first_existing_file(candidate)
            if resolved is not None:
                try:
                    self.declared_entry_points.add(rel(resolved, self.root))
                except ValueError:
                    pass

    def _load_pubspec(self, path: Path) -> None:
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return
        match = _PUBSPEC_NAME.search(text)
        if match:
            self.dart_packages.setdefault(match.group(1), path.parent / "lib")

    # ------------------------------------------------------------- resolution

    def resolve(self, language: str, specifier: str, source_path: Path) -> str | None:
        if language == "python":
            return self._resolve_python(specifier, source_path)
        if language in ("typescript", "javascript"):
            return self._resolve_typescript(specifier, source_path)
        if language == "dart":
            return self._resolve_dart(specifier, source_path)
        return None

    # Python ----------------------------------------------------------------

    def _resolve_python(self, name: str, source_path: Path) -> str | None:
        if name.startswith("."):
            depth = len(name) - len(name.lstrip("."))
            remainder = name.lstrip(".")
            base = source_path.parent
            for _ in range(depth - 1):
                base = base.parent
            search_roots = [base]
            parts = remainder.split(".") if remainder else []
        else:
            parts = name.split(".")
            search_roots = []
            current = source_path.parent
            while True:
                search_roots.append(current)
                if current == self.root:
                    break
                current = current.parent

        for search_root in search_roots:
            if not parts:
                candidate = search_root / "__init__.py"
                if candidate.is_file():
                    return self._relative(candidate)
                continue
            base = search_root.joinpath(*parts)
            for candidate in (base.with_suffix(".py"), base / "__init__.py"):
                if candidate.is_file():
                    return self._relative(candidate)
        return None

    # TypeScript / JavaScript -----------------------------------------------

    def _resolve_typescript(self, specifier: str, source_path: Path) -> str | None:
        if specifier.startswith("."):
            return self._relative(_resolve_ts_path(source_path.parent / specifier))

        for alias in self.aliases:
            if not specifier.startswith(alias.prefix):
                continue
            remainder = specifier[len(alias.prefix):]
            if alias.suffix and not remainder.endswith(alias.suffix):
                continue
            if alias.suffix:
                remainder = remainder[: -len(alias.suffix)]
            for target in alias.targets:
                candidate = alias.base / target.replace("*", remainder)
                resolved = _resolve_ts_path(candidate)
                if resolved is not None:
                    return self._relative(resolved)

        # Workspace package: `@kynox/shared-types` or `@kynox/shared-types/x`.
        for name in sorted(self.workspace_packages, key=len, reverse=True):
            if specifier == name or specifier.startswith(name + "/"):
                directory = self.workspace_packages[name]
                remainder = specifier[len(name):].lstrip("/")
                candidate = directory / remainder if remainder else directory
                resolved = _resolve_ts_path(candidate)
                if resolved is None and not remainder:
                    resolved = _resolve_ts_path(directory / "src")
                if resolved is not None:
                    return self._relative(resolved)

        return None  # third-party

    # Dart -------------------------------------------------------------------

    def _resolve_dart(self, specifier: str, source_path: Path) -> str | None:
        if specifier.startswith("package:"):
            remainder = specifier[len("package:"):]
            name, _, path = remainder.partition("/")
            library = self.dart_packages.get(name)
            if library is None or not path:
                return None
            candidate = library / path
            return self._relative(candidate if candidate.is_file() else None)

        if specifier.startswith("dart:"):
            return None  # standard library

        candidate = (source_path.parent / specifier).resolve()
        return self._relative(candidate if candidate.is_file() else None)

    # ------------------------------------------------------------------ util

    def _relative(self, path: Path | None) -> str | None:
        if path is None:
            return None
        try:
            return rel(path, self.root)
        except ValueError:
            return None  # outside the repository


def _entry_point_candidates(package: dict) -> list[str]:
    values: list[str] = []
    main = package.get("main")
    if isinstance(main, str):
        values.append(main)
    binaries = package.get("bin")
    if isinstance(binaries, str):
        values.append(binaries)
    elif isinstance(binaries, dict):
        values.extend(value for value in binaries.values() if isinstance(value, str))
    return values


def _first_existing_file(candidate: Path) -> Path | None:
    if candidate.is_file():
        return candidate
    return _resolve_ts_path(candidate)


def _resolve_ts_path(candidate: Path) -> Path | None:
    """Apply Node/TypeScript resolution to a path that may omit its extension."""
    try:
        candidate = candidate.resolve()
    except OSError:
        return None

    if candidate.is_file():
        return candidate

    # `./x.js` in a TypeScript project usually means `./x.ts`.
    replacements = _JS_TO_TS.get(candidate.suffix)
    if replacements:
        for suffix in replacements:
            alternative = candidate.with_suffix(suffix)
            if alternative.is_file():
                return alternative

    for suffix in TS_EXTENSIONS:
        alternative = candidate.with_name(candidate.name + suffix)
        if alternative.is_file():
            return alternative

    if candidate.is_dir():
        for index in TS_INDEX_FILES:
            alternative = candidate / index
            if alternative.is_file():
                return alternative

    return None


def _walk_config_files(root: Path):
    """Configuration files that describe repository layout, deterministically ordered."""
    found: list[Path] = []
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
            elif entry.name == "package.json" or entry.name == "pubspec.yaml" or (
                entry.name.startswith("tsconfig") and entry.name.endswith(".json")
            ):
                found.append(entry)
    return sorted(found, key=lambda path: path.as_posix())
