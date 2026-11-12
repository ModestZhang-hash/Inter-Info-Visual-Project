"""Matched held-out runs for the frozen seven configurations.

The archived episode-500 checkpoint is used for greedy inference. Weights are
not updated, and no new checkpoint is trained. Every instance keeps one task
list across its seven runs. Failures stay in the failure table.
"""

from __future__ import annotations

import json
from pathlib import Path

from topic3.dqn import POLICY_CONFIG_ID, PROVISIONAL_DQN_SEED, DqnPolicy, copy_weights
from topic3.metrics import MetricError, recompute_objectives
from topic3.p9 import _accounting_failure
from topic3.pareto import classify_all
from topic3.policies import HEURISTIC_IDS, make_heuristic
from topic3.simulator import PROVISIONAL_RANDOM_SEED, SIMULATOR_VERSION, run_id_for, run_instance
from topic3.workload import canonical_json

CHECKPOINT_ID = "provisional-dqn-seed8-episode500"
TOLERANCE = 1e-9
CONFIGS = (*HEURISTIC_IDS, POLICY_CONFIG_ID)


def run_p10(root: Path) -> dict:
    """Run the frozen held-out grid and write its archive."""
    freeze = json.loads((root / "configs" / "freeze" / "design_freeze_v1.json").read_text(encoding="utf-8"))
    if freeze.get("freeze_version") != "1" or freeze.get("read_only") is not True:
        raise ValueError("P10 requires the read-only version-1 design freeze")
    if freeze["dqn"]["checkpoint_id"] != CHECKPOINT_ID or freeze["dqn"]["checkpoint_rule"] != "Online weights after episode 500. Intermediate weights were not compared.":
        raise ValueError("P10 refused a freeze whose checkpoint rule differs from episode 500")
    seeds = freeze["seed_splits"]["held_out"]
    if seeds != list(range(3000, 3036)):
        raise ValueError("Held-out seeds differ from the frozen 3000-3035 list")
    manifest = json.loads((root / "configs" / "provisional" / "held_out.json").read_text(encoding="utf-8"))
    feature_config = json.loads((root / "configs" / "provisional" / "dqn_features.json").read_text(encoding="utf-8"))
    scales = {"s_M": feature_config["s_M"], "s_E": feature_config["s_E"], "s_L": feature_config["s_L"]}
    checkpoint_path = root / "artifacts" / "workloads" / "provisional" / "p8d_training" / f"{CHECKPOINT_ID}-weights.json"
    checkpoint = json.loads(checkpoint_path.read_text(encoding="utf-8"))
    if checkpoint.get("checkpoint_id") != CHECKPOINT_ID:
        raise ValueError("P10 refused a mismatched checkpoint file")
    destinations = [node["node_id"] for node in manifest["topology"]["nodes"]]
    policy = DqnPolicy(destinations, feature_config)
    policy.online = copy_weights(checkpoint["weights"])
    policy.target = copy_weights(checkpoint["weights"])
    weights_before = copy_weights(policy.online)
    rng_before = policy.rng_state
    archive = root / "artifacts" / "workloads" / "provisional" / "p10_held_out"
    events_dir = archive / "events"
    records_dir = archive / "run_records"
    events_dir.mkdir(parents=True, exist_ok=True)
    records_dir.mkdir(parents=True, exist_ok=True)
    failures = []
    objectives = []
    instances = []
    seen_ids = set()
    for seed in seeds:
        intensity = _intensity(seed)
        instance_id = f"provisional-held_out-{intensity}-{seed}"
        frozen = json.loads((root / "artifacts" / "workloads" / "provisional" / "held_out" / f"{instance_id}.json").read_text(encoding="utf-8"))
        if frozen.get("phase") != "held_out" or frozen.get("instance_id") != instance_id or frozen.get("task_generation_seed") != seed:
            raise ValueError(f"Held-out instance does not match the frozen seed: {instance_id}")
        task_ids = [task["task_id"] for task in frozen["tasks"]]
        instance_runs = []
        print(f"{instance_id}", flush=True)
        for config_id in CONFIGS:
            seed_for_policy = PROVISIONAL_RANDOM_SEED if config_id == "random" else PROVISIONAL_DQN_SEED if config_id == POLICY_CONFIG_ID else None
            expected_id = run_id_for(instance_id, config_id, seed_for_policy)
            if expected_id in seen_ids:
                failures.append(_failure(instance_id, config_id, expected_id, "duplicate run_id"))
                continue
            seen_ids.add(expected_id)
            outcome = _execute_run(frozen, manifest, destinations, scales, policy, config_id, expected_id)
            if outcome["events"] is not None:
                _write_events(events_dir / f"{expected_id}.jsonl", outcome["events"])
            if outcome["record"] is not None:
                (records_dir / f"{expected_id}.json").write_text(canonical_json(outcome["record"]), encoding="utf-8")
            if outcome["failure"] is not None:
                failures.append(_failure(instance_id, config_id, expected_id, outcome["failure"]))
            else:
                objectives.append(outcome["objective"])
            instance_runs.append(outcome)
        checked = [item["task_ids"] for item in instance_runs if item["task_ids"] is not None]
        same_tasks = len(checked) == len(CONFIGS) and all(ids == task_ids for ids in checked)
        instances.append({
            "instance_id": instance_id,
            "intensity": intensity,
            "task_generation_seed": seed,
            "task_count": len(task_ids),
            "same_task_list": same_tasks,
            "run_ids": [run_id_for(instance_id, config_id, PROVISIONAL_RANDOM_SEED if config_id == "random" else PROVISIONAL_DQN_SEED if config_id == POLICY_CONFIG_ID else None) for config_id in CONFIGS],
        })
    if policy.online != weights_before or policy.rng_state != rng_before:
        raise RuntimeError("Held-out inference changed DQN weights or the seed stream")
    pareto = _pareto(objectives, instances)
    expected = len(seeds) * len(CONFIGS)
    index = {
        "schema_version": "1.0.0",
        "freeze_version": "1",
        "checkpoint_id": CHECKPOINT_ID,
        "checkpoint_source": f"artifacts/workloads/provisional/p8d_training/{CHECKPOINT_ID}-weights.json",
        "retrained": False,
        "weights_updated": False,
        "simulator_version": SIMULATOR_VERSION,
        "runs_expected": expected,
        "runs_complete": len(objectives),
        "failure_count": len(failures),
        "instances": len(instances),
        "same_task_list_for_each_instance": all(item["same_task_list"] for item in instances),
        "intensities": {"low": list(range(3000, 3012)), "medium": list(range(3012, 3024)), "high": list(range(3024, 3036))},
        "configurations": list(CONFIGS),
        "instances_detail": instances,
    }
    payload = {
        "index": index,
        "failures": {"schema_version": "1.0.0", "failure_count": len(failures), "rows": failures},
        "objectives": {"schema_version": "1.0.0", "metrics_source": "topic3.metrics.recompute_objectives", "runs": objectives},
        "pareto": {"schema_version": "1.0.0", "pooled_instances": False, "instances": pareto},
    }
    (archive / "index.json").write_text(canonical_json(payload["index"]), encoding="utf-8")
    (archive / "failures.json").write_text(canonical_json(payload["failures"]), encoding="utf-8")
    (archive / "objectives.json").write_text(canonical_json(payload["objectives"]), encoding="utf-8")
    (archive / "pareto.json").write_text(canonical_json(payload["pareto"]), encoding="utf-8")
    return payload


def _execute_run(frozen, manifest, destinations, scales, policy, config_id, expected_id):
    seed = PROVISIONAL_RANDOM_SEED if config_id == "random" else None
    runner = policy if config_id == POLICY_CONFIG_ID else make_heuristic(config_id, destinations, scales, seed)
    try:
        events, record = run_instance(frozen, runner, manifest, event_log_path=f"events/{expected_id}.jsonl")
    except (ValueError, RuntimeError, MetricError) as exc:
        return {"events": None, "record": None, "objective": None, "failure": str(exc), "task_ids": None}
    record["dqn_checkpoint_id"] = CHECKPOINT_ID if config_id == POLICY_CONFIG_ID else None
    task_ids = [event["task_id"] for event in events]
    if record["run_id"] != expected_id:
        return {"events": events, "record": record, "objective": None, "failure": "run_id does not match the frozen naming rule", "task_ids": task_ids}
    if record["status"] != "complete":
        return {"events": events, "record": record, "objective": None, "failure": record["failure_reason"] or "run did not complete", "task_ids": task_ids}
    accounting = _accounting_failure(frozen, events, manifest)
    if accounting is not None:
        return {"events": events, "record": record, "objective": None, "failure": accounting, "task_ids": task_ids}
    try:
        metrics = recompute_objectives(frozen, events, local_node_id=manifest["topology"]["gateway_node_id"])
    except MetricError as exc:
        return {"events": events, "record": record, "objective": None, "failure": str(exc), "task_ids": task_ids}
    if any(abs(record[key] - metrics[source]) > TOLERANCE for key, source in (("makespan_s", "makespan_s"), ("energy_j", "energy_j"), ("mean_latency_s", "mean_latency_s"))):
        return {"events": events, "record": record, "objective": None, "failure": "simulator summary disagrees with independent metrics", "task_ids": task_ids}
    record["makespan_s"] = metrics["makespan_s"]
    record["energy_j"] = metrics["energy_j"]
    record["mean_latency_s"] = metrics["mean_latency_s"]
    record["metrics_source"] = "topic3.metrics.recompute_objectives"
    return {
        "events": events,
        "record": record,
        "failure": None,
        "task_ids": task_ids,
        "objective": {
            "run_id": expected_id,
            "instance_id": frozen["instance_id"],
            "policy_config_id": config_id,
            "status": "complete",
            "makespan_s": metrics["makespan_s"],
            "energy_j": metrics["energy_j"],
            "mean_latency_s": metrics["mean_latency_s"],
            "checkpoint_id": record["dqn_checkpoint_id"],
        },
    }


def _pareto(objectives, instances):
    rows = []
    by_instance = {}
    for objective in objectives:
        by_instance.setdefault(objective["instance_id"], []).append(objective)
    for instance in instances:
        group = by_instance.get(instance["instance_id"], [])
        status = "complete" if len(group) == len(CONFIGS) else "incomplete_candidates"
        classified = classify_all([{**item, "status": "complete"} for item in group], {"absolute": TOLERANCE, "relative": TOLERANCE}) if group else {"full": {}, "pairs": {}}
        disagreements = []
        full = {}
        for item in group:
            label = classified["full"][item["run_id"]]
            full[item["run_id"]] = {"non_dominated": label["non_dominated"], "witness_run_ids": label["witness_run_ids"]}
            for pair_name, labels in classified["pairs"].items():
                if labels[item["run_id"]]["non_dominated"] != label["non_dominated"]:
                    disagreements.append({"run_id": item["run_id"], "pair": pair_name, "full_non_dominated": label["non_dominated"]})
        rows.append({
            "instance_id": instance["instance_id"],
            "intensity": instance["intensity"],
            "reference_status": status,
            "candidate_count": len(group),
            "full": full,
            "pair_full_disagreements": disagreements,
        })
    return rows


def _intensity(seed: int) -> str:
    if 3000 <= seed <= 3011:
        return "low"
    if 3012 <= seed <= 3023:
        return "medium"
    if 3024 <= seed <= 3035:
        return "high"
    raise ValueError(f"Seed is outside the frozen held-out list: {seed}")


def _failure(instance_id, config_id, run_id, reason):
    return {"instance_id": instance_id, "policy_config_id": config_id, "run_id": run_id, "reason": reason}


def _write_events(path: Path, events) -> None:
    lines = [json.dumps(event, ensure_ascii=False, sort_keys=True, allow_nan=False) for event in events]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
