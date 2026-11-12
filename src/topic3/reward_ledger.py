"""Provisional episode reward ledger for one complete run.

R = -[M / s_M + E / s_E + L / s_L] / 3. With gamma = 1, completion credits
sum to that value. Energy and latency for a task are posted only at its
completion. A makespan credit is posted only when a completion raises the
realized maximum above the instance minimum arrival. The ledger consumes an
instance and an event log only; simulator internals and held-out files stay outside it.
"""

from __future__ import annotations

import math
from typing import Mapping, Sequence


class LedgerError(ValueError):
    """The event log cannot be credited as one complete episode."""


GAMMA = 1


def complete_run_reward(objectives: Mapping, scales: Mapping) -> float:
    """Independent full-run target from already recomputed M, E, and L."""
    s_m, s_e, s_l = _scales(scales)
    return -1.0 / 3.0 * (
        _finite(objectives.get("makespan_s"), "makespan_s") / s_m
        + _finite(objectives.get("energy_j"), "energy_j") / s_e
        + _finite(objectives.get("mean_latency_s"), "mean_latency_s") / s_l
    )


def build_ledger(instance: Mapping, events: Sequence[Mapping], scales: Mapping) -> dict:
    """Credit one complete episode. Incomplete logs raise LedgerError."""
    if GAMMA != 1:
        raise LedgerError("This provisional ledger is defined only for gamma = 1")
    s_m, s_e, s_l = _scales(scales)
    tasks = _tasks_by_id(instance)
    by_task = _events_by_task(events, tasks)
    count = len(tasks)
    min_arrival = min(float(task["arrival_s"]) for task in tasks.values())
    ordered = sorted(tasks, key=lambda task_id: (float(by_task[task_id]["completion_s"]), task_id))
    baseline = min_arrival
    entries = []
    for task_id in ordered:
        task = tasks[task_id]
        event = by_task[task_id]
        completion = _finite(event.get("completion_s"), f"completion_s for {task_id}")
        arrival = _finite(task.get("arrival_s"), f"arrival_s for {task_id}")
        if completion < arrival:
            raise LedgerError(f"Completion precedes arrival: {task_id}")
        energy = _finite(event.get("compute_energy_j"), f"compute_energy_j for {task_id}", minimum=0)
        energy += _finite(event.get("transfer_energy_j"), f"transfer_energy_j for {task_id}", minimum=0)
        entries.append(_entry(task_id, completion, "energy", -(energy / s_e) / 3.0))
        entries.append(_entry(task_id, completion, "latency", -((completion - arrival) / (count * s_l)) / 3.0))
        if completion > baseline:
            entries.append(_entry(task_id, completion, "makespan", -((completion - baseline) / s_m) / 3.0))
            baseline = completion
    totals = {"energy": 0.0, "latency": 0.0, "makespan": 0.0}
    for entry in entries:
        totals[entry["component"]] += entry["amount"]
    return {
        "gamma": GAMMA,
        "status": "provisional_not_frozen",
        "entries": entries,
        "component_totals": totals,
        "total": sum(totals.values()),
        "scales": {"s_M": s_m, "s_E": s_e, "s_L": s_l},
    }


def _entry(task_id: str, time_s: float, component: str, amount: float) -> dict:
    return {"task_id": task_id, "time_s": time_s, "component": component, "amount": amount}


def _scales(scales: Mapping) -> tuple[float, float, float]:
    return (
        _finite(scales.get("s_M"), "s_M", minimum=0, positive=True),
        _finite(scales.get("s_E"), "s_E", minimum=0, positive=True),
        _finite(scales.get("s_L"), "s_L", minimum=0, positive=True),
    )


def _tasks_by_id(instance: Mapping) -> dict[str, Mapping]:
    tasks = instance.get("tasks")
    if not isinstance(tasks, list) or not tasks:
        raise LedgerError("Instance tasks are missing")
    by_id = {}
    for task in tasks:
        task_id = task.get("task_id")
        if not isinstance(task_id, str) or not task_id:
            raise LedgerError("task_id is required")
        if task_id in by_id:
            raise LedgerError(f"Duplicate task_id: {task_id}")
        by_id[task_id] = task
    return by_id


def _events_by_task(events: Sequence[Mapping], tasks: Mapping[str, Mapping]) -> dict[str, Mapping]:
    if not isinstance(events, list) or not events:
        raise LedgerError("Event log is missing")
    by_task = {}
    for event in events:
        task_id = event.get("task_id")
        if not isinstance(task_id, str) or not task_id:
            raise LedgerError("event task_id is required")
        if task_id not in tasks:
            raise LedgerError(f"Event task is not in the instance: {task_id}")
        if task_id in by_task:
            raise LedgerError(f"Duplicate event task_id: {task_id}")
        if event.get("status") != "complete":
            raise LedgerError(f"Incomplete task has no reward credit: {task_id}")
        by_task[task_id] = event
    missing = set(tasks) - set(by_task)
    if missing:
        raise LedgerError(f"Event log is missing tasks: {', '.join(sorted(missing))}")
    return by_task


def _finite(value, label: str, minimum: float | None = None, positive: bool = False) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise LedgerError(f"Invalid {label}")
    if minimum is not None and value < minimum:
        raise LedgerError(f"Invalid {label}")
    if positive and value <= 0:
        raise LedgerError(f"Invalid {label}")
    return float(value)
