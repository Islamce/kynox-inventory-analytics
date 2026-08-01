#!/usr/bin/env python3
"""Report drift between declared structure and discovered source.

Prints every finding, and fails only on `error` severity. Warnings and
information are reported without blocking, which is the point: drift must be
*visible*, but code that has outrun its manifest should not stop a build while
someone writes the manifest.

Usage: validate_drift.py [--root DIR] [--strict]
Exit codes: 0 no errors, 1 one or more errors (or any finding with --strict).
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scanners.facts import gather  # noqa: E402
from utils.errors import KaafError  # noqa: E402
from utils.paths import repo_root  # noqa: E402

SEVERITY_LABEL = {"error": "ERROR", "warning": "WARN ", "info": "info "}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Report declared-versus-discovered drift.")
    parser.add_argument("--root", default=None, help="repository root to scan")
    parser.add_argument(
        "--strict",
        action="store_true",
        help="fail on any finding, not just errors",
    )
    args = parser.parse_args(argv)

    root = Path(args.root).resolve() if args.root else repo_root()

    try:
        facts = gather(root)
    except KaafError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1

    report = facts.drift
    counts = report["counts"]
    findings = report["findings"]

    print("KAAF drift report — declared versus discovered")
    print(f"  declared modules:   {len(report['declaredModules'])}")
    print(f"  discovered modules: {len(report['discoveredModules'])}")
    print(f"  discovered import edges: {len(report['discoveredImportEdges'])}")
    print()

    if not findings:
        print("No drift: every declaration matches what discovery found in the source.")
        return 0

    for finding in findings:
        label = SEVERITY_LABEL.get(finding["severity"], finding["severity"])
        print(f"  {label} [{finding['type']}] {finding['module']}")
        print(f"        {finding['summary']}")
        for evidence in finding["evidence"]:
            print(f"        evidence: {evidence}")
        print(f"        fix: {finding['recommendation']}")
        print()

    print(
        f"{counts['error']} error, {counts['warning']} warning, {counts['info']} info"
    )

    if counts["error"]:
        print(
            "\nerror: declared structure and discovered source disagree.\n"
            "Update the affected kaaf.module.json, or change the code "
            "(docs/kaaf/STANDARDS.md §1).",
            file=sys.stderr,
        )
        return 1

    if args.strict and findings:
        print("\nerror: --strict, and drift findings are present.", file=sys.stderr)
        return 1

    print("No blocking drift.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
