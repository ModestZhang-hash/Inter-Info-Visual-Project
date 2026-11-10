"""Classify the six heuristics on one training instance.

The DQN candidate is absent, so this is not an official seven-candidate front.
Stored unrounded M, E, and L are classified only after the independent metric
calculator agrees. A second enumerator must select the same status and witnesses.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tests"))
from reference_pareto import enumerate_all  # noqa: E402
from topic3.metrics import recompute_objectives  # noqa: E402
from topic3.pareto import classify_all  # noqa: E402
from topic3.workload import canonical_json  # noqa: E402

INSTANCE_ID = "provisional-training-low-1000"
MISSING_POLICIES = ("dqn-fixed",)


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def within_tolerance(left, right, tolerance) -> bool:
    return abs(left - right) <= max(tolerance["absolute"], tolerance["relative"] * max(abs(left), abs(right)))


def build_reference(root: Path) -> dict:
    manifest = read_json(root / "configs" / "provisional" / "training.json")
    tolerance = {"absolute": manifest["numeric_tolerance"]["absolute"], "relative": manifest["numeric_tolerance"]["relative"]}
    index = read_json(root / "artifacts" / "workloads" / "provisional" / "p4_one_instance" / "index.json")
    if index["instance_id"] != INSTANCE_ID or index["held_out_used"]:
        raise SystemExit("P5 reference must use the one training instance and no held-out runs")
    frozen = read_json(root / "artifacts" / "workloads" / "provisional" / "training" / f"{INSTANCE_ID}.json")
    gateway = manifest["topology"]["gateway_node_id"]
    base = root / "artifacts" / "workloads" / "provisional" / "p4_one_instance"
    runs = []
    for run_id in index["runs"]:
        record = read_json(base / "run_records" / f"{run_id}.json")
        if record["instance_id"] != INSTANCE_ID:
            raise SystemExit("Run belongs to another instance")
        events = [json.loads(line) for line in (base / "events" / f"{run_id}.jsonl").read_text(encoding="utf-8").splitlines()]
        if record["status"] == "complete":
            recomputed = recompute_objectives(frozen, events, local_node_id=gateway)
            for key, value in recomputed.items():
                if not within_tolerance(value, record[key], tolerance):
                    raise SystemExit(f"Independent {key} disagrees for {run_id}")
        runs.append(record)
    failed = [run["run_id"] for run in runs if run["status"] != "complete"]
    classified = classify_all(runs, tolerance)
    enumerated = enumerate_all(runs, tolerance)
    if classified != enumerated:
        raise SystemExit("Formal Pareto classifier and independent enumeration disagree")
    return {
        "schema_version": "1.0.0",
        "instance_id": INSTANCE_ID,
        "official_seven_candidate_front": False,
        "reference_status": "incomplete_candidates",
        "missing_policy_config_ids": list(MISSING_POLICIES),
        "filter_does_not_recompute_reference": True,
        "note": "Dominance among the six heuristics on one training instance. DQN is absent, so this is not an official seven-candidate front. Filtering must not replace this reference set.",
        "tolerance": tolerance,
        "reference_run_ids": [run["run_id"] for run in runs if run["status"] == "complete"],
        "failed_run_ids": failed,
        "classification": classified,
    }


def main():
    root = Path(__file__).resolve().parents[1]
    record = build_reference(root)
    output = root / "artifacts" / "workloads" / "provisional" / "p5_six_heuristic" / f"{INSTANCE_ID}.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(canonical_json(record), encoding="utf-8")
    print(f"Wrote six-heuristic Pareto reference with {len(record['reference_run_ids'])} complete runs to {output}")


if __name__ == "__main__":
    main()
