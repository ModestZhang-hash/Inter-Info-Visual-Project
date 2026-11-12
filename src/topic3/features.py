"""Provisional DQN decision-feature scales from training and pilot instances.

Time features are divided by the existing provisional s_M. Projected task
energy is divided by the existing provisional s_E. Queue lengths stay raw.
Held-out instances are not read. These scales are not a design freeze.
"""

from __future__ import annotations

import json
from pathlib import Path

from topic3.scales import SCALE_INSTANCES


def feature_instance_ids() -> list[str]:
    names = []
    for phase, _intensity, seed in SCALE_INSTANCES:
        if phase not in ("training", "pilot"):
            raise ValueError("Decision-feature scales cannot use held-out instances")
        name = f"provisional-{phase}-{_intensity}-{seed}"
        if "held_out" in name:
            raise ValueError("Held-out instance entered the feature-scale calculation")
        names.append(name)
    return names


def derive_feature_config(root: Path) -> dict:
    cycles = []
    uploads = []
    returns = []
    for phase, intensity, seed in SCALE_INSTANCES:
        instance_id = f"provisional-{phase}-{intensity}-{seed}"
        if phase not in ("training", "pilot") or "held_out" in instance_id:
            raise ValueError("Held-out instance entered the feature-scale calculation")
        path = root / "artifacts" / "workloads" / "provisional" / phase / f"{instance_id}.json"
        frozen = json.loads(path.read_text(encoding="utf-8"))
        if frozen.get("phase") not in ("training", "pilot"):
            raise ValueError(f"Feature scales refused phase {frozen.get('phase')}")
        for task in frozen["tasks"]:
            cycles.append(task["compute_cycles"])
            uploads.append(task["upload_bytes"])
            returns.append(task["return_bytes"])
    scales = json.loads((root / "configs" / "provisional" / "balanced_scales.json").read_text(encoding="utf-8"))
    for key in ("s_M", "s_E", "s_L"):
        value = scales[key]
        if isinstance(value, bool) or not isinstance(value, (int, float)) or value <= 0:
            raise ValueError(f"Feature config requires a positive {key}")
    if scales.get("held_out_used") is not False:
        raise ValueError("Feature config refused scales that used held-out runs")
    return {
        "schema_version": "1.0.0",
        "status": "provisional_not_frozen",
        "held_out_used": False,
        "gamma": 1,
        "s_M": scales["s_M"],
        "s_E": scales["s_E"],
        "s_L": scales["s_L"],
        "compute_cycles_scale": max(cycles),
        "upload_bytes_scale": max(uploads),
        "return_bytes_scale": max(returns),
        "source_instance_ids": feature_instance_ids(),
        "scale_source": "configs/provisional/balanced_scales.json",
        "definitions": {
            "compute_cycles_scale": "maximum compute_cycles across tasks in the listed training and pilot instances",
            "upload_bytes_scale": "maximum upload_bytes across those tasks",
            "return_bytes_scale": "maximum return_bytes across those tasks",
            "time": "cpu_remaining_busy_s, channel_remaining_busy_s, and projected_completion_s are divided by s_M",
            "energy": "projected_task_energy_j is divided by s_E",
            "queue_length": "raw count of waiting jobs; the running job is not included",
        },
        "note": "Three training instances (seeds 1000-1002) and three pilot instances (seeds 2000-2002). Held-out instances are not read. Queue lengths stay raw. Values are provisional_not_frozen.",
    }


def normalize_decision_features(features: dict, config: dict) -> dict:
    """Apply provisional scales. Queue lengths remain raw counts."""
    s_m = _positive(config["s_M"], "s_M")
    s_e = _positive(config["s_E"], "s_E")
    cycle_scale = _positive(config["compute_cycles_scale"], "compute_cycles_scale")
    upload_scale = _positive(config["upload_bytes_scale"], "upload_bytes_scale")
    return_scale = _positive(config["return_bytes_scale"], "return_bytes_scale")
    nodes = []
    for node in features["nodes"]:
        completion = node["projected_completion_s"]
        energy = node["projected_task_energy_j"]
        nodes.append({
            "node_id": node["node_id"],
            "cpu_queue_length": node["cpu_queue_length"],
            "channel_queue_length": node["channel_queue_length"],
            "cpu_remaining_busy_normalized": node["cpu_remaining_busy_s"] / s_m,
            "channel_remaining_busy_normalized": node["channel_remaining_busy_s"] / s_m,
            "projected_completion_normalized": None if completion is None else completion / s_m,
            "projected_task_energy_normalized": None if energy is None else energy / s_e,
        })
    return {
        "task_id": features["task_id"],
        "compute_cycles_normalized": features["compute_cycles"] / cycle_scale,
        "upload_bytes_normalized": features["upload_bytes"] / upload_scale,
        "return_bytes_normalized": features["return_bytes"] / return_scale,
        "nodes": nodes,
    }


def _positive(value, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value <= 0:
        raise ValueError(f"{label} must be positive")
    return float(value)
