"""Pilot checks and the version-1 design freeze.

Runs stay on the three pilot instances. The archived DQN checkpoint is used
for greedy inference only. Held-out event logs are not read. The checkpoint
rule stays the final online weights after episode 500 when those pilot runs
complete.
"""

from __future__ import annotations

import json
import time
from pathlib import Path

from topic3.dqn import POLICY_CONFIG_ID, PROVISIONAL_DQN_SEED, DqnPolicy, copy_weights
from topic3.metrics import recompute_objectives
from topic3.pareto import classify_all
from topic3.policies import HEURISTIC_IDS, make_heuristic
from topic3.reward_ledger import build_ledger, complete_run_reward
from topic3.simulator import PROVISIONAL_RANDOM_SEED, SIMULATOR_VERSION, run_instance

PILOT_INSTANCES = (
    ("low", "provisional-pilot-low-2000"),
    ("medium", "provisional-pilot-medium-2001"),
    ("high", "provisional-pilot-high-2002"),
)
CHECKPOINT_ID = "provisional-dqn-seed8-episode500"
TOLERANCE = {"absolute": 1e-9, "relative": 1e-9}
ACCOUNTING_TOLERANCE = 1e-9


def run_p9(root: Path) -> dict:
    """Return the pilot record, decision log, and freeze list."""
    manifest = json.loads((root / "configs" / "provisional" / "pilot.json").read_text(encoding="utf-8"))
    feature_config = json.loads((root / "configs" / "provisional" / "dqn_features.json").read_text(encoding="utf-8"))
    if feature_config.get("held_out_used") is not False:
        raise ValueError("P9 refused feature scales that used held-out runs")
    seeds = _seed_sets(manifest)
    instances = _load_pilot_instances(root)
    destinations = [node["node_id"] for node in manifest["topology"]["nodes"]]
    checkpoint = json.loads((root / "artifacts" / "workloads" / "provisional" / "p8d_training" / f"{CHECKPOINT_ID}-weights.json").read_text(encoding="utf-8"))
    if checkpoint.get("for_held_out_inference") is not False or checkpoint.get("checkpoint_id") != CHECKPOINT_ID:
        raise ValueError("P9 refused a checkpoint marked for held-out inference")
    policy = DqnPolicy(destinations, feature_config)
    policy.online = copy_weights(checkpoint["weights"])
    policy.target = copy_weights(checkpoint["weights"])
    weights_before = copy_weights(policy.online)
    rng_before = policy.rng_state
    scales = {"s_M": feature_config["s_M"], "s_E": feature_config["s_E"], "s_L": feature_config["s_L"]}
    runs = []
    for intensity, instance_id in PILOT_INSTANCES:
        frozen = instances[instance_id]
        for config_id in (*HEURISTIC_IDS, POLICY_CONFIG_ID):
            if config_id == POLICY_CONFIG_ID:
                runner = policy
            else:
                runner = make_heuristic(config_id, destinations, scales, PROVISIONAL_RANDOM_SEED)
            started = time.perf_counter()
            events, record = run_instance(frozen, runner, manifest, event_log_path=f"p9-{instance_id}-{config_id}.jsonl")
            elapsed = time.perf_counter() - started
            runs.append(_summarize_run(intensity, frozen, manifest, scales, events, record, elapsed, config_id))
    if policy.online != weights_before or policy.rng_state != rng_before:
        raise RuntimeError("Greedy pilot inference changed DQN weights or the seed stream")
    _compare_archived_heuristic_logs(root, instances, manifest, destinations, scales)
    complete = [run for run in runs if run["status"] == "complete" and run["accounting_ok"] and run["ledger_ok"]]
    pilot_ok = len(complete) == len(runs)
    fronts = _fronts(runs) if pilot_ok else []
    ceiling = _latency_ceiling(runs) if pilot_ok else None
    cases = _cases(runs, fronts, ceiling) if pilot_ok else []
    record = {
        "schema_version": "1.0.0",
        "status": "pilot_complete" if pilot_ok else "pilot_failed",
        "held_out_results_read": False,
        "checkpoint_id": CHECKPOINT_ID,
        "checkpoint_weights_updated": False,
        "simulator_version": SIMULATOR_VERSION,
        "pilot_instances": [instance_id for _intensity, instance_id in PILOT_INSTANCES],
        "runs_requested": len(PILOT_INSTANCES) * (len(HEURISTIC_IDS) + 1),
        "runs_complete": len(complete),
        "latency_ceiling_s": ceiling,
        "runs": runs,
        "fronts": fronts,
        "cases": cases,
    }
    decision = _decision(record, seeds, ceiling)
    freeze = _freeze(record, seeds, scales, manifest, ceiling) if pilot_ok else None
    return {"pilot_record": record, "decision_log": decision, "design_freeze": freeze}


def _summarize_run(intensity, frozen, manifest, scales, events, record, elapsed, config_id):
    accounting = _accounting_failure(frozen, events, manifest)
    ledger_ok = False
    ledger_total = None
    independent_r = None
    objectives = None
    if record["status"] == "complete" and accounting is None:
        objectives = recompute_objectives(frozen, events, local_node_id=manifest["topology"]["gateway_node_id"])
        ledger = build_ledger(frozen, events, scales)
        independent_r = complete_run_reward(objectives, scales)
        ledger_total = ledger["total"]
        ledger_ok = abs(ledger_total - independent_r) <= ACCOUNTING_TOLERANCE
    return {
        "instance_id": frozen["instance_id"],
        "intensity": intensity,
        "policy_config_id": config_id,
        "run_id": record["run_id"],
        "status": record["status"] if accounting is None else "failed",
        "failure_reason": record["failure_reason"] if accounting is None else accounting,
        "makespan_s": None if objectives is None else objectives["makespan_s"],
        "energy_j": None if objectives is None else objectives["energy_j"],
        "mean_latency_s": None if objectives is None else objectives["mean_latency_s"],
        "ledger_total": ledger_total,
        "independent_R": independent_r,
        "ledger_ok": ledger_ok,
        "accounting_ok": accounting is None and record["status"] == "complete",
        "elapsed_s": elapsed,
        "checkpoint_id": CHECKPOINT_ID if config_id == POLICY_CONFIG_ID else None,
    }


def _accounting_failure(instance, events, manifest):
    nodes = {node["node_id"]: node for node in manifest["topology"]["nodes"]}
    gateway = manifest["topology"]["gateway_node_id"]
    tasks = {task["task_id"]: task for task in instance["tasks"]}
    if [event["task_id"] for event in events] != [task["task_id"] for task in instance["tasks"]]:
        return "event order does not match the frozen task list"
    compute = {node_id: [] for node_id in nodes}
    channel = {node_id: [] for node_id in nodes if node_id != gateway}
    for event in events:
        task = tasks[event["task_id"]]
        destination = event.get("destination_id")
        if destination not in nodes:
            return f"destination outside the four nodes: {destination}"
        if event.get("status") != "complete":
            return event.get("failure_reason") or f"task did not complete: {event['task_id']}"
        node = nodes[destination]
        arrival = task["arrival_s"]
        if destination == gateway:
            if any(event[key] is not None for key in ("upload_start_s", "upload_end_s", "return_start_s", "return_end_s")):
                return f"local task has transfer time: {event['task_id']}"
            if event["transfer_energy_j"] != 0:
                return f"local transfer energy is not 0: {event['task_id']}"
            if event["compute_start_s"] < arrival or event["completion_s"] != event["compute_end_s"]:
                return f"local stage order failed: {event['task_id']}"
            expected = (event["compute_end_s"] - event["compute_start_s"]) * node["active_compute_power_increment_w"]
            if abs(event["compute_energy_j"] - expected) > ACCOUNTING_TOLERANCE:
                return f"compute energy mismatch: {event['task_id']}"
            compute[destination].append((event["compute_start_s"], event["compute_end_s"]))
            continue
        bounds = [event["upload_start_s"], event["upload_end_s"], event["compute_start_s"], event["compute_end_s"], event["return_start_s"], event["return_end_s"]]
        if bounds[0] < arrival or any(left > right for left, right in zip(bounds, bounds[1:])) or event["completion_s"] != event["return_end_s"]:
            return f"nonlocal stage order failed: {event['task_id']}"
        expected_compute = (event["compute_end_s"] - event["compute_start_s"]) * node["active_compute_power_increment_w"]
        expected_transfer = (task["upload_bytes"] + task["return_bytes"]) / 1_000_000 * node["transfer_energy_j_per_mb"]
        if abs(event["compute_energy_j"] - expected_compute) > ACCOUNTING_TOLERANCE or abs(event["transfer_energy_j"] - expected_transfer) > ACCOUNTING_TOLERANCE:
            return f"nonlocal energy mismatch: {event['task_id']}"
        compute[destination].append((event["compute_start_s"], event["compute_end_s"]))
        channel[destination].append((event["upload_start_s"], event["upload_end_s"]))
        channel[destination].append((event["return_start_s"], event["return_end_s"]))
    for intervals in (*compute.values(), *channel.values()):
        if _overlaps(intervals):
            return "FIFO server intervals overlap"
    return None


def _overlaps(intervals) -> bool:
    ordered = sorted(intervals)
    return any(ordered[index][0] < ordered[index - 1][1] - 1e-12 for index in range(1, len(ordered)))


def _compare_archived_heuristic_logs(root, instances, manifest, destinations, scales):
    for _intensity, instance_id in PILOT_INSTANCES:
        frozen = instances[instance_id]
        for config_id, suffix, seed in (("latency-first", "latency-first", None), ("random", "random-11", PROVISIONAL_RANDOM_SEED)):
            path = root / "artifacts" / "workloads" / "provisional" / "events" / f"{instance_id}-{suffix}.jsonl"
            stored = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
            fresh, _record = run_instance(frozen, make_heuristic(config_id, destinations, scales, seed), manifest, event_log_path=f"{suffix}.jsonl")
            if fresh != stored:
                raise RuntimeError(f"Archived pilot log changed: {path.name}")


def _fronts(runs):
    fronts = []
    for intensity, instance_id in PILOT_INSTANCES:
        group = [_pareto_run(run) for run in runs if run["instance_id"] == instance_id]
        classified = classify_all(group, TOLERANCE)
        disagreements = []
        for run in group:
            full = classified["full"][run["run_id"]]["non_dominated"]
            for pair_name, labels in classified["pairs"].items():
                if labels[run["run_id"]]["non_dominated"] != full:
                    disagreements.append({"run_id": run["run_id"], "pair": pair_name, "full_non_dominated": full})
        fronts.append({
            "instance_id": instance_id,
            "intensity": intensity,
            "candidate_count": len(group),
            "full_non_dominated_run_ids": [run_id for run_id, label in classified["full"].items() if label["non_dominated"]],
            "pair_full_disagreements": disagreements,
        })
    return fronts


def _pareto_run(run):
    return {
        "run_id": run["run_id"],
        "instance_id": run["instance_id"],
        "status": "complete",
        "makespan_s": run["makespan_s"],
        "energy_j": run["energy_j"],
        "mean_latency_s": run["mean_latency_s"],
    }


def _latency_ceiling(runs):
    values = [run["mean_latency_s"] for run in runs if run["policy_config_id"] != POLICY_CONFIG_ID]
    ordered = sorted(values)
    midpoint = len(ordered) // 2
    return (ordered[midpoint - 1] + ordered[midpoint]) / 2


def _cases(runs, fronts, ceiling):
    energy_cases = []
    difference_cases = []
    for intensity, instance_id in PILOT_INSTANCES:
        group = [run for run in runs if run["instance_id"] == instance_id]
        eligible = [run for run in group if run["mean_latency_s"] <= ceiling]
        if eligible:
            chosen = sorted(eligible, key=lambda run: (run["energy_j"], run["run_id"]))[0]
            energy_cases.append({"instance_id": instance_id, "selected_run_id": chosen["run_id"], "energy_j": chosen["energy_j"]})
        else:
            energy_cases.append({"instance_id": instance_id, "selected_run_id": None, "energy_j": None})
        dqn = next(run for run in group if run["policy_config_id"] == POLICY_CONFIG_ID)
        difference_cases.append({
            "instance_id": instance_id,
            "intensity": intensity,
            "differences": [
                {
                    "heuristic": run["policy_config_id"],
                    "makespan_s": dqn["makespan_s"] - run["makespan_s"],
                    "energy_j": dqn["energy_j"] - run["energy_j"],
                    "mean_latency_s": dqn["mean_latency_s"] - run["mean_latency_s"],
                }
                for run in group if run["policy_config_id"] != POLICY_CONFIG_ID
            ],
        })
    example = next((item for front in fronts for item in front["pair_full_disagreements"]), None)
    return {
        "energy_under_latency_ceiling": energy_cases,
        "dqn_minus_heuristic": difference_cases,
        "pilot_pair_full_example": example,
    }


def _decision(record, seeds, ceiling):
    checkpoint_rule_changed = False
    entries = [
        {
            "id": "held-out-unread",
            "decision": "Held-out scheduling results were not read or run.",
            "evidence": "Pilot file reads are the three pilot instances, pilot manifest, feature scales, and the provisional checkpoint.",
        },
        {
            "id": "checkpoint-rule",
            "decision": "Keep the pre-registered checkpoint: online weights after training episode 500.",
            "changed": checkpoint_rule_changed,
            "evidence": "Changing it because training episode 500 had high latency would select on training outcomes. Pilot inference is recorded separately and does not replace that rule.",
        },
    ]
    if record["status"] != "pilot_complete":
        failed = [run for run in record["runs"] if run["status"] != "complete" or not run["ledger_ok"] or not run["accounting_ok"]]
        entries.append({
            "id": "pilot-failure",
            "decision": "Do not treat the design as frozen.",
            "evidence": failed,
        })
    else:
        entries.append({
            "id": "pilot-checks",
            "decision": "Adopt the listed simulator, policy, seed, tolerance, and case rules.",
            "evidence": f"{record['runs_complete']} of {record['runs_requested']} pilot runs completed with accounting and reward checks.",
        })
        entries.append({
            "id": "latency-ceiling",
            "decision": "Freeze the latency ceiling as the median of the 18 heuristic pilot mean latencies.",
            "value_s": ceiling,
        })
    return {
        "schema_version": "1.0.0",
        "date": "2026-11-12",
        "held_out_results_read": False,
        "entries": entries,
        "seed_splits": seeds,
    }


def _freeze(record, seeds, scales, manifest, ceiling):
    nodes = []
    for node in manifest["topology"]["nodes"]:
        nodes.append({
            "node_id": node["node_id"],
            "compute_capacity_cycles_per_s": node["compute_capacity_cycles_per_s"],
            "active_compute_power_increment_w": node["active_compute_power_increment_w"],
            "link_rate_bps": node["link_rate_bps"],
            "transfer_energy_j_per_mb": node["transfer_energy_j_per_mb"],
        })
    return {
        "schema_version": "1.0.0",
        "freeze_version": "1",
        "status": "frozen",
        "read_only": True,
        "held_out_results_read_before_freeze": False,
        "approval": {
            "member": "B",
            "date": "2026-11-12",
            "statement": "P9 execution authorization adopts these previously recorded provisional values after the pilot checks passed. The checkpoint rule was not changed.",
        },
        "simulator_version": SIMULATOR_VERSION,
        "numeric_tolerance": TOLERANCE,
        "energy_coefficients": nodes,
        "balanced_scales": scales,
        "heuristic_configs": list(HEURISTIC_IDS),
        "random_seed": PROVISIONAL_RANDOM_SEED,
        "dqn": {
            "policy_config_id": POLICY_CONFIG_ID,
            "checkpoint_id": CHECKPOINT_ID,
            "seed": PROVISIONAL_DQN_SEED,
            "epsilon": 0.1,
            "gamma": 1,
            "learning_rate": 0.001,
            "episodes": 500,
            "target_sync_rule": "After each training episode, copy online weights to the target network.",
            "checkpoint_rule": "Online weights after episode 500. Intermediate weights were not compared.",
            "inference": "greedy, no weight updates",
        },
        "seed_splits": seeds,
        "evaluation": {
            "intensities": ["low", "medium", "high"],
            "held_out_instances_per_intensity": 12,
            "configurations": 7,
            "expected_complete_runs": 252,
        },
        "pareto": {
            "objectives_minimized": ["makespan_s", "energy_j", "mean_latency_s"],
            "official_front_requires_seven_complete_candidates": True,
            "filters_do_not_recompute_the_reference": True,
            "tolerance": TOLERANCE,
        },
        "cases": {
            "energy_under_latency_ceiling": {
                "threshold_s": ceiling,
                "threshold_rule": "Median of the 18 heuristic mean_latency_s values on the three pilot instances.",
                "selection": "Minimum energy_j among runs at or below the threshold; run_id ascending breaks ties. Report none when no run qualifies.",
            },
            "dqn_minus_heuristic": "On one instance, subtract each heuristic M, E, and L from the DQN values and keep the full-space witness when one exists.",
            "pair_versus_full": "Report a run whose pair label differs from its full-space label. On held-out data, take the first such instance in seed order and otherwise report that none exists.",
            "intensity_comparison": "Summarize each intensity separately. Do not place runs from different instances in one Pareto set.",
            "pilot_pair_full_example": record["cases"]["pilot_pair_full_example"],
        },
    }


def _load_pilot_instances(root):
    loaded = {}
    for _intensity, instance_id in PILOT_INSTANCES:
        if "held_out" in instance_id:
            raise ValueError("P9 cannot load a held-out instance")
        path = root / "artifacts" / "workloads" / "provisional" / "pilot" / f"{instance_id}.json"
        frozen = json.loads(path.read_text(encoding="utf-8"))
        if frozen.get("phase") != "pilot" or frozen.get("instance_id") != instance_id:
            raise ValueError(f"P9 refused instance {instance_id}")
        loaded[instance_id] = frozen
    return loaded


def _seed_sets(manifest):
    splits = manifest["seed_splits"]
    training = list(splits["training"])
    pilot = list(splits["pilot"])
    held_out = list(splits["held_out"])
    if training != [1000, 1001, 1002] or pilot != [2000, 2001, 2002]:
        raise ValueError("Training or pilot seeds differ from the recorded provisional split")
    if held_out != list(range(3000, 3036)):
        raise ValueError("Held-out seed list is not the recorded 3000-3035 range")
    if set(training) & set(pilot) or set(training) & set(held_out) or set(pilot) & set(held_out):
        raise ValueError("Training, pilot, and held-out seeds intersect")
    return {"training": training, "pilot": pilot, "held_out": held_out}
