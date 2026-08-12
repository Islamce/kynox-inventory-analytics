"""Error types and codes for the KAAF tooling.

Codes are part of the tooling's public contract (see scripts/architecture/
kaaf.module.json) and are stable: a code's meaning never changes, new
conditions get new codes.
"""


class KaafError(Exception):
    """A KAAF tooling failure with a stable, machine-readable code."""

    def __init__(self, code: str, message: str, evidence: str | None = None):
        self.code = code
        self.message = message
        self.evidence = evidence
        super().__init__(str(self))

    def __str__(self) -> str:
        if self.evidence:
            return f"{self.code}: {self.message} ({self.evidence})"
        return f"{self.code}: {self.message}"


# Manifest / scanning
E_MANIFEST_INVALID = "KAAF-E001-manifest-invalid"
E_DUPLICATE_ID = "KAAF-E002-duplicate-module-id"
E_UNKNOWN_DEPENDENCY = "KAAF-E003-unknown-dependency"
E_DEPENDENCY_CYCLE = "KAAF-E004-dependency-cycle"
E_MISSING_ENTRY_POINT = "KAAF-E005-missing-entry-point"

# Generated output
E_OUTPUT_STALE = "KAAF-E006-generated-output-stale"
E_PROVENANCE_MISSING = "KAAF-E007-provenance-missing"
E_HAND_EDITED = "KAAF-E008-hand-edited-output"
