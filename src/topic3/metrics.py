"""Independent M, E, and L recalculation from a frozen task list and event log.

This module does not import the simulator. Run-record summaries are not inputs.
A failed or incomplete log raises MetricError and does not return objective values.
"""

from __future__ import annotations

import math
from typing import Mapping, Sequence


class MetricError(ValueError):
    """The log cannot produce makespan, energy, and mean latency."""


def reject_duplicate_run_ids(runs: Sequence[Mapping]) -> None:
    seen = set()
    for run in runs:
        run_id = run.get("run_id")
        if not isinstance(run_id, str) or not run_id:
            raise MetricError("run_id is required")
        if run_id in seen:
            raise MetricError(f"Duplicate run_id: {run_id}")
        seen.add(run_id)


def recompute_objectives(instance: Mapping, events: Sequence[Mapping], *, local_node_id: str) -> dict[str, float]:
    """Return makespan_s, energy_j, and mean_latency_s for one complete run."""
    tasks = _tasks_by_id(instance)
    by_task = _events_by_task(events, tasks)
    completions = []
    arrivals = []
    energy = 0.0
    for task_id, task in tasks.items():
        event = by_task[task_id]
        if event.get("status") != "complete":
            raise MetricError(f"Failed or incomplete event has no objectives: {task_id}")
        completion = _finite(event.get("completion_s"), f"completion_s for {task_id}")
        arrival = _finite(task.get("arrival_s"), f"arrival_s for {task_id}")
        if arrival < 0:
            raise MetricError(f"Negative arrival: {task_id}")
        compute_energy = _finite(event.get("compute_energy_j"), f"compute_energy_j for {task_id}", minimum=0)
        transfer_energy = _finite(event.get("transfer_energy_j"), f"transfer_energy_j for {task_id}", minimum=0)
        _check_stages(event, task_id, local_node_id, completion)
        completions.append(completion)
        arrivals.append(arrival)
        energy += compute_energy + transfer_energy
    count = len(tasks)
    return {
        "makespan_s": max(completions) - min(arrivals),
        "energy_j": energy,
        "mean_latency_s": sum(completion - arrival for completion, arrival in zip(completions, arrivals)) / count,
    }


def _tasks_by_id(instance: Mapping) -> dict[str, Mapping]:
    tasks = instance.get("tasks")
    if not isinstance(tasks, list) or not tasks:
        raise MetricError("Instance tasks are missing")
    by_id = {}
    for task in tasks:
        task_id = task.get("task_id")
        if not isinstance(task_id, str) or not task_id:
            raise MetricError("task_id is required")
        if task_id in by_id:
            raise MetricError(f"Duplicate task_id: {task_id}")
        by_id[task_id] = task
    return by_id


def _events_by_task(events: Sequence[Mapping], tasks: Mapping[str, Mapping]) -> dict[str, Mapping]:
    if not isinstance(events, list) or not events:
        raise MetricError("Event log is missing")
    by_task = {}
    for event in events:
        task_id = event.get("task_id")
        if not isinstance(task_id, str) or not task_id:
            raise MetricError("event task_id is required")
        if task_id not in tasks:
            raise MetricError(f"Event task is not in the instance: {task_id}")
        if task_id in by_task:
            raise MetricError(f"Duplicate event task_id: {task_id}")
        by_task[task_id] = event
    missing = set(tasks) - set(by_task)
    if missing:
        raise MetricError(f"Event log is missing tasks: {', '.join(sorted(missing))}")
    return by_task


def _check_stages(event: Mapping, task_id: str, local_node_id: str, completion: float) -> None:
    destination = event.get("destination_id")
    if not isinstance(destination, str) or not destination:
        raise MetricError(f"destination_id is required: {task_id}")
    if destination == local_node_id:
        for key in ("upload_start_s", "upload_end_s", "return_start_s", "return_end_s"):
            if event.get(key) is not None:
                raise MetricError(f"Local task has transfer time: {task_id}")
        if event.get("transfer_energy_j") != 0:
            raise MetricError(f"Local transfer energy must be 0: {task_id}")
        compute_end = _finite(event.get("compute_end_s"), f"compute_end_s for {task_id}")
        if compute_end != completion:
            raise MetricError(f"Local completion must equal compute end: {task_id}")
        return
    for key in ("upload_start_s", "upload_end_s", "compute_start_s", "compute_end_s", "return_start_s", "return_end_s"):
        _finite(event.get(key), f"{key} for {task_id}")
    if event.get("return_end_s") != completion:
        raise MetricError(f"Nonlocal completion must equal return end: {task_id}")


def _finite(value, label: str, minimum: float | None = None) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise MetricError(f"Invalid {label}")
    if minimum is not None and value < minimum:
        raise MetricError(f"Invalid {label}")
    return float(value)
