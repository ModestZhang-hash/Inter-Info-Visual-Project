"""Provisional Balanced scales from training and pilot logs only.

s_M is the mean run makespan. s_E is the mean per-task compute-plus-transfer
energy. s_L is the mean per-task completion minus arrival. Held-out runs are
not read. These scales are not a design freeze.
"""

from __future__ import annotations

import json
from pathlib import Path

SCALE_INSTANCES = (
    ("training", "low", 1000),
    ("training", "medium", 1001),
    ("training", "high", 1002),
    ("pilot", "low", 2000),
    ("pilot", "medium", 2001),
    ("pilot", "high", 2002),
)
SCALE_POLICIES = ("latency-first", "random-11")


def scale_run_ids() -> list[str]:
    names = []
    for phase, intensity, seed in SCALE_INSTANCES:
        if phase not in ("training", "pilot"):
            raise ValueError("Balanced scales cannot use held-out instances")
        for policy in SCALE_POLICIES:
            names.append(f"provisional-{phase}-{intensity}-{seed}-{policy}")
    return names


def derive_balanced_scales(root: Path) -> dict:
    latencies = []
    energies = []
    makespans = []
    for phase, intensity, seed in SCALE_INSTANCES:
        instance_name = f"provisional-{phase}-{intensity}-{seed}"
        frozen = json.loads((root / "artifacts" / "workloads" / "provisional" / phase / f"{instance_name}.json").read_text(encoding="utf-8"))
        arrivals = {task["task_id"]: task["arrival_s"] for task in frozen["tasks"]}
        for policy in SCALE_POLICIES:
            run_id = f"{instance_name}-{policy}"
            if "held_out" in run_id:
                raise ValueError("Held-out run entered the scale calculation")
            record = json.loads((root / "artifacts" / "workloads" / "provisional" / "run_records" / f"{run_id}.json").read_text(encoding="utf-8"))
            events = [json.loads(line) for line in (root / "artifacts" / "workloads" / "provisional" / "events" / f"{run_id}.jsonl").read_text(encoding="utf-8").splitlines()]
            makespans.append(record["makespan_s"])
            for event in events:
                latencies.append(event["completion_s"] - arrivals[event["task_id"]])
                energies.append(event["compute_energy_j"] + event["transfer_energy_j"])
    return {
        "status": "provisional_not_frozen",
        "held_out_used": False,
        "s_M": sum(makespans) / len(makespans),
        "s_E": sum(energies) / len(energies),
        "s_L": sum(latencies) / len(latencies),
        "source_run_ids": scale_run_ids(),
        "definitions": {
            "s_M": "mean makespan_s of the listed training and pilot runs",
            "s_E": "mean per-task compute_energy_j + transfer_energy_j in those runs",
            "s_L": "mean per-task completion_s - arrival_s in those runs",
        },
    }
