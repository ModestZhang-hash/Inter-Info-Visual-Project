"""Independent pairwise Pareto enumeration.

This file does not import topic3.pareto. It exists so the formal classifier
can be checked against a second implementation. Objectives are minimized.
"""

from __future__ import annotations

OBJECTIVES = ("makespan_s", "energy_j", "mean_latency_s")
PAIRS = (
    ("makespan_s", "energy_j"),
    ("makespan_s", "mean_latency_s"),
    ("energy_j", "mean_latency_s"),
)


def _margin(left: float, right: float, tolerance: dict) -> float:
    return max(tolerance["absolute"], tolerance["relative"] * max(abs(left), abs(right)))


def _relations(witness: dict, target: dict, objectives: tuple[str, ...], tolerance: dict):
    relations = {}
    strictly_better = False
    for key in objectives:
        left = witness[key]
        right = target[key]
        margin = _margin(left, right, tolerance)
        if left > right + margin:
            return None
        if left < right - margin:
            relations[key] = "strict_improvement"
            strictly_better = True
        elif left == right:
            relations[key] = "equal"
        else:
            relations[key] = "equivalent_within_tolerance"
    return relations if strictly_better else None


def enumerate_runs(runs: list[dict], objectives: tuple[str, ...], tolerance: dict) -> dict:
    instances = {run.get("instance_id") for run in runs}
    if len(instances) > 1:
        raise ValueError("Pareto reference set mixes workload instances")
    complete = sorted((run for run in runs if run.get("status") == "complete"), key=lambda run: run["run_id"])
    result = {}
    for target in complete:
        witnesses = []
        for candidate in complete:
            if candidate["run_id"] == target["run_id"]:
                continue
            relations = _relations(candidate, target, objectives, tolerance)
            if relations is None:
                continue
            witnesses.append({
                "witness_run_id": candidate["run_id"],
                "compared_objectives": list(objectives),
                "target_metrics": {key: target[key] for key in OBJECTIVES},
                "witness_metrics": {key: candidate[key] for key in OBJECTIVES},
                "relations": relations,
            })
        result[target["run_id"]] = {
            "non_dominated": not witnesses,
            "witness_run_ids": [entry["witness_run_id"] for entry in witnesses],
            "witnesses": witnesses,
        }
    return result


def enumerate_all(runs: list[dict], tolerance: dict) -> dict:
    return {
        "full": enumerate_runs(runs, OBJECTIVES, tolerance),
        "pairs": {"|".join(pair): enumerate_runs(runs, pair, tolerance) for pair in PAIRS},
    }
