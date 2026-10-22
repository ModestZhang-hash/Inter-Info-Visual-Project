"""Build arithmetic-only 3A fixtures. These are not scheduler experiment results."""

import json
import sys
from pathlib import Path


HERE = Path(__file__).resolve().parent
SOURCE = HERE.parent / "contract"
sys.path.insert(0, str(HERE.parents[1] / "src"))
from topic3.pareto import classify_all  # noqa: E402
manifest = json.loads((SOURCE / "experiment_manifest.json").read_text(encoding="utf-8"))
instance = json.loads((SOURCE / "workload_instance.json").read_text(encoding="utf-8"))
manifest["manifest_id"] = "3a-manual-demo-001"
manifest["workload_distribution"] = {"kind": "manual_fixture", "task_count": 2}
instance["instance_id"] = "3a-demo-instance-001"
instance["manifest_id"] = manifest["manifest_id"]
instance["intensity_label"] = "manual-demo"

# Different fixed placements create real trade-offs from the same two tasks.
# None of these placements was produced by a named scheduling algorithm.
placements = [
    ("A", "edge-0", "edge-1"),
    ("B", "edge-0", "edge-2"),
    ("C", "edge-1", "edge-0"),
    ("D", "edge-1", "edge-2"),
    ("E", "edge-2", "edge-0"),
    ("F", "edge-2", "cloud-0"),
    ("G", "cloud-0", "edge-2"),
]
nodes = {node["node_id"]: node for node in manifest["topology"]["nodes"]}
manifest["policy_configs"] = [
    {"policy_config_id": f"fixture-{name.lower()}", "family": "manual_fixture", "label": f"手工放置 {name}", "parameters": {"destinations": [first, second]}}
    for name, first, second in placements
]
manifest["raw_data_paths"] = {
    "instances": ["workload_instance.json"],
    "runs": [f"run_records/run_{name.lower()}.json" for name, _, _ in placements],
    "event_logs": ["task_events.jsonl"],
}

runs = []
events = []
for name, first, second in placements:
    run_id = f"3a-demo-run-{name.lower()}"
    run_events = []
    for task, destination in zip(instance["tasks"], (first, second)):
        node = nodes[destination]
        arrival = task["arrival_s"]
        local = destination == manifest["topology"]["gateway_node_id"]
        upload_start = None if local else arrival
        upload_end = None if local else arrival + task["upload_bytes"] * 8 / node["link_rate_bps"]
        compute_start = arrival if local else upload_end
        compute_end = compute_start + task["compute_cycles"] / node["compute_capacity_cycles_per_s"]
        return_start = None if local else compute_end
        return_end = None if local else compute_end + task["return_bytes"] * 8 / node["link_rate_bps"]
        event = {
            "schema_version": "1.0.0", "run_id": run_id, "instance_id": instance["instance_id"],
            "task_id": task["task_id"], "destination_id": destination, "status": "complete",
            "failure_reason": None, "upload_start_s": upload_start, "upload_end_s": upload_end,
            "compute_start_s": compute_start, "compute_end_s": compute_end,
            "return_start_s": return_start, "return_end_s": return_end,
            "completion_s": compute_end if local else return_end,
            "compute_energy_j": (compute_end - compute_start) * node["active_compute_power_increment_w"],
            "transfer_energy_j": 0 if local else (task["upload_bytes"] + task["return_bytes"]) / 1_000_000 * node["transfer_energy_j_per_mb"],
        }
        run_events.append(event)
    # The two tasks use different nodes, so their transfer/compute stages do not queue.
    assert first != second
    events.extend(run_events)
    runs.append({
        "schema_version": "1.0.0", "run_id": run_id, "instance_id": instance["instance_id"],
        "manifest_id": manifest["manifest_id"], "policy_config_id": f"fixture-{name.lower()}",
        "policy_seed": None, "simulator_version": None, "dqn_checkpoint_id": None,
        "record_origin": "manual_fixture", "status": "complete", "failure_reason": None,
        "task_count": len(instance["tasks"]),
        "makespan_s": max(event["completion_s"] for event in run_events) - min(task["arrival_s"] for task in instance["tasks"]),
        "energy_j": sum(event["compute_energy_j"] + event["transfer_energy_j"] for event in run_events),
        "mean_latency_s": sum(event["completion_s"] - task["arrival_s"] for event, task in zip(run_events, instance["tasks"])) / len(run_events),
        "event_log_path": "task_events.jsonl",
    })

bundle = {
    "schema_version": "1.0.0", "manifest": manifest, "instance": instance,
    "runs": runs, "events": events,
    "pareto_check": classify_all(runs, manifest["numeric_tolerance"]),
}
(HERE / "run_records").mkdir(exist_ok=True)
(HERE / "experiment_manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
(HERE / "workload_instance.json").write_text(json.dumps(instance, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
for run in runs:
    (HERE / "run_records" / f"run_{run['run_id'][-1]}.json").write_text(json.dumps(run, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
(HERE / "bundle.json").write_text(json.dumps(bundle, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
(HERE / "task_events.jsonl").write_text("".join(json.dumps(event, ensure_ascii=False) + "\n" for event in events), encoding="utf-8")
