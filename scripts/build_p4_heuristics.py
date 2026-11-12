"""Record provisional Balanced scales and six-heuristic logs for one training instance."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from topic3.policies import BALANCED_WEIGHTS, HEURISTIC_IDS, make_heuristic  # noqa: E402
from topic3.scales import derive_balanced_scales  # noqa: E402
from topic3.simulator import PROVISIONAL_RANDOM_SEED, run_instance  # noqa: E402
from topic3.workload import canonical_json  # noqa: E402

INSTANCE_ID = "provisional-training-low-1000"


def main():
    root = Path(__file__).resolve().parents[1]
    scales = derive_balanced_scales(root)
    scales_path = root / "configs" / "provisional" / "balanced_scales.json"
    catalog = {
        "schema_version": "1.0.0",
        **scales,
        "note": "Six heuristics share one interface. The three balanced configuration IDs stay distinct and belong to family balanced. Scales use training and pilot logs only.",
        "configs": [
            {
                "policy_config_id": config_id,
                "family": "balanced" if config_id in BALANCED_WEIGHTS else config_id,
                "weights": {key: str(value) for key, value in BALANCED_WEIGHTS[config_id].items()} if config_id in BALANCED_WEIGHTS else {},
            }
            for config_id in HEURISTIC_IDS
        ],
    }
    scales_path.write_text(canonical_json(catalog), encoding="utf-8")
    manifest = json.loads((root / "configs" / "provisional" / "training.json").read_text(encoding="utf-8"))
    frozen = json.loads((root / "artifacts" / "workloads" / "provisional" / "training" / f"{INSTANCE_ID}.json").read_text(encoding="utf-8"))
    destinations = [node["node_id"] for node in manifest["topology"]["nodes"]]
    out = root / "artifacts" / "workloads" / "provisional" / "p4_one_instance"
    records = out / "run_records"
    logs = out / "events"
    records.mkdir(parents=True, exist_ok=True)
    logs.mkdir(parents=True, exist_ok=True)
    written = []
    for config_id in HEURISTIC_IDS:
        policy = make_heuristic(config_id, destinations, scales, PROVISIONAL_RANDOM_SEED)
        events, record = run_instance(frozen, policy, manifest, event_log_path=f"events/{record_name(policy)}.jsonl")
        (records / f"{record['run_id']}.json").write_text(canonical_json(record), encoding="utf-8")
        lines = [json.dumps(event, ensure_ascii=False, sort_keys=True, allow_nan=False) for event in events]
        (logs / f"{record['run_id']}.jsonl").write_text("\n".join(lines) + "\n", encoding="utf-8")
        written.append(record["run_id"])
    index = {"schema_version": "1.0.0", "instance_id": INSTANCE_ID, "held_out_used": False, "runs": written}
    (out / "index.json").write_text(canonical_json(index), encoding="utf-8")
    print(f"Wrote scales and {len(written)} runs for {INSTANCE_ID}")


def record_name(policy):
    if policy.policy_seed is None:
        return f"{INSTANCE_ID}-{policy.policy_config_id}"
    return f"{INSTANCE_ID}-{policy.policy_config_id}-{policy.policy_seed}"


if __name__ == "__main__":
    main()
