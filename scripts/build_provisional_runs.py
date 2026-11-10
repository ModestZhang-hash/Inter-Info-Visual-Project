"""Write P2 Random and Latency-first logs for the provisional frozen instances."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from topic3.policies import LatencyFirstPolicy, RandomPolicy  # noqa: E402
from topic3.simulator import PROVISIONAL_RANDOM_SEED, SIMULATOR_VERSION, run_instance  # noqa: E402
from topic3.workload import PHASES, canonical_json  # noqa: E402


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def main():
    root = Path(__file__).resolve().parents[1]
    configs = root / "configs" / "provisional"
    records = root / "artifacts" / "workloads" / "provisional" / "run_records"
    logs = root / "artifacts" / "workloads" / "provisional" / "events"
    records.mkdir(parents=True, exist_ok=True)
    logs.mkdir(parents=True, exist_ok=True)
    index = []
    for phase in PHASES:
        manifest = read_json(configs / f"{phase}.json")
        destinations = [node["node_id"] for node in manifest["topology"]["nodes"]]
        base = configs
        for relative in manifest["raw_data_paths"]["instances"]:
            frozen = read_json(base / relative)
            policies = (
                LatencyFirstPolicy(),
                RandomPolicy(PROVISIONAL_RANDOM_SEED, destinations),
            )
            for policy in policies:
                run_name = f"{frozen['instance_id']}-{policy.policy_config_id}"
                if policy.policy_seed is not None:
                    run_name = f"{run_name}-{policy.policy_seed}"
                event_path = f"../../artifacts/workloads/provisional/events/{run_name}.jsonl"
                events, record = run_instance(frozen, policy, manifest, event_log_path=event_path)
                (records / f"{record['run_id']}.json").write_text(canonical_json(record), encoding="utf-8")
                lines = [json.dumps(event, ensure_ascii=False, sort_keys=True, allow_nan=False) for event in events]
                (logs / f"{record['run_id']}.jsonl").write_text("\n".join(lines) + "\n", encoding="utf-8")
                index.append(record["run_id"])
    catalog = {
        "schema_version": "1.0.0",
        "simulator_version": SIMULATOR_VERSION,
        "provisional_status": {
            "design_freeze": False,
            "seven_candidate_results": False,
            "note": "P2 logs for the provisional frozen instances. Policies are Random, with seed 11, and Latency-first. This is not the seven-candidate evaluation.",
        },
        "runs": index,
    }
    (root / "artifacts" / "workloads" / "provisional" / "p2_run_index.json").write_text(canonical_json(catalog), encoding="utf-8")
    print(f"Wrote {len(index)} provisional runs")


if __name__ == "__main__":
    main()
