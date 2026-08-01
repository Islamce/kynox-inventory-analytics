#!/usr/bin/env python3
"""Validate the published index against the enterprise index schema.

The index is what other repositories consume, so it is the one artifact whose
shape is a promise to people outside this repository. This validates it
independently of how it was generated — the same check a consumer would run
before trusting an index it was handed.

Usage: validate_index.py [--root DIR] [--index PATH]
Exit codes: 0 valid, 1 invalid or missing.
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from utils.index_schema import INDEX_SCHEMA_VERSION, validate  # noqa: E402
from utils.paths import repo_root  # noqa: E402

DEFAULT_INDEX = ".ai/index/repository.json"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Validate the published KAAF index.")
    parser.add_argument("--root", default=None, help="repository root")
    parser.add_argument("--index", default=None, help="path to the index file")
    args = parser.parse_args(argv)

    root = Path(args.root).resolve() if args.root else repo_root()
    path = Path(args.index) if args.index else root / DEFAULT_INDEX

    if not path.exists():
        print(f"error: index not found: {path}", file=sys.stderr)
        print("Run ./scripts/architecture/generate.sh to produce it.", file=sys.stderr)
        return 1

    try:
        index = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        print(f"error: index is not valid JSON: {error.msg}", file=sys.stderr)
        return 1

    errors = validate(index, source=path.name)
    if errors:
        print(f"error: index does not satisfy schema {INDEX_SCHEMA_VERSION}", file=sys.stderr)
        for problem in errors:
            print(f"  - {problem}", file=sys.stderr)
        return 1

    repository = index["repository"]["repository"]
    health = index["health"]
    print(f"index valid against schema {INDEX_SCHEMA_VERSION}")
    print(f"  repository:          {repository}")
    print(f"  modules:             {health.get('moduleCount')}")
    print(f"  apis:                {len(index.get('apis', []))}")
    print(f"  permissions:         {len(index.get('permissions', []))}")
    print(f"  ownership coverage:  {health.get('ownershipCoverage')}")
    if health.get("modulesWithoutOwner"):
        print(f"  unowned modules:     {', '.join(health['modulesWithoutOwner'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
