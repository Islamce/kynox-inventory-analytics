"""Generate `.ai/drift.json` — declared structure versus discovered reality.

The point of this artifact is that an agent can tell how much to trust the rest
of `.ai/`. A clean report means the manifests match the code. A report full of
findings means the manifests have fallen behind, and the context built from
them is correspondingly less reliable.
"""

from scanners.facts import RepositoryFacts
from utils.provenance import meta


def build(facts: RepositoryFacts) -> dict:
    report = dict(facts.drift)

    document = {
        "_meta": meta(facts.input_digest, "drift.json", confidence="derived"),
        "confidenceByModule": {
            module_id: facts.confidence[module_id] for module_id in sorted(facts.confidence)
        },
        "howToRead": [
            "error: the declaration and the code disagree in a way that must be fixed; CI fails.",
            "warning: real drift that does not block, most often code with no manifest.",
            "info: expected divergence, such as a documentation-only dependency.",
            "Everything here is derived from a static read of the source: dynamic imports "
            "and runtime wiring are invisible to it, so absence of a finding is not proof "
            "of absence.",
        ],
    }
    document.update(report)
    return document
