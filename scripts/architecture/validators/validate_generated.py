#!/usr/bin/env python3
"""Validate the generated AI context under `.ai/`.

Independent of the generator's own `--check`: this verifies the *shape* of what
is on disk — required artifacts, provenance, confidence levels, and that the
recorded input digest matches the manifests. A hand-edit that removes the
provenance marker fails here even if someone regenerated afterwards.

Usage: validate_generated.py [--output-dir DIR]
Exit codes: 0 valid, 1 invalid or stale.
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from generators import diagrams as diagrams_generator  # noqa: E402
from scanners.facts import gather  # noqa: E402
from utils.errors import (  # noqa: E402
    E_HAND_EDITED,
    E_OUTPUT_STALE,
    E_PROVENANCE_MISSING,
    KaafError,
)
from utils.paths import repo_root  # noqa: E402
from utils.provenance import (  # noqa: E402
    CONFIDENCE_LEVELS,
    GENERATOR_NAME,
    GENERATOR_VERSION,
    MARKDOWN_MARKER,
    SCHEMA_VERSION,
    body_digest,
    markdown_body_digest,
    read_markdown_digest,
)

REQUIRED_JSON_ARTIFACTS = (
    "ai-context.json",
    "architecture.json",
    "drift.json",
    "index/repository.json",
)
REQUIRED_MARKDOWN_ARTIFACTS = ("summary.md",)
REQUIRED_META_FIELDS = (
    "artifact",
    "bodyDigest",
    "confidence",
    "doNotEdit",
    "generator",
    "generatorVersion",
    "inputDigest",
    "schemaVersion",
)

failures: list[str] = []


def fail(code: str, message: str, evidence: str) -> None:
    failures.append(f"{code}: {message} ({evidence})")


def validate_meta(document: dict, relative_path: str, expected_digest: str) -> None:
    meta = document.get("_meta")
    if not isinstance(meta, dict):
        fail(E_PROVENANCE_MISSING, "missing _meta provenance block", relative_path)
        return

    for field in REQUIRED_META_FIELDS:
        if field not in meta:
            fail(E_PROVENANCE_MISSING, f"_meta is missing '{field}'", relative_path)

    if meta.get("generator") != GENERATOR_NAME:
        fail(E_HAND_EDITED, f"_meta.generator is not '{GENERATOR_NAME}'", relative_path)
    if meta.get("doNotEdit") is not True:
        fail(E_HAND_EDITED, "_meta.doNotEdit must be true", relative_path)
    if meta.get("generatorVersion") != GENERATOR_VERSION:
        fail(
            E_OUTPUT_STALE,
            f"produced by generator {meta.get('generatorVersion')}, current is {GENERATOR_VERSION}",
            relative_path,
        )
    if meta.get("schemaVersion") != SCHEMA_VERSION:
        fail(
            E_OUTPUT_STALE,
            f"schema {meta.get('schemaVersion')}, current is {SCHEMA_VERSION}",
            relative_path,
        )
    if meta.get("confidence") not in CONFIDENCE_LEVELS:
        fail(E_HAND_EDITED, f"invalid confidence {meta.get('confidence')!r}", relative_path)
    if meta.get("inputDigest") != expected_digest:
        fail(
            E_OUTPUT_STALE,
            "inputDigest does not match the current manifests",
            relative_path,
        )

    # Independent of the manifests: does the body still match what the generator
    # wrote? Catches a hand-edit that leaves _meta untouched.
    if meta.get("bodyDigest") != body_digest(document):
        fail(
            E_HAND_EDITED,
            "content does not match _meta.bodyDigest — the file was edited after generation",
            relative_path,
        )

    if meta.get("artifact") != relative_path:
        fail(E_HAND_EDITED, f"_meta.artifact says {meta.get('artifact')!r}", relative_path)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Validate the generated KAAF AI context.")
    parser.add_argument("--output-dir", default=None)
    parser.add_argument(
        "--root",
        default=None,
        help="repository root to scan (default: the repository containing this script)",
    )
    args = parser.parse_args(argv)

    root = Path(args.root).resolve() if args.root else repo_root()
    output_dir = Path(args.output_dir) if args.output_dir else root / ".ai"

    try:
        facts = gather(root)
    except KaafError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1

    # The digest must be computed the same way the generator computes it —
    # manifests *and* source. Using the manifest-only digest here would call
    # output current after a source change that changed what was generated.
    expected_digest = facts.input_digest
    expected_module_files = {
        f"modules/{found.id}.json" for found in facts.discovery.modules
    } | {f"modules/{module.id}.json" for module in facts.modules}

    for name in REQUIRED_JSON_ARTIFACTS + tuple(sorted(expected_module_files)):
        path = output_dir / name
        if not path.exists():
            fail(E_OUTPUT_STALE, "required generated artifact is missing", name)
            continue
        try:
            document = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as error:
            fail(E_HAND_EDITED, f"not valid JSON: {error.msg}", name)
            continue
        validate_meta(document, name, expected_digest)

    # Diagrams carry no _meta (they are Markdown), so the marker is their
    # provenance and the expected set is their freshness check.
    expected_diagrams = set(diagrams_generator.build(facts))

    for name in REQUIRED_MARKDOWN_ARTIFACTS + tuple(sorted(expected_diagrams)):
        path = output_dir / name
        if not path.exists():
            fail(E_OUTPUT_STALE, "required generated artifact is missing", name)
            continue

        content = path.read_text(encoding="utf-8")
        if MARKDOWN_MARKER not in content:
            fail(E_PROVENANCE_MISSING, "missing the KAAF-GENERATED marker", name)

        # Markdown carries no _meta, so its integrity rides on a digest comment —
        # the same independent hand-edit detection the JSON artifacts get.
        recorded = read_markdown_digest(content)
        if recorded is None:
            fail(E_PROVENANCE_MISSING, "missing the body-digest comment", name)
        elif recorded != markdown_body_digest(content):
            fail(
                E_HAND_EDITED,
                "content does not match its recorded body digest — edited after generation",
                name,
            )

    diagrams_dir = output_dir / "diagrams"
    if diagrams_dir.is_dir():
        for path in sorted(diagrams_dir.rglob("*")):
            if not path.is_file():
                continue
            relative = path.relative_to(output_dir).as_posix()
            if relative not in expected_diagrams:
                fail(E_HAND_EDITED, "no generator produces this diagram", relative)

    modules_dir = output_dir / "modules"
    if modules_dir.is_dir():
        for path in sorted(modules_dir.glob("*.json")):
            relative = path.relative_to(output_dir).as_posix()
            if relative not in expected_module_files:
                fail(E_HAND_EDITED, "no module manifest produces this file", relative)

    if failures:
        print("error: generated context validation FAILED", file=sys.stderr)
        for failure in failures:
            print(f"  - {failure}", file=sys.stderr)
        print(
            "\nRun ./scripts/architecture/generate.sh and commit the result.\n"
            "Files under .ai/ are generated and must never be hand-edited "
            "(docs/kaaf/GOVERNANCE.md §6).",
            file=sys.stderr,
        )
        return 1

    checked = (
        len(REQUIRED_JSON_ARTIFACTS)
        + len(REQUIRED_MARKDOWN_ARTIFACTS)
        + len(expected_module_files)
        + len(expected_diagrams)
    )
    print(f"generated context validation passed ({checked} artifacts).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
