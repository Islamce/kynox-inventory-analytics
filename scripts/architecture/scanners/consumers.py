"""Cross-repository resolution — link what a module consumes to what produces it.

A `consumes` entry in a manifest names a contract in another repository. This
resolves those declarations against the estate catalogue, so an unresolvable
dependency is visible before it becomes a runtime surprise.

Resolution is only as good as the estate it is given. With no catalogue, every
declaration is `unresolved` and reported as such — never silently assumed
satisfied. That distinction matters: "I could not check" and "I checked and it
is fine" are different answers, and conflating them is exactly the failure mode
KAAF exists to prevent.
"""

from dataclasses import dataclass

from scanners.manifests import Module

STATUS_RESOLVED = "resolved"
STATUS_UNKNOWN_REPOSITORY = "unknown-repository"
STATUS_UNKNOWN_MODULE = "unknown-module"
STATUS_UNKNOWN_CONTRACT = "unknown-contract"
STATUS_VERSION_MISMATCH = "version-mismatch"
STATUS_UNCHECKED = "unchecked"


@dataclass(frozen=True)
class Link:
    """One declared cross-repository consumption, resolved or not."""

    consumer_repository: str
    consumer_module: str
    producer_repository: str
    producer_module: str
    contract: str
    kind: str
    expected_version: str
    actual_version: str
    status: str
    detail: str

    def as_dict(self) -> dict:
        return {
            "actualVersion": self.actual_version,
            "consumer": f"{self.consumer_repository}#{self.consumer_module}",
            "contract": self.contract,
            "detail": self.detail,
            "expectedVersion": self.expected_version,
            "kind": self.kind,
            "producer": f"{self.producer_repository}#{self.producer_module}",
            "status": self.status,
        }


def _producers(catalogue: dict | None) -> dict:
    """Index the catalogue by repository → module → contracts."""
    known: dict[str, dict[str, dict]] = {}
    if not catalogue:
        return known

    for module in catalogue.get("modules", []):
        repository = module.get("repository", "")
        known.setdefault(repository, {}).setdefault(
            module.get("id", ""), {"apis": {}, "permissions": {}}
        )

    for api in catalogue.get("apis", []):
        repository = api.get("repository", "")
        module_id = api.get("module", "")
        entry = known.setdefault(repository, {}).setdefault(
            module_id, {"apis": {}, "permissions": {}}
        )
        entry["apis"][api.get("id", "")] = api

    for permission in catalogue.get("permissions", []):
        repository = permission.get("repository", "")
        module_id = permission.get("module", "")
        entry = known.setdefault(repository, {}).setdefault(
            module_id, {"apis": {}, "permissions": {}}
        )
        entry["permissions"][permission.get("key", "")] = permission

    return known


def resolve(
    repository: str, modules: list[Module], catalogue: dict | None
) -> list[Link]:
    """Resolve every `consumes` declaration against `catalogue`."""
    known = _producers(catalogue)
    links: list[Link] = []

    for module in modules:
        for consumed in module.consumes:
            producer_repository = str(consumed.get("repository", ""))
            producer_module = str(consumed.get("module", ""))
            contract = str(consumed.get("contract", ""))
            kind = str(consumed.get("kind", "api"))
            expected = str(consumed.get("version", ""))

            def link(status: str, detail: str, actual: str = "") -> Link:
                return Link(
                    consumer_repository=repository,
                    consumer_module=module.id,
                    producer_repository=producer_repository,
                    producer_module=producer_module,
                    contract=contract,
                    kind=kind,
                    expected_version=expected,
                    actual_version=actual,
                    status=status,
                    detail=detail,
                )

            if catalogue is None:
                links.append(
                    link(
                        STATUS_UNCHECKED,
                        "No estate catalogue was supplied, so this could not be checked. "
                        "Absence of a finding is not evidence the contract exists.",
                    )
                )
                continue

            if producer_repository not in known:
                links.append(
                    link(
                        STATUS_UNKNOWN_REPOSITORY,
                        f"'{producer_repository}' publishes no index in this estate.",
                    )
                )
                continue

            if producer_module not in known[producer_repository]:
                links.append(
                    link(
                        STATUS_UNKNOWN_MODULE,
                        f"'{producer_repository}' publishes no module '{producer_module}'.",
                    )
                )
                continue

            produced = known[producer_repository][producer_module]
            catalogue_entry = (
                produced["apis"].get(contract)
                if kind in ("api", "event")
                else produced["permissions"].get(contract)
            )

            if catalogue_entry is None:
                links.append(
                    link(
                        STATUS_UNKNOWN_CONTRACT,
                        f"'{producer_repository}#{producer_module}' does not publish "
                        f"{kind} '{contract}'.",
                    )
                )
                continue

            actual = str(catalogue_entry.get("version", ""))
            if expected and actual and expected != actual:
                links.append(
                    link(
                        STATUS_VERSION_MISMATCH,
                        f"expected version {expected}, producer publishes {actual}.",
                        actual,
                    )
                )
                continue

            links.append(link(STATUS_RESOLVED, "Contract found in the estate.", actual))

    return sorted(
        links,
        key=lambda entry: (
            entry.consumer_module,
            entry.producer_repository,
            entry.producer_module,
            entry.contract,
        ),
    )


def summarize(links: list[Link]) -> dict:
    """Counts by status, plus whether anything blocks."""
    counts: dict[str, int] = {}
    for entry in links:
        counts[entry.status] = counts.get(entry.status, 0) + 1

    blocking = [
        entry
        for entry in links
        if entry.status
        in (
            STATUS_UNKNOWN_REPOSITORY,
            STATUS_UNKNOWN_MODULE,
            STATUS_UNKNOWN_CONTRACT,
            STATUS_VERSION_MISMATCH,
        )
    ]

    return {
        "byStatus": dict(sorted(counts.items())),
        "declared": len(links),
        "hasUnresolved": bool(blocking),
        "links": [entry.as_dict() for entry in links],
        "unresolved": [entry.as_dict() for entry in blocking],
    }
