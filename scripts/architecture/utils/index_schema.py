"""The KAAF enterprise index schema.

The index is the **publishable** subset of a repository's architecture: a
stable, versioned document other repositories and the central catalogue can
consume without knowing anything about how KAAF generates it.

`architecture.json` serves agents working *inside* one repository and may change
shape as KAAF evolves. The index serves consumers *outside* it, so its schema is
versioned independently and evolves under an explicit compatibility rule:

    MAJOR — a consumer written for the old version breaks. Requires a migration.
    MINOR — additive; old consumers keep working and ignore what they don't know.
    PATCH — clarification only, no shape change.

An aggregator MUST accept any index whose MAJOR matches and whose MINOR is less
than or equal to its own, and MUST reject a higher MAJOR rather than guess.

Validation is hand-written against this definition rather than delegated to a
JSON Schema library: the tooling is standard library only (docs/kaaf/STANDARDS.md
§4), and a schema nobody can validate offline is not a contract.
"""

INDEX_SCHEMA_VERSION = "1.1.0"

# (field, type, required)
_REPOSITORY_FIELDS = (
    ("repository", str, True),
    ("name", str, True),
    ("description", str, False),
    ("defaultBranch", str, False),
    ("kaafPhase", int, False),
)

_MODULE_FIELDS = (
    ("id", str, True),
    ("path", str, True),
    ("purpose", str, True),
    ("owner", str, True),
    ("confidence", str, True),
    ("declared", bool, True),
    ("dependsOn", list, True),
    ("ownedEntities", list, False),
    # 1.1.0, additive: what this module consumes from other repositories.
    # Optional, so a 1.0.0 index remains valid.
    ("consumes", list, False),
)

_CONSUMES_FIELDS = (
    ("repository", str, True),
    ("module", str, True),
    ("contract", str, True),
    ("kind", str, False),
    ("version", str, False),
)

_API_FIELDS = (
    ("id", str, True),
    ("module", str, True),
    ("kind", str, True),
    ("version", str, False),
    ("path", str, False),
    ("stability", str, False),
    ("confidence", str, False),
)

_PERMISSION_FIELDS = (
    ("key", str, True),
    ("module", str, True),
    ("roles", list, False),
    ("confidence", str, False),
)

_INTEGRATION_FIELDS = (
    ("name", str, True),
    ("module", str, True),
    ("kind", str, False),
    ("criticality", str, False),
)

CONFIDENCE_LEVELS = ("verified", "derived", "documented", "assumed", "unknown")


def _check_fields(entry, fields, where: str, errors: list[str]) -> None:
    if not isinstance(entry, dict):
        errors.append(f"{where}: expected an object, got {type(entry).__name__}")
        return
    for name, expected_type, required in fields:
        if name not in entry:
            if required:
                errors.append(f"{where}: missing required field '{name}'")
            continue
        value = entry[name]
        # bool is a subclass of int; an int field must not accept True.
        if expected_type is int and isinstance(value, bool):
            errors.append(f"{where}.{name}: expected int, got bool")
        elif not isinstance(value, expected_type):
            errors.append(
                f"{where}.{name}: expected {expected_type.__name__}, "
                f"got {type(value).__name__}"
            )


def _check_confidence(entry: dict, where: str, errors: list[str]) -> None:
    level = entry.get("confidence")
    if level is not None and level not in CONFIDENCE_LEVELS:
        errors.append(f"{where}.confidence: '{level}' is not a KAAF confidence level")


def compatible(schema_version: str, consumer_version: str = INDEX_SCHEMA_VERSION) -> bool:
    """Can a consumer at `consumer_version` read an index at `schema_version`?

    Same MAJOR, and the index's MINOR no higher than the consumer's. A newer
    MAJOR is rejected rather than guessed at.
    """
    try:
        index_parts = [int(part) for part in str(schema_version).split(".")]
        consumer_parts = [int(part) for part in str(consumer_version).split(".")]
    except (TypeError, ValueError):
        return False
    if len(index_parts) != 3 or len(consumer_parts) != 3:
        return False
    if index_parts[0] != consumer_parts[0]:
        return False
    return index_parts[1] <= consumer_parts[1]


def validate(index: dict, source: str = "index") -> list[str]:
    """Validate `index` against the schema. Returns a list of errors, empty if valid."""
    errors: list[str] = []

    if not isinstance(index, dict):
        return [f"{source}: expected an object, got {type(index).__name__}"]

    schema_version = index.get("indexSchemaVersion")
    if not isinstance(schema_version, str):
        errors.append(f"{source}: missing required field 'indexSchemaVersion'")
    elif not compatible(schema_version):
        errors.append(
            f"{source}: index schema {schema_version} is not readable by a consumer at "
            f"{INDEX_SCHEMA_VERSION}"
        )

    repository = index.get("repository")
    if repository is None:
        errors.append(f"{source}: missing required field 'repository'")
    else:
        _check_fields(repository, _REPOSITORY_FIELDS, f"{source}.repository", errors)

    for section, fields in (
        ("modules", _MODULE_FIELDS),
        ("apis", _API_FIELDS),
        ("permissions", _PERMISSION_FIELDS),
        ("externalIntegrations", _INTEGRATION_FIELDS),
    ):
        entries = index.get(section)
        if not isinstance(entries, list):
            errors.append(f"{source}.{section}: expected a list")
            continue
        for position, entry in enumerate(entries):
            where = f"{source}.{section}[{position}]"
            _check_fields(entry, fields, where, errors)
            if isinstance(entry, dict):
                _check_confidence(entry, where, errors)

    modules = index.get("modules")
    if isinstance(modules, list):
        known = {
            entry.get("id") for entry in modules if isinstance(entry, dict)
        }
        if len(known) != len(modules):
            errors.append(f"{source}.modules: module ids are not unique")
        for position, entry in enumerate(modules):
            if not isinstance(entry, dict):
                continue

            # Cross-repository consumption is validated for shape only: whether
            # the producer exists is an estate-level question the aggregator
            # answers, not something one index can know about itself.
            for offset, consumed in enumerate(entry.get("consumes", []) or []):
                where = f"{source}.modules[{position}].consumes[{offset}]"
                _check_fields(consumed, _CONSUMES_FIELDS, where, errors)
                if isinstance(consumed, dict):
                    repository_ref = consumed.get("repository", "")
                    if isinstance(repository_ref, str) and "/" not in repository_ref:
                        errors.append(f"{where}.repository: expected owner/repo")

            for dependency in entry.get("dependsOn", []):
                if dependency not in known:
                    errors.append(
                        f"{source}.modules[{position}].dependsOn: "
                        f"'{dependency}' is not a module in this index"
                    )

        # Every cross-referenced module id must exist, or the catalogue would
        # aggregate dangling references.
        for section in ("apis", "permissions", "externalIntegrations"):
            for position, entry in enumerate(index.get(section, []) or []):
                if isinstance(entry, dict) and entry.get("module") not in known:
                    errors.append(
                        f"{source}.{section}[{position}].module: "
                        f"'{entry.get('module')}' is not a module in this index"
                    )

    health = index.get("health")
    if not isinstance(health, dict):
        errors.append(f"{source}.health: expected an object")

    return errors
