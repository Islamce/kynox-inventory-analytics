"""Deterministic JSON serialisation.

One canonical form, used for every generated artifact and for the input digest:
sorted keys, two-space indent, UTF-8 preserved, exactly one trailing newline.
Two runs over the same inputs therefore produce byte-identical files
(docs/kaaf/STANDARDS.md §8).
"""

import hashlib
import json
from pathlib import Path

from .errors import E_MANIFEST_INVALID, KaafError


def canonical_dumps(payload) -> str:
    """Serialise `payload` in KAAF canonical JSON form."""
    return json.dumps(payload, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def read_json(path: Path):
    """Load JSON, raising a KaafError with the offending path on failure."""
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise KaafError(E_MANIFEST_INVALID, "manifest not found", str(path)) from exc
    except json.JSONDecodeError as exc:
        raise KaafError(
            E_MANIFEST_INVALID, f"manifest is not valid JSON: {exc.msg}", f"{path}:{exc.lineno}"
        ) from exc


def digest(payload) -> str:
    """Stable SHA-256 over the canonical form of `payload`.

    Used as the provenance `inputDigest`: it identifies exactly which inputs
    produced an artifact, without embedding a wall-clock time or commit SHA
    (either of which would break byte-identical regeneration).
    """
    return hashlib.sha256(canonical_dumps(payload).encode("utf-8")).hexdigest()


def write_text(path: Path, content: str) -> bool:
    """Write `content` to `path`. Returns True if the file changed on disk."""
    path = Path(path)
    if path.exists() and path.read_text(encoding="utf-8") == content:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return True
