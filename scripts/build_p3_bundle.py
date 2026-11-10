"""Export one training instance to the existing shared SVG entry.

The drawing layer remains app/index.html. Displayed M, E, and L come from
topic3.metrics. Two policies are not an official seven-candidate front.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from topic3.metrics import recompute_objectives, reject_duplicate_run_ids  # noqa: E402
from topic3.workload import canonical_json  # noqa: E402

INSTANCE_ID = "provisional-training-low-1000"
RUN_IDS = (
    "provisional-training-low-1000-latency-first",
    "provisional-training-low-1000-random-11",
)


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def within_tolerance(left, right, tolerance):
    return abs(left - right) <= max(tolerance["absolute"], tolerance["relative"] * max(abs(left), abs(right)))


def build_bundle(root: Path) -> dict:
    manifest = read_json(root / "configs" / "provisional" / "training.json")
    frozen = read_json(root / "artifacts" / "workloads" / "provisional" / "training" / f"{INSTANCE_ID}.json")
    gateway = manifest["topology"]["gateway_node_id"]
    runs = []
    events = []
    for run_id in RUN_IDS:
        record = read_json(root / "artifacts" / "workloads" / "provisional" / "run_records" / f"{run_id}.json")
        log = [json.loads(line) for line in (root / "artifacts" / "workloads" / "provisional" / "events" / f"{run_id}.jsonl").read_text(encoding="utf-8").splitlines()]
        values = recompute_objectives(frozen, log, local_node_id=gateway)
        for key, value in values.items():
            if not within_tolerance(value, record[key], manifest["numeric_tolerance"]):
                raise SystemExit(f"Independent {key} disagrees with the stored run record for {run_id}")
            record[key] = value
        runs.append(record)
        events.extend(log)
    reject_duplicate_run_ids(runs)
    return {
        "schema_version": "1.0.0",
        "p3_note": "Drawing layer remains the shared SVG entry at app/index.html. M, E, and L were recomputed from the event log by topic3.metrics. Two simulated policies on one training instance are not an official seven-candidate front.",
        "manifest": manifest,
        "instance": frozen,
        "runs": runs,
        "events": events,
    }


def main():
    root = Path(__file__).resolve().parents[1]
    bundle = build_bundle(root)
    output = root / "examples" / "p3-training-low" / "bundle.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(canonical_json(bundle), encoding="utf-8")
    print(f"Wrote {len(bundle['runs'])} runs and {len(bundle['events'])} events to {output}")


if __name__ == "__main__":
    main()
