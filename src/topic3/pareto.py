"""Deterministic Pareto classification for one frozen workload instance.

All objectives are minimized. The comparison margin for two values is
max(absolute_tolerance, relative_tolerance * max(abs(left), abs(right))).
Within-margin differences are treated as equivalent for dominance; at least
one compared objective must be strictly better beyond that margin.
"""

from __future__ import annotations

from math import isfinite
from typing import Mapping, Sequence

OBJECTIVES = ("makespan_s", "energy_j", "mean_latency_s")
PAIRS = (
    ("makespan_s", "energy_j"),
    ("makespan_s", "mean_latency_s"),
    ("energy_j", "mean_latency_s"),
)


def _margin(left: float, right: float, tolerance: Mapping[str, float]) -> float:
    return max(tolerance["absolute"], tolerance["relative"] * max(abs(left), abs(right)))


def _validate_tolerance(tolerance: Mapping[str, float]) -> None:
    for name in ("absolute", "relative"):
        value = tolerance.get(name)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not isfinite(value) or value < 0:
            raise ValueError(f"Invalid numeric tolerance: {name}")


def _metrics(run: Mapping) -> dict[str, float]:
    result = {}
    for key in OBJECTIVES:
        value = run.get(key)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not isfinite(value) or value < 0:
            raise ValueError(f"Invalid {key} for complete run {run.get('run_id')}")
        result[key] = value
    return result


def dominance_relations(
    witness: Mapping, target: Mapping, objectives: Sequence[str], tolerance: Mapping[str, float]
) -> dict[str, str] | None:
    """Return per-axis relations only when witness dominates target."""
    _validate_tolerance(tolerance)
    if not objectives or any(key not in OBJECTIVES for key in objectives):
        raise ValueError("Invalid compared objectives")
    a, b = _metrics(witness), _metrics(target)
    relations = {}
    strictly_better = False
    for key in objectives:
        margin = _margin(a[key], b[key], tolerance)
        if a[key] > b[key] + margin:
            return None
        if a[key] < b[key] - margin:
            relations[key] = "strict_improvement"
            strictly_better = True
        elif a[key] == b[key]:
            relations[key] = "equal"
        else:
            relations[key] = "equivalent_within_tolerance"
    return relations if strictly_better else None


def dominates(witness: Mapping, target: Mapping, objectives: Sequence[str], tolerance: Mapping[str, float]) -> bool:
    return dominance_relations(witness, target, objectives, tolerance) is not None


def classify_runs(runs: Sequence[Mapping], objectives: Sequence[str], tolerance: Mapping[str, float]) -> dict[str, dict]:
    """Classify complete runs; choose the smallest witness run_id first."""
    _validate_tolerance(tolerance)
    instances = {run.get("instance_id") for run in runs}
    if len(instances) > 1:
        raise ValueError("Pareto reference set mixes workload instances")
    ids = [run.get("run_id") for run in runs]
    if any(not isinstance(run_id, str) or not run_id for run_id in ids) or len(set(ids)) != len(ids):
        raise ValueError("Missing or duplicate run_id in reference set")
    complete = sorted((run for run in runs if run.get("status") == "complete"), key=lambda run: run["run_id"])
    for run in complete:
        _metrics(run)
    result = {}
    for target in complete:
        witnesses = []
        for candidate in complete:
            if candidate["run_id"] == target["run_id"]:
                continue
            relations = dominance_relations(candidate, target, objectives, tolerance)
            if relations is not None:
                witnesses.append({
                    "witness_run_id": candidate["run_id"],
                    "compared_objectives": list(objectives),
                    "target_metrics": _metrics(target),
                    "witness_metrics": _metrics(candidate),
                    "relations": relations,
                })
        result[target["run_id"]] = {
            "non_dominated": not witnesses,
            "witness_run_ids": [entry["witness_run_id"] for entry in witnesses],
            "witnesses": witnesses,
        }
    return result


def classify_all(runs: Sequence[Mapping], tolerance: Mapping[str, float]) -> dict[str, dict]:
    return {
        "full": classify_runs(runs, OBJECTIVES, tolerance),
        "pairs": {"|".join(pair): classify_runs(runs, pair, tolerance) for pair in PAIRS},
    }
