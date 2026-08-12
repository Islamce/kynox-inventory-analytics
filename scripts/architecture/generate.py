#!/usr/bin/env python3
"""KAAF architecture generator — Phase 2 entry point.

Reads the declared manifests and writes the deterministic AI context under
`.ai/`. Two runs over the same inputs produce byte-identical output, which is
what lets CI regenerate and diff to prove `.ai/` is neither stale nor
hand-edited (docs/kaaf/GOVERNANCE.md §7-8).

Usage:
    generate.py                 write .ai/
    generate.py --check         write nothing; exit 1 if .ai/ is not current
    generate.py --output-dir D  write to D instead of .ai/

Exit codes: 0 current/written, 1 stale or invalid input.
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from generators import architecture as architecture_generator  # noqa: E402
from generators import context as context_generator  # noqa: E402
from generators import diagrams as diagrams_generator  # noqa: E402
from generators import drift as drift_generator  # noqa: E402
from generators import index as index_generator  # noqa: E402
from generators import modules as modules_generator  # noqa: E402
from generators import summary as summary_generator  # noqa: E402
from scanners.facts import gather  # noqa: E402
from utils.errors import E_OUTPUT_STALE, KaafError  # noqa: E402
from utils.jsonio import canonical_dumps, write_text  # noqa: E402
from utils.paths import repo_root  # noqa: E402
from utils.provenance import finalize, stamp_markdown  # noqa: E402

DEFAULT_OUTPUT_DIR = ".ai"

# Never removed when pruning: these are hand-written and owned by humans.
PRESERVED = frozenset({"README.md", ".gitkeep"})


def build_artifacts(root: Path) -> dict[str, str]:
    """Return {relative path under the output dir: file content}."""
    facts = gather(root)

    artifacts: dict[str, str] = {
        "ai-context.json": canonical_dumps(finalize(context_generator.build(facts))),
        "architecture.json": canonical_dumps(finalize(architecture_generator.build(facts))),
        "drift.json": canonical_dumps(finalize(drift_generator.build(facts))),
        "index/repository.json": canonical_dumps(finalize(index_generator.build(facts))),
        "summary.md": stamp_markdown(summary_generator.build(facts)),
    }
    for relative_path, document in modules_generator.build(facts).items():
        artifacts[relative_path] = canonical_dumps(finalize(document))

    for relative_path, content in diagrams_generator.build(facts).items():
        artifacts[relative_path] = stamp_markdown(content)

    return dict(sorted(artifacts.items()))


def _existing_generated_files(output_dir: Path) -> set[str]:
    if not output_dir.exists():
        return set()
    found = set()
    for path in output_dir.rglob("*"):
        if path.is_file() and path.name not in PRESERVED:
            found.add(path.relative_to(output_dir).as_posix())
    return found


def write(output_dir: Path, artifacts: dict[str, str]) -> list[str]:
    """Write artifacts and prune stale generated files. Returns changed paths."""
    changed: list[str] = []

    for relative_path, content in artifacts.items():
        if write_text(output_dir / relative_path, content):
            changed.append(relative_path)

    for stale in sorted(_existing_generated_files(output_dir) - set(artifacts)):
        (output_dir / stale).unlink()
        changed.append(f"{stale} (removed)")

    return sorted(changed)


def check(output_dir: Path, artifacts: dict[str, str]) -> list[str]:
    """Return the differences between `artifacts` and what is on disk."""
    differences: list[str] = []

    for relative_path, content in artifacts.items():
        target = output_dir / relative_path
        if not target.exists():
            differences.append(f"missing: {relative_path}")
        elif target.read_text(encoding="utf-8") != content:
            differences.append(f"out of date or hand-edited: {relative_path}")

    for extra in sorted(_existing_generated_files(output_dir) - set(artifacts)):
        differences.append(f"not produced by the generator: {extra}")

    return differences


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate the KAAF AI context under .ai/.")
    parser.add_argument(
        "--check",
        action="store_true",
        help="write nothing; exit 1 if the generated context is stale or hand-edited",
    )
    parser.add_argument(
        "--output-dir",
        default=None,
        help=f"output directory (default: {DEFAULT_OUTPUT_DIR} in the repository root)",
    )
    parser.add_argument(
        "--root",
        default=None,
        help="repository root to scan (default: the repository containing this script)",
    )
    args = parser.parse_args(argv)

    root = Path(args.root).resolve() if args.root else repo_root()
    output_dir = Path(args.output_dir) if args.output_dir else root / DEFAULT_OUTPUT_DIR

    try:
        artifacts = build_artifacts(root)
    except KaafError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1

    if args.check:
        differences = check(output_dir, artifacts)
        if differences:
            print(f"error: {E_OUTPUT_STALE}: generated context does not match the manifests", file=sys.stderr)
            for difference in differences:
                print(f"  - {difference}", file=sys.stderr)
            print(
                "\nRun ./scripts/architecture/generate.sh and commit the result.\n"
                "Do not hand-edit files under .ai/ (docs/kaaf/GOVERNANCE.md §6).",
                file=sys.stderr,
            )
            return 1
        print(f"generated context is current ({len(artifacts)} artifacts)")
        return 0

    changed = write(output_dir, artifacts)
    if changed:
        print(f"wrote {len(artifacts)} artifacts; {len(changed)} changed:")
        for path in changed:
            print(f"  - {path}")
    else:
        print(f"generated context already current ({len(artifacts)} artifacts)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
