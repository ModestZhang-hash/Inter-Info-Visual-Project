"""Bundle the six heuristic runs for the unified page check.

The bundle is an incomplete candidate set. It does not include a six-run
pareto_check, because the viewer only treats seven complete candidates as the
official reference.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from topic3.metrics import recompute_objectives  # noqa: E402
from topic3.pareto import classify_all  # noqa: E402
from topic3.workload import canonical_json  # noqa: E402

INSTANCE_ID = "provisional-training-low-1000"


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def within_tolerance(left, right, tolerance):
    return abs(left - right) <= max(tolerance["absolute"], tolerance["relative"] * max(abs(left), abs(right)))


def build_bundle(root: Path) -> dict:
    manifest = read_json(root / "configs" / "provisional" / "training.json")
    tolerance = {"absolute": manifest["numeric_tolerance"]["absolute"], "relative": manifest["numeric_tolerance"]["relative"]}
    frozen = read_json(root / "artifacts" / "workloads" / "provisional" / "training" / f"{INSTANCE_ID}.json")
    reference = read_json(root / "artifacts" / "workloads" / "provisional" / "p5_six_heuristic" / f"{INSTANCE_ID}.json")
    index = read_json(root / "artifacts" / "workloads" / "provisional" / "p4_one_instance" / "index.json")
    gateway = manifest["topology"]["gateway_node_id"]
    base = root / "artifacts" / "workloads" / "provisional" / "p4_one_instance"
    runs = []
    events = []
    for run_id in index["runs"]:
        record = read_json(base / "run_records" / f"{run_id}.json")
        log = [json.loads(line) for line in (base / "events" / f"{run_id}.jsonl").read_text(encoding="utf-8").splitlines()]
        recomputed = recompute_objectives(frozen, log, local_node_id=gateway)
        for key, value in recomputed.items():
            if not within_tolerance(value, record[key], tolerance):
                raise SystemExit(f"Independent {key} disagrees for {run_id}")
            record[key] = value
        runs.append(record)
        events.extend(log)
    classified = classify_all(runs, tolerance)
    for run_id, entry in classified["full"].items():
        saved = reference["classification"]["full"][run_id]
        if entry["non_dominated"] != saved["non_dominated"] or entry["witness_run_ids"] != saved["witness_run_ids"]:
            raise SystemExit(f"3D classification disagrees with the P5 record for {run_id}")
    for pair_key, saved_pair in reference["classification"]["pairs"].items():
        for run_id, saved in saved_pair.items():
            entry = classified["pairs"][pair_key][run_id]
            if entry["non_dominated"] != saved["non_dominated"] or entry["witness_run_ids"] != saved["witness_run_ids"]:
                raise SystemExit(f"{pair_key} classification disagrees with the P5 record for {run_id}")
    return {
        "schema_version": "1.0.0",
        "p6_note": "Six heuristic runs on one training instance for linked-view checking. Not an official seven-candidate front. Formal Pareto labels stay withheld because dqn-fixed is absent. Brush is not part of this check.",
        "manifest": manifest,
        "instance": frozen,
        "runs": runs,
        "events": events,
    }


def main():
    root = Path(__file__).resolve().parents[1]
    bundle = build_bundle(root)
    output = root / "examples" / "p6-six-heuristic" / "bundle.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(canonical_json(bundle), encoding="utf-8")
    print(f"Wrote {len(bundle['runs'])} runs and {len(bundle['events'])} events to {output}")


if __name__ == "__main__":
    main()
