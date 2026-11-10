"""Generate isolated, deterministic visualization TEST DATA, not scheduler results."""

import json
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "examples" / "synthetic-stress-500"
SEED = 5745500
COUNT = 500


def build_bundle():
    rng = random.Random(SEED)
    # Read the contract as a template only; never write to the source directory.
    manifest = json.loads((ROOT / "examples/contract/experiment_manifest.json").read_text(encoding="utf-8"))
    manifest.update(manifest_id="synthetic-stress-test-500-v1", phase="fixture")
    manifest["workload_distribution"] = {"kind": "manual_fixture", "task_count": 8}
    manifest["seed_splits"] = {"fixture": [SEED], "training": [], "pilot": [], "held_out": []}
    manifest["software_versions"] = {"generator": "synthetic-stress-fixture-v1", "simulator": None, "metrics_calculator": "event-sums-v1"}
    manifest["policy_configs"] = [
        {"policy_config_id": f"synthetic-group-{name.lower()}", "family": "manual_fixture",
         "label": f"Synthetic test group {name} (not an algorithm)", "parameters": {}}
        for name in "ABC"
    ]
    tasks = [{"task_id": f"synthetic-task-{i + 1:02d}", "arrival_s": i * .25,
              "compute_cycles": rng.randrange(5, 31) * 100_000_000,
              "upload_bytes": rng.randrange(2, 21) * 100_000,
              "return_bytes": rng.randrange(1, 5) * 25_000} for i in range(8)]
    instance = {"schema_version": "1.0.0", "instance_id": "synthetic-stress-instance-500-v1",
                "manifest_id": manifest["manifest_id"], "phase": "fixture",
                "intensity_label": "synthetic-stress-test", "environment_seed": SEED,
                "task_generation_seed": SEED, "tasks": tasks}
    nodes = manifest["topology"]["nodes"]
    runs, events = [], []
    for i in range(COUNT):
        run_id = f"synthetic-test-run-{i + 1:04d}"
        run_events = []
        cursor = 0.0
        # Analytic synthetic traces: serialize tasks and add artificial idle gaps.
        # The three color groups use the SAME generation rule, not three policies.
        gap_scale = rng.uniform(0, 1.5)
        for task in tasks:
            node = rng.choice(nodes)
            local = node["node_id"] == manifest["topology"]["gateway_node_id"]
            start = max(cursor, task["arrival_s"]) + rng.random() * gap_scale
            up_start = None if local else start
            up_end = None if local else start + task["upload_bytes"] * 8 / node["link_rate_bps"]
            compute_start = start if local else up_end
            compute_end = compute_start + task["compute_cycles"] / node["compute_capacity_cycles_per_s"]
            ret_start = None if local else compute_end
            ret_end = None if local else compute_end + task["return_bytes"] * 8 / node["link_rate_bps"]
            cursor = compute_end if local else ret_end
            run_events.append({
                "schema_version": "1.0.0", "run_id": run_id, "instance_id": instance["instance_id"],
                "task_id": task["task_id"], "destination_id": node["node_id"], "status": "complete",
                "failure_reason": None, "upload_start_s": up_start, "upload_end_s": up_end,
                "compute_start_s": compute_start, "compute_end_s": compute_end,
                "return_start_s": ret_start, "return_end_s": ret_end, "completion_s": cursor,
                "compute_energy_j": (compute_end - compute_start) * node["active_compute_power_increment_w"],
                "transfer_energy_j": 0 if local else (task["upload_bytes"] + task["return_bytes"]) / 1_000_000 * node["transfer_energy_j_per_mb"],
            })
        runs.append({
            "schema_version": "1.0.0", "run_id": run_id, "instance_id": instance["instance_id"],
            "manifest_id": manifest["manifest_id"], "policy_config_id": manifest["policy_configs"][i % 3]["policy_config_id"],
            "policy_seed": None, "simulator_version": None, "dqn_checkpoint_id": None,
            "record_origin": "manual_fixture", "status": "complete", "failure_reason": None,
            "task_count": len(tasks), "makespan_s": cursor - tasks[0]["arrival_s"],
            "energy_j": sum(e["compute_energy_j"] + e["transfer_energy_j"] for e in run_events),
            "mean_latency_s": sum(e["completion_s"] - t["arrival_s"] for e, t in zip(run_events, tasks)) / len(tasks),
            "event_log_path": "task_events.jsonl",
        })
        events.extend(run_events)
    manifest["raw_data_paths"] = {
        "instances": ["workload_instance.json"],
        "runs": [f"run_records/{run['run_id']}.json" for run in runs],
        "event_logs": ["task_events.jsonl"],
    }
    return {"schema_version": "1.0.0", "manifest": manifest, "instance": instance, "runs": runs, "events": events}


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


def main():
    bundle = build_bundle()
    (OUTPUT / "run_records").mkdir(parents=True, exist_ok=True)
    write_json(OUTPUT / "experiment_manifest.json", bundle["manifest"])
    write_json(OUTPUT / "workload_instance.json", bundle["instance"])
    for run in bundle["runs"]:
        write_json(OUTPUT / "run_records" / f"{run['run_id']}.json", run)
    (OUTPUT / "task_events.jsonl").write_text("".join(json.dumps(e, separators=(",", ":")) + "\n" for e in bundle["events"]), encoding="utf-8")
    write_json(OUTPUT / "bundle.json", bundle)
    print(f"TEST DATA ONLY: {len(bundle['runs'])} runs, {len(bundle['events'])} events -> {OUTPUT}")


if __name__ == "__main__":
    main()
