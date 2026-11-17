"""Package existing provisional archives for the instance menu.

Copies frozen instances, run records, and task events. Does not call the
simulator, does not read or write checkpoints, and does not edit freeze files.
The two bundles already on the page are left in place and only referenced.
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from topic3.pareto import classify_all  # noqa: E402
from topic3.workload import canonical_json  # noqa: E402

POLICY_ORDER = (
    "random",
    "latency-first",
    "energy-first",
    "balanced-equal",
    "balanced-makespan",
    "balanced-energy",
    "dqn-fixed",
)
PARTIALS = (
    ("training", "provisional-training-medium-1001", 1001, "medium"),
    ("training", "provisional-training-high-1002", 1002, "high"),
    ("pilot", "provisional-pilot-low-2000", 2000, "low"),
    ("pilot", "provisional-pilot-medium-2001", 2001, "medium"),
    ("pilot", "provisional-pilot-high-2002", 2002, "high"),
)
OUTPUT = ROOT / "examples" / "instances"


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def events_for(directory: Path, run_id: str):
    path = directory / f"{run_id}.jsonl"
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def assemble(phase: str, instance_id: str, record_dir: Path, event_dir: Path, expected: int, include_pareto: bool):
    manifest = read_json(ROOT / "configs" / "provisional" / f"{phase}.json")
    instance = read_json(ROOT / "artifacts" / "workloads" / "provisional" / phase / f"{instance_id}.json")
    if instance["instance_id"] != instance_id or instance["phase"] != phase:
        raise SystemExit(f"Frozen instance does not match {instance_id}")
    records = [read_json(path) for path in record_dir.glob(f"{instance_id}-*.json")]
    records.sort(key=lambda run: (POLICY_ORDER.index(run["policy_config_id"]), run["run_id"]))
    if len(records) != expected:
        raise SystemExit(f"{instance_id} has {len(records)} archived runs, expected {expected}")
    events = []
    for record in records:
        log = events_for(event_dir, record["run_id"])
        if len(log) != instance["tasks"].__len__():
            raise SystemExit(f"{record['run_id']} event count {len(log)} does not match the instance")
        events.extend(log)
    bundle = {
        "schema_version": "1.0.0",
        "catalog_note": "Copied from the existing provisional archive for this one instance. The simulator was not rerun.",
        "manifest": manifest,
        "instance": instance,
        "runs": records,
        "events": events,
    }
    if include_pareto:
        tolerance = {
            "absolute": manifest["numeric_tolerance"]["absolute"],
            "relative": manifest["numeric_tolerance"]["relative"],
        }
        bundle["pareto_check"] = classify_all(records, tolerance)
    return bundle


def item(instance_id: str, intensity: str, seed: int, archived_runs: int, bundle: str):
    complete = archived_runs == 7
    return {
        "instance_id": instance_id,
        "intensity": intensity,
        "seed": seed,
        "archived_runs": archived_runs,
        "reference": "complete" if complete else "incomplete",
        "status_label": "7 candidates" if complete else f"{archived_runs} archived runs",
        "bundle": bundle,
    }


def write_bundle(instance_id: str, bundle: dict):
    path = OUTPUT / instance_id / "bundle.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(canonical_json(bundle), encoding="utf-8")
    return f"../../examples/instances/{instance_id}/bundle.json"


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    training_low = read_json(ROOT / "examples" / "p6-six-heuristic" / "bundle.json")
    held_low = read_json(ROOT / "examples" / "p11-held-out-low-3000" / "bundle.json")
    if training_low["instance"]["instance_id"] != "provisional-training-low-1000" or len(training_low["runs"]) != 6:
        raise SystemExit("The existing six-heuristic bundle is not the expected training instance")
    if held_low["instance"]["instance_id"] != "provisional-held_out-low-3000" or len(held_low["runs"]) != 7:
        raise SystemExit("The existing held-out bundle is not low-3000")

    groups = {
        "training": {"id": "training", "label": "Training", "items": [
            item("provisional-training-low-1000", "low", 1000, 6, "../../examples/p6-six-heuristic/bundle.json"),
        ]},
        "pilot": {"id": "pilot", "label": "Pilot", "items": []},
        "held-out-low": {"id": "held-out-low", "label": "Held-out · low", "items": []},
        "held-out-medium": {"id": "held-out-medium", "label": "Held-out · medium", "items": []},
        "held-out-high": {"id": "held-out-high", "label": "Held-out · high", "items": []},
    }
    archive = ROOT / "artifacts" / "workloads" / "provisional"
    written = 0
    for phase, instance_id, seed, intensity in PARTIALS:
        bundle = assemble(phase, instance_id, archive / "run_records", archive / "events", 2, False)
        path = write_bundle(instance_id, bundle)
        groups[phase]["items"].append(item(instance_id, intensity, seed, 2, path))
        written += 1

    held_records = archive / "p10_held_out" / "run_records"
    held_events = archive / "p10_held_out" / "events"
    for seed in range(3000, 3036):
        intensity = "low" if seed <= 3011 else "medium" if seed <= 3023 else "high"
        instance_id = f"provisional-held_out-{intensity}-{seed}"
        if seed == 3000:
            path = "../../examples/p11-held-out-low-3000/bundle.json"
        else:
            bundle = assemble("held_out", instance_id, held_records, held_events, 7, True)
            path = write_bundle(instance_id, bundle)
            written += 1
        groups[f"held-out-{intensity}"]["items"].append(item(instance_id, intensity, seed, 7, path))

    catalog = {"schema_version": "1.0.0", "groups": list(groups.values())}
    count = sum(len(group["items"]) for group in catalog["groups"])
    if count != 42 or written != 40:
        raise SystemExit(f"Catalog has {count} items and wrote {written} bundles")
    (OUTPUT / "catalog.json").write_text(canonical_json(catalog), encoding="utf-8")
    print(f"Wrote catalog with {count} instances and {written} new bundles to {OUTPUT}")


if __name__ == "__main__":
    main()
