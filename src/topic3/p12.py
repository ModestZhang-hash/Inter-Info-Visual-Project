"""Rebuild held-out objectives and Pareto labels from the archived logs.

A second pass replays the frozen instances through the simulator and compares
the new events with the archived logs. The checkpoint is not retrained.
"""

from __future__ import annotations

import json
import platform
import sys
from pathlib import Path

from topic3.dqn import DqnPolicy, copy_weights
from topic3.metrics import recompute_objectives
from topic3.p10 import CHECKPOINT_ID, CONFIGS
from topic3.pareto import classify_all
from topic3.policies import make_heuristic
from topic3.simulator import PROVISIONAL_RANDOM_SEED, SIMULATOR_VERSION, run_instance

TOLERANCE = 1e-9


def verify_p12(root: Path) -> dict:
    archive = root / "artifacts" / "workloads" / "provisional" / "p10_held_out"
    objectives = json.loads((archive / "objectives.json").read_text(encoding="utf-8"))
    pareto = json.loads((archive / "pareto.json").read_text(encoding="utf-8"))
    failures = json.loads((archive / "failures.json").read_text(encoding="utf-8"))
    manifest = json.loads((root / "configs" / "provisional" / "held_out.json").read_text(encoding="utf-8"))
    gateway = manifest["topology"]["gateway_node_id"]
    metric_mismatches = []
    by_instance = {}
    for row in objectives["runs"]:
        frozen = json.loads((root / "artifacts" / "workloads" / "provisional" / "held_out" / f"{row['instance_id']}.json").read_text(encoding="utf-8"))
        events = [json.loads(line) for line in (archive / "events" / f"{row['run_id']}.jsonl").read_text(encoding="utf-8").splitlines()]
        rebuilt = recompute_objectives(frozen, events, local_node_id=gateway)
        if any(abs(rebuilt[key] - row[key]) > TOLERANCE for key in ("makespan_s", "energy_j", "mean_latency_s")):
            metric_mismatches.append(row["run_id"])
        by_instance.setdefault(row["instance_id"], []).append({**row, "status": "complete"})
    label_mismatches = []
    for instance in pareto["instances"]:
        classified = classify_all(by_instance[instance["instance_id"]], {"absolute": TOLERANCE, "relative": TOLERANCE})
        for run_id, saved in instance["full"].items():
            fresh = classified["full"][run_id]
            if fresh["non_dominated"] != saved["non_dominated"] or fresh["witness_run_ids"] != saved["witness_run_ids"]:
                label_mismatches.append(run_id)
        if instance["reference_status"] != "complete":
            label_mismatches.append(instance["instance_id"])
    replay_mismatches = _replay(root, manifest, objectives["runs"])
    return {
        "schema_version": "1.0.0",
        "simulator_version": SIMULATOR_VERSION,
        "python_version": sys.version.split()[0],
        "platform": platform.platform(),
        "checkpoint_id": CHECKPOINT_ID,
        "tolerance_absolute": TOLERANCE,
        "runs_recomputed": len(objectives["runs"]),
        "metric_mismatches": metric_mismatches,
        "pareto_label_mismatches": label_mismatches,
        "replay_event_mismatches": replay_mismatches,
        "failure_count": failures["failure_count"],
        "pooled_pareto": pareto["pooled_instances"],
        "objectives_match": not metric_mismatches,
        "pareto_labels_match": not label_mismatches,
        "replay_matches": not replay_mismatches,
    }


def _replay(root, manifest, runs):
    feature_config = json.loads((root / "configs" / "provisional" / "dqn_features.json").read_text(encoding="utf-8"))
    checkpoint = json.loads((root / "artifacts" / "workloads" / "provisional" / "p8d_training" / f"{CHECKPOINT_ID}-weights.json").read_text(encoding="utf-8"))
    destinations = [node["node_id"] for node in manifest["topology"]["nodes"]]
    scales = {"s_M": feature_config["s_M"], "s_E": feature_config["s_E"], "s_L": feature_config["s_L"]}
    policy = DqnPolicy(destinations, feature_config)
    policy.online = copy_weights(checkpoint["weights"])
    policy.target = copy_weights(checkpoint["weights"])
    weights_before = copy_weights(policy.online)
    mismatches = []
    instances = {}
    for row in runs:
        instances.setdefault(row["instance_id"], []).append(row)
    archive = root / "artifacts" / "workloads" / "provisional" / "p10_held_out" / "events"
    for instance_id, group in instances.items():
        frozen = json.loads((root / "artifacts" / "workloads" / "provisional" / "held_out" / f"{instance_id}.json").read_text(encoding="utf-8"))
        for row in group:
            config_id = row["policy_config_id"]
            runner = policy if config_id == "dqn-fixed" else make_heuristic(config_id, destinations, scales, PROVISIONAL_RANDOM_SEED if config_id == "random" else None)
            events, record = run_instance(frozen, runner, manifest, event_log_path=f"events/{row['run_id']}.jsonl")
            stored = [json.loads(line) for line in (archive / f"{row['run_id']}.jsonl").read_text(encoding="utf-8").splitlines()]
            if record["run_id"] != row["run_id"] or events != stored:
                mismatches.append(row["run_id"])
    if policy.online != weights_before:
        mismatches.append("dqn-weights-changed")
    return mismatches
