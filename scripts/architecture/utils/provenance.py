"""Provenance markers for generated artifacts.

Every generated file states that it is generated, which generator version
produced it, and which inputs it came from (docs/kaaf/GOVERNANCE.md §6).

Deliberately absent: wall-clock time and commit SHA. Both would change output
for unchanged inputs and break the regenerate-and-diff check that keeps `.ai/`
honest. `inputDigest` identifies the inputs instead; git history supplies the
commit and the time for any generated file.
"""

GENERATOR_NAME = "kaaf"
GENERATOR_VERSION = "0.7.0"
SCHEMA_VERSION = "1.0.0"

MARKDOWN_MARKER = (
    "<!-- KAAF-GENERATED — do not edit by hand. "
    "Regenerate with scripts/architecture/generate.sh. -->"
)

CONFIDENCE_LEVELS = ("verified", "derived", "documented", "assumed", "unknown")


def meta(input_digest: str, artifact: str, confidence: str = "derived") -> dict:
    """Build the `_meta` provenance block for a generated JSON artifact.

    `bodyDigest` is filled in by `finalize()` once the document is complete.
    """
    if confidence not in CONFIDENCE_LEVELS:
        raise ValueError(f"unknown confidence level: {confidence}")
    return {
        "artifact": artifact,
        "bodyDigest": "",
        "confidence": confidence,
        "doNotEdit": True,
        "generator": GENERATOR_NAME,
        "generatorVersion": GENERATOR_VERSION,
        "inputDigest": input_digest,
        "provenanceNote": (
            "Generated from the declared kaaf.repo.json and kaaf.module.json manifests. "
            "No wall-clock time or commit SHA is embedded: both would break byte-identical "
            "regeneration. Use git history for when and from which commit."
        ),
        "schemaVersion": SCHEMA_VERSION,
    }


MARKDOWN_DIGEST_PREFIX = "<!-- kaaf:bodyDigest="


def markdown_body_digest(content: str) -> str:
    """SHA-256 over Markdown content, excluding its own digest line.

    The Markdown equivalent of `body_digest`: it gives generated Markdown the
    same independently checkable integrity that `_meta.bodyDigest` gives
    generated JSON, so both validators catch a hand-edit without regenerating.
    """
    from .jsonio import digest

    body = [line for line in content.splitlines() if not line.startswith(MARKDOWN_DIGEST_PREFIX)]
    return digest({"body": "\n".join(body)})


def stamp_markdown(content: str) -> str:
    """Append the body-digest comment to generated Markdown."""
    stripped = "\n".join(
        line for line in content.splitlines() if not line.startswith(MARKDOWN_DIGEST_PREFIX)
    )
    if not stripped.endswith("\n"):
        stripped += "\n"
    return f"{stripped}{MARKDOWN_DIGEST_PREFIX}{markdown_body_digest(stripped)} -->\n"


def read_markdown_digest(content: str) -> str | None:
    """The recorded digest of generated Markdown, or None if absent."""
    for line in content.splitlines():
        if line.startswith(MARKDOWN_DIGEST_PREFIX):
            return line[len(MARKDOWN_DIGEST_PREFIX):].removesuffix(" -->").strip()
    return None


def body_digest(document: dict) -> str:
    """SHA-256 over the document's content, excluding `_meta` itself.

    This is what makes the two gates independent. `inputDigest` says which
    manifests produced the artifact; `bodyDigest` says the content still matches
    what the generator wrote. A hand-edit that leaves `_meta` untouched changes
    the body and is caught here, without regenerating anything.
    """
    from .jsonio import digest  # local import: jsonio imports errors, not provenance

    return digest({key: value for key, value in document.items() if key != "_meta"})


def finalize(document: dict) -> dict:
    """Stamp `_meta.bodyDigest`. Call once, after the document is complete."""
    document["_meta"]["bodyDigest"] = body_digest(document)
    return document
