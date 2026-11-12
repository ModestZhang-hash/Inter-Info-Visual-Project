"""Paired summaries and the four frozen held-out cases.

Differences are DQN minus heuristic on one instance. Quartiles split a sorted
even-sized sample into two halves and take each half's median. No held-out
instance is chosen for the single-instance DQN case, because the freeze did
not name one. The pair-versus-full case uses the first held-out seed whose
archived labels disagree.
"""

from __future__ import annotations

import json
from pathlib import Path

from topic3.pareto import OBJECTIVES, classify_all, dominance_relations
from topic3.policies import HEURISTIC_IDS

THRESHOLD_S = 1.5315414806069878
CASE_INSTANCE_UNREGISTERED = "instance_not_preregistered"
SHORT = {"makespan_s": "M", "energy_j": "E", "mean_latency_s": "L"}


def analyze_p11(root: Path) -> dict:
    objectives = json.loads((root / "artifacts" / "workloads" / "provisional" / "p10_held_out" / "objectives.json").read_text(encoding="utf-8"))
    pareto = json.loads((root / "artifacts" / "workloads" / "provisional" / "p10_held_out" / "pareto.json").read_text(encoding="utf-8"))
    failures = json.loads((root / "artifacts" / "workloads" / "provisional" / "p10_held_out" / "failures.json").read_text(encoding="utf-8"))
    freeze = json.loads((root / "configs" / "freeze" / "design_freeze_v1.json").read_text(encoding="utf-8"))
    if freeze["cases"]["energy_under_latency_ceiling"]["threshold_s"] != THRESHOLD_S:
        raise ValueError("P11 refused a latency ceiling that differs from the frozen value")
    if pareto.get("pooled_instances") is not False:
        raise ValueError("P11 refused a pooled Pareto archive")
    runs = objectives["runs"]
    by_instance = {}
    for run in runs:
        by_instance.setdefault(run["instance_id"], []).append(run)
    differences = []
    for instance_id, group in by_instance.items():
        dqn = _one(group, "dqn-fixed")
        for heuristic in HEURISTIC_IDS:
            other = _one(group, heuristic)
            differences.append({
                "instance_id": instance_id,
                "intensity": _intensity(instance_id),
                "heuristic": heuristic,
                "dqn_run_id": dqn["run_id"],
                "heuristic_run_id": other["run_id"],
                "makespan_s": dqn["makespan_s"] - other["makespan_s"],
                "energy_j": dqn["energy_j"] - other["energy_j"],
                "mean_latency_s": dqn["mean_latency_s"] - other["mean_latency_s"],
            })
    return {
        "schema_version": "1.0.0",
        "source": "artifacts/workloads/provisional/p10_held_out",
        "failure_count": failures["failure_count"],
        "bootstrap_intervals": False,
        "pooled_pareto": False,
        "paired_differences": differences,
        "paired_summaries": _summaries(differences),
        "non_dominated_counts": _counts(pareto, runs),
        "cases": {
            "energy_under_latency_ceiling": _energy_cases(by_instance, THRESHOLD_S),
            "dqn_versus_heuristics_on_one_instance": {
                "status": CASE_INSTANCE_UNREGISTERED,
                "statement": "The freeze describes this case on one instance but does not name a held-out instance. No instance was selected after the held-out results were known.",
            },
            "pair_versus_full": _pair_case(pareto, by_instance),
            "intensity_comparison": _intensity_comparison(pareto, differences),
        },
    }


def median(values: list[float]) -> float:
    ordered = sorted(values)
    midpoint = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[midpoint]
    return (ordered[midpoint - 1] + ordered[midpoint]) / 2


def quartile_span(values: list[float]) -> dict:
    ordered = sorted(values)
    half = len(ordered) // 2
    if half == 0 or len(ordered) != half * 2:
        raise ValueError("Quartiles are defined here for a non-empty even-sized sample")
    lower = median(ordered[:half])
    upper = median(ordered[half:])
    return {"n": len(ordered), "q1": lower, "median": median(ordered), "q3": upper, "iqr": upper - lower}


def _summaries(differences):
    rows = []
    intensities = ("low", "medium", "high")
    for intensity in intensities:
        for heuristic in HEURISTIC_IDS:
            group = [row for row in differences if row["intensity"] == intensity and row["heuristic"] == heuristic]
            entry = {"intensity": intensity, "heuristic": heuristic, "instance_ids": [row["instance_id"] for row in group]}
            for key in OBJECTIVES:
                entry[key] = quartile_span([row[key] for row in group])
            rows.append(entry)
    return rows


def _counts(pareto, runs):
    policies = {run["run_id"]: run["policy_config_id"] for run in runs}
    counts = {policy: [] for policy in (*HEURISTIC_IDS, "dqn-fixed")}
    for instance in pareto["instances"]:
        for run_id, label in instance["full"].items():
            if label["non_dominated"]:
                counts[policies[run_id]].append(instance["instance_id"])
    return {
        "space": "full",
        "instance_count": len(pareto["instances"]),
        "by_policy": [{"policy_config_id": policy, "count": len(ids), "instance_ids": ids} for policy, ids in counts.items()],
    }


def _energy_cases(by_instance, threshold):
    rows = []
    for instance_id in sorted(by_instance, key=_seed):
        eligible = [run for run in by_instance[instance_id] if run["mean_latency_s"] <= threshold]
        chosen = sorted(eligible, key=lambda run: (run["energy_j"], run["run_id"]))[0] if eligible else None
        rows.append({
            "instance_id": instance_id,
            "threshold_s": threshold,
            "eligible_run_ids": [run["run_id"] for run in sorted(eligible, key=lambda run: run["run_id"])],
            "selected_run_id": None if chosen is None else chosen["run_id"],
            "energy_j": None if chosen is None else chosen["energy_j"],
            "mean_latency_s": None if chosen is None else chosen["mean_latency_s"],
        })
    return rows


def _pair_case(pareto, by_instance):
    ordered = sorted(pareto["instances"], key=lambda item: _seed(item["instance_id"]))
    selected = next((item for item in ordered if item["pair_full_disagreements"]), None)
    if selected is None:
        return {"status": "no_disagreement", "instance_id": None}
    disagreement = selected["pair_full_disagreements"][0]
    group = by_instance[selected["instance_id"]]
    pair = tuple(disagreement["pair"].split("|"))
    third = next(key for key in OBJECTIVES if key not in pair)
    classified = classify_all(group, {"absolute": 1e-9, "relative": 1e-9})
    witnesses = classified["pairs"][disagreement["pair"]][disagreement["run_id"]]["witness_run_ids"]
    witness_id = witnesses[0]
    target = _run(group, disagreement["run_id"])
    witness = _run(group, witness_id)
    relation = dominance_relations(witness, target, [third], {"absolute": 1e-9, "relative": 1e-9})
    if relation is not None:
        raise ValueError("The pair witness is also better on the third objective")
    return {
        "status": "reported",
        "instance_id": selected["instance_id"],
        "run_id": disagreement["run_id"],
        "pair": disagreement["pair"],
        "pair_non_dominated": False,
        "full_non_dominated": disagreement["full_non_dominated"],
        "third_objective": third,
        "target_value": target[third],
        "witness_run_id": witness_id,
        "witness_value": witness[third],
        "explanation": (
            f"{disagreement['run_id']} is dominated on {disagreement['pair']} by {witness_id}. "
            f"It remains non-dominated in the full space because {SHORT[third]} is {target[third]} "
            f"for this run and {witness[third]} for the witness; lower is better, and the witness is not strictly better on {SHORT[third]}."
        ),
    }


def _intensity_comparison(pareto, differences):
    rows = []
    for intensity in ("low", "medium", "high"):
        fronts = [item for item in pareto["instances"] if item["intensity"] == intensity]
        rows.append({
            "intensity": intensity,
            "instance_ids": [item["instance_id"] for item in fronts],
            "paired_summaries": [row for row in _summaries(differences) if row["intensity"] == intensity],
            "within_instance_fronts": [
                {
                    "instance_id": item["instance_id"],
                    "full_non_dominated_run_ids": [run_id for run_id, label in item["full"].items() if label["non_dominated"]],
                }
                for item in fronts
            ],
        })
    return rows


def _one(group, policy_id):
    matches = [run for run in group if run["policy_config_id"] == policy_id]
    if len(matches) != 1:
        raise ValueError(f"Expected one {policy_id} run")
    return matches[0]


def _run(group, run_id):
    return next(run for run in group if run["run_id"] == run_id)


def _seed(instance_id: str) -> int:
    return int(instance_id.rsplit("-", 1)[1])


def _intensity(instance_id: str) -> str:
    seed = _seed(instance_id)
    if 3000 <= seed <= 3011:
        return "low"
    if 3012 <= seed <= 3023:
        return "medium"
    if 3024 <= seed <= 3035:
        return "high"
    raise ValueError(f"Instance is outside the held-out seeds: {instance_id}")
