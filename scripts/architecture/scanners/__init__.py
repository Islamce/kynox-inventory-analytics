"""Scanners: read the repository and emit normalized facts.

A scanner reads and validates. It never interprets intent and never writes to
`.ai/` — see scripts/architecture/README.md.

Phase 2 reads declared manifests (the input of record). Phase 3 adds scanners
that discover structure from source and report drift against what is declared.
"""
