"""Write the held-out paired summary and the seed-3000 page bundle."""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from topic3.p11 import analyze_p11  # noqa: E402
from topic3.pareto import classify_all  # noqa: E402
from topic3.workload import canonical_json  # noqa: E402

INSTANCE_ID = "provisional-held_out-low-3000"


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def build_case_bundle(root: Path) -> dict:
    manifest = read_json(root / "configs" / "provisional" / "held_out.json")
    tolerance = {"absolute": manifest["numeric_tolerance"]["absolute"], "relative": manifest["numeric_tolerance"]["relative"]}
    frozen = read_json(root / "artifacts" / "workloads" / "provisional" / "held_out" / f"{INSTANCE_ID}.json")
    base = root / "artifacts" / "workloads" / "provisional" / "p10_held_out"
    records = []
    events = []
    for path in sorted((base / "run_records").glob(f"{INSTANCE_ID}-*.json")):
        record = read_json(path)
        log = [json.loads(line) for line in (base / "events" / f"{record['run_id']}.jsonl").read_text(encoding="utf-8").splitlines()]
        records.append(record)
        events.extend(log)
    if len(records) != 7:
        raise SystemExit(f"Expected seven archived runs for {INSTANCE_ID}")
    return {
        "schema_version": "1.0.0",
        "p11_note": "Seven complete runs for the first held-out instance in seed order. The page check compares run IDs and stored metrics across the existing views.",
        "manifest": manifest,
        "instance": frozen,
        "runs": records,
        "events": events,
        "pareto_check": classify_all(records, tolerance),
    }


def main():
    summary = analyze_p11(ROOT)
    out = ROOT / "artifacts" / "workloads" / "provisional" / "p11_analysis"
    out.mkdir(parents=True, exist_ok=True)
    (out / "summary.json").write_text(canonical_json(summary), encoding="utf-8")
    bundle = build_case_bundle(ROOT)
    bundle_path = ROOT / "examples" / "p11-held-out-low-3000" / "bundle.json"
    bundle_path.parent.mkdir(parents=True, exist_ok=True)
    bundle_path.write_text(canonical_json(bundle), encoding="utf-8")
    print(f"Wrote {out / 'summary.json'}")
    print(f"Wrote {len(bundle['runs'])} runs to {bundle_path}")


if __name__ == "__main__":
    main()
