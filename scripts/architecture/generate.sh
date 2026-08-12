#!/usr/bin/env sh
#
# KAAF architecture generator — thin wrapper around generate.py.
#
# Usage:
#   ./scripts/architecture/generate.sh            regenerate .ai/
#   ./scripts/architecture/generate.sh --check    verify .ai/ is current
#
# Requires python3 (3.11+, standard library only). See
# scripts/architecture/README.md.

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

if ! command -v python3 >/dev/null 2>&1; then
  echo "error: python3 is required to run the KAAF generator" >&2
  exit 1
fi

exec python3 "$SCRIPT_DIR/generate.py" "$@"
