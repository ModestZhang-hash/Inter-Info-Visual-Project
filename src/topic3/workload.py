"""Provisional frozen-workload generator for Topic 3 P1.

Given one manifest and one recorded seed, this writes one WorkloadInstance.
The same manifest and seed replay the same task list. No policy identifier
is accepted, so a later scheduler cannot resample the stream.

The distribution is the revised proposal's provisional pilot assumption:
80 tasks, integer compute cycles uniform on 0.5–2.0 gigacycles, integer
upload bytes uniform on 0.5–2.0 MB, and return bytes stored as
``upload_bytes // 10``. Low, medium, and high use exponential gaps after a
first arrival at 0 s. The gap mean is the discrete-uniform mean service time
on the aggregate edge capacity, divided by the offered-load target 0.35,
0.70, or 1.05. These archives are not a design freeze and not pilot results.
"""

from __future__ import annotations

import json
import math
from fractions import Fraction
from pathlib import Path
from typing import Mapping

SCHEMA_VERSION = "1.0.0"
GENERATOR_VERSION = "topic3-workload-provisional-1"
INTENSITIES = ("low", "medium", "high")
PHASES = ("training", "pilot", "held_out")
TASK_COUNT = 80
COMPUTE_MIN = 500_000_000
COMPUTE_MAX = 2_000_000_000
UPLOAD_MIN = 500_000
UPLOAD_MAX = 2_000_000
ENVIRONMENT_SEED = 7
STREAMS_PER_INTENSITY = {"training": 1, "pilot": 1, "held_out": 12}
SEED_BASE = {"training": 1000, "pilot": 2000, "held_out": 3000}
OFFERED_LOAD = {
    "low": Fraction(7, 20),
    "medium": Fraction(7, 10),
    "high": Fraction(21, 20),
}
_MASK64 = (1 << 64) - 1
_UINT64 = 18446744073709551616.0


def canonical_json(value) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n"


def _reject_bool(value, label: str) -> None:
    if isinstance(value, bool):
        raise ValueError(f"{label} must not be a boolean")


def _nonnegative_int(value, label: str) -> int:
    _reject_bool(value, label)
    if not isinstance(value, int) or value < 0:
        raise ValueError(f"{label} must be a non-negative integer")
    return value


def _positive_number(value, label: str) -> int | float:
    _reject_bool(value, label)
    if not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
        raise ValueError(f"{label} must be a positive finite number")
    return value


def _nonnegative_number(value, label: str) -> int | float:
    _reject_bool(value, label)
    if not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
        raise ValueError(f"{label} must be a non-negative finite number")
    return value


def phase_seeds(phase: str) -> list[int]:
    if phase not in STREAMS_PER_INTENSITY:
        raise ValueError(f"Unknown workload phase: {phase}")
    count = STREAMS_PER_INTENSITY[phase] * len(INTENSITIES)
    base = SEED_BASE[phase]
    return list(range(base, base + count))


def assert_disjoint_seeds(seed_splits: Mapping) -> None:
    """Reject duplicate or cross-phase task-generation seeds."""
    seen: dict[int, str] = {}
    for phase in ("fixture", *PHASES):
        if phase not in seed_splits:
            raise ValueError(f"Missing seed split: {phase}")
        values = seed_splits[phase]
        if not isinstance(values, list):
            raise ValueError(f"Seed split {phase} must be a list")
        for seed in values:
            checked = _nonnegative_int(seed, f"{phase} seed")
            if checked in seen:
                raise ValueError(f"Seed collision: {checked} is in both {seen[checked]} and {phase}")
            seen[checked] = phase
    if ENVIRONMENT_SEED in seen:
        raise ValueError("Task-generation seeds must not reuse the fixed environment seed")


def seeds_for_intensity(manifest: Mapping, intensity: str) -> list[int]:
    if intensity not in INTENSITIES:
        raise ValueError(f"Unknown intensity: {intensity}")
    phase = manifest["phase"]
    if phase not in STREAMS_PER_INTENSITY:
        raise ValueError(f"Manifest phase cannot generate a provisional stream: {phase}")
    per_intensity = manifest["seed_assignment"]["per_intensity"][phase]
    if per_intensity != STREAMS_PER_INTENSITY[phase]:
        raise ValueError("Seed assignment does not match the provisional stream count")
    seeds = manifest["seed_splits"][phase]
    expected = per_intensity * len(INTENSITIES)
    if len(seeds) != expected:
        raise ValueError(f"{phase} seed list length is {len(seeds)}, expected {expected}")
    index = INTENSITIES.index(intensity)
    return list(seeds[index * per_intensity:(index + 1) * per_intensity])


def _splitmix64(state: int) -> tuple[int, int]:
    state = (state + 0x9E3779B97F4A7C15) & _MASK64
    z = state
    z = ((z ^ (z >> 30)) * 0xBF58476D1CE4E5B9) & _MASK64
    z = ((z ^ (z >> 27)) * 0x94D049BB133111EB) & _MASK64
    z = (z ^ (z >> 31)) & _MASK64
    return state, z


def _uniform_int(state: int, low: int, high: int) -> tuple[int, int]:
    span = high - low + 1
    if span <= 0:
        raise ValueError("Uniform range is empty")
    limit = (_MASK64 + 1) // span * span
    while True:
        state, draw = _splitmix64(state)
        if draw < limit:
            return state, low + draw % span


def _unit_interval(state: int) -> tuple[int, float]:
    state, draw = _splitmix64(state)
    return state, (draw + 0.5) / _UINT64


def _mean_interarrival_s(manifest: Mapping, intensity: str) -> float:
    distribution = manifest["workload_distribution"]
    edges = [node for node in manifest["topology"]["nodes"] if node["kind"] == "edge"]
    if len(edges) != 3:
        raise ValueError("Provisional topology must contain three edge nodes")
    aggregate = sum(node["compute_capacity_cycles_per_s"] for node in edges)
    compute = distribution["compute_cycles"]
    mean_cycles = Fraction(int(compute["min"]) + int(compute["max"]), 2)
    load = Fraction(distribution["offered_load_by_intensity"][intensity]["numerator"], distribution["offered_load_by_intensity"][intensity]["denominator"])
    if load != OFFERED_LOAD[intensity]:
        raise ValueError(f"Offered load for {intensity} is not the provisional target")
    return float(mean_cycles / aggregate / load)


def validate_workload_instance(instance: Mapping) -> None:
    """Check the contract fields for one frozen task list."""
    if instance.get("schema_version") != SCHEMA_VERSION:
        raise ValueError("Unsupported workload schema_version")
    for key in ("instance_id", "manifest_id", "phase", "intensity_label"):
        if not isinstance(instance.get(key), str) or not instance.get(key):
            raise ValueError(f"Missing {key}")
    _nonnegative_int(instance.get("environment_seed"), "environment_seed")
    _nonnegative_int(instance.get("task_generation_seed"), "task_generation_seed")
    tasks = instance.get("tasks")
    if not isinstance(tasks, list) or not tasks:
        raise ValueError("A workload instance needs a non-empty task list")
    seen = set()
    order = []
    for task in tasks:
        task_id = task.get("task_id")
        if not isinstance(task_id, str) or not task_id:
            raise ValueError("Each task needs a task_id")
        if task_id in seen:
            raise ValueError(f"Duplicate task_id: {task_id}")
        seen.add(task_id)
        arrival = _nonnegative_number(task.get("arrival_s"), "arrival_s")
        _positive_number(task.get("compute_cycles"), "compute_cycles")
        _nonnegative_int(task.get("upload_bytes"), "upload_bytes")
        _nonnegative_int(task.get("return_bytes"), "return_bytes")
        order.append((arrival, task_id))
    if order != sorted(order):
        raise ValueError("Tasks must be ordered by arrival_s, then task_id")


def generate_instance(manifest: Mapping, intensity: str, task_generation_seed: int) -> dict:
    """Replay one frozen stream. The arguments do not include a policy."""
    if manifest.get("workload_distribution", {}).get("kind") != "provisional_synthetic_v1":
        raise ValueError("Manifest is not the provisional P1 workload distribution")
    assert_disjoint_seeds(manifest["seed_splits"])
    allowed = seeds_for_intensity(manifest, intensity)
    seed = _nonnegative_int(task_generation_seed, "task_generation_seed")
    if seed not in allowed:
        raise ValueError(f"Seed {seed} is not assigned to {manifest['phase']} {intensity}")
    distribution = manifest["workload_distribution"]
    if distribution["task_count"] != TASK_COUNT or distribution["first_arrival_s"] != 0:
        raise ValueError("Provisional stream length or first arrival was changed")
    compute = distribution["compute_cycles"]
    upload = distribution["upload_bytes"]
    if (compute["min"], compute["max"]) != (COMPUTE_MIN, COMPUTE_MAX):
        raise ValueError("Provisional compute range was changed")
    if (upload["min"], upload["max"]) != (UPLOAD_MIN, UPLOAD_MAX):
        raise ValueError("Provisional upload range was changed")
    if distribution["return_bytes"]["rule"] != "upload_bytes // 10":
        raise ValueError("Return bytes must be the stored integer upload_bytes // 10")
    mean_gap = _mean_interarrival_s(manifest, intensity)
    phase = manifest["phase"]
    state = seed
    tasks = []
    previous = 0.0
    for index in range(1, TASK_COUNT + 1):
        if index == 1:
            arrival = 0.0
        else:
            state, unit = _unit_interval(state)
            previous += -mean_gap * math.log(1.0 - unit)
            arrival = previous
        state, cycles = _uniform_int(state, COMPUTE_MIN, COMPUTE_MAX)
        state, uploaded = _uniform_int(state, UPLOAD_MIN, UPLOAD_MAX)
        tasks.append({
            "task_id": f"task-{index:03d}",
            "arrival_s": arrival,
            "compute_cycles": cycles,
            "upload_bytes": uploaded,
            "return_bytes": uploaded // 10,
        })
    tasks.sort(key=lambda task: (task["arrival_s"], task["task_id"]))
    instance = {
        "schema_version": SCHEMA_VERSION,
        "instance_id": f"provisional-{phase}-{intensity}-{seed}",
        "manifest_id": manifest["manifest_id"],
        "phase": phase,
        "intensity_label": intensity,
        "environment_seed": ENVIRONMENT_SEED,
        "task_generation_seed": seed,
        "tasks": tasks,
    }
    validate_workload_instance(instance)
    return instance


def _topology() -> dict:
    return {
        "gateway_node_id": "edge-0",
        "nodes": [
            {"node_id": "edge-0", "kind": "edge", "compute_capacity_cycles_per_s": 2_000_000_000, "active_compute_power_increment_w": 5, "link_rate_bps": None, "transfer_energy_j_per_mb": None},
            {"node_id": "edge-1", "kind": "edge", "compute_capacity_cycles_per_s": 3_000_000_000, "active_compute_power_increment_w": 6, "link_rate_bps": 30_000_000, "transfer_energy_j_per_mb": 0.2},
            {"node_id": "edge-2", "kind": "edge", "compute_capacity_cycles_per_s": 4_000_000_000, "active_compute_power_increment_w": 7, "link_rate_bps": 30_000_000, "transfer_energy_j_per_mb": 0.2},
            {"node_id": "cloud-0", "kind": "cloud", "compute_capacity_cycles_per_s": 8_000_000_000, "active_compute_power_increment_w": 10, "link_rate_bps": 10_000_000, "transfer_energy_j_per_mb": 0.3},
        ],
    }


def _policies() -> list[dict]:
    return [
        {"policy_config_id": "random", "family": "random", "parameters": {}},
        {"policy_config_id": "latency-first", "family": "latency-first", "parameters": {}},
        {"policy_config_id": "energy-first", "family": "energy-first", "parameters": {}},
        {"policy_config_id": "balanced-equal", "family": "balanced", "parameters": {"weights": {"makespan": "1/3", "energy": "1/3", "latency": "1/3"}}},
        {"policy_config_id": "balanced-makespan", "family": "balanced", "parameters": {"weights": {"makespan": "0.6", "energy": "0.2", "latency": "0.2"}}},
        {"policy_config_id": "balanced-energy", "family": "balanced", "parameters": {"weights": {"makespan": "0.2", "energy": "0.6", "latency": "0.2"}}},
        {"policy_config_id": "dqn-fixed", "family": "dqn", "parameters": {"hidden_units": [64, 64], "max_complete_episodes": 500, "gamma": "1"}},
    ]


def build_phase_manifest(phase: str, instance_paths: list[str] | None = None) -> dict:
    if phase not in PHASES:
        raise ValueError(f"Unknown workload phase: {phase}")
    splits = {name: phase_seeds(name) for name in PHASES}
    splits["fixture"] = []
    assert_disjoint_seeds(splits)
    return {
        "schema_version": SCHEMA_VERSION,
        "manifest_id": f"provisional-workload-{phase}-v1",
        "phase": phase,
        "provisional_status": {
            "design_freeze": False,
            "pilot_results": False,
            "held_out_results": False,
            "note": "P1 generator output. Distribution values are the revised proposal's provisional assumptions, not a frozen design and not measured pilot results. Power and transfer-energy numbers are contract fields carried so the manifest can be read; this generator does not use them.",
        },
        "topology": _topology(),
        "queue_rules": {
            "assignment_at": "task_arrival",
            "compute_queue": "FIFO_single_server_per_node",
            "transfer_queue": "FIFO_single_channel_per_nonlocal_node",
            "preemption": False,
            "reassignment": False,
            "future_arrivals_visible": False,
            "nonlocal_return_required": True,
        },
        "workload_distribution": {
            "kind": "provisional_synthetic_v1",
            "rng": "splitmix64-v1",
            "task_count": TASK_COUNT,
            "first_arrival_s": 0,
            "later_gaps": "exponential",
            "compute_cycles": {"distribution": "uniform_integer_inclusive", "min": COMPUTE_MIN, "max": COMPUTE_MAX, "unit": "cycles", "gigacycle": 1_000_000_000},
            "upload_bytes": {"distribution": "uniform_integer_inclusive", "min": UPLOAD_MIN, "max": UPLOAD_MAX, "unit": "bytes", "mb": 1_000_000},
            "return_bytes": {"rule": "upload_bytes // 10", "unit": "bytes"},
            "offered_load_by_intensity": {
                name: {"numerator": load.numerator, "denominator": load.denominator, "decimal": f"{float(load):.2f}"}
                for name, load in OFFERED_LOAD.items()
            },
            "offered_load_reference": "mean discrete-uniform compute cycles divided by aggregate edge cycles per second, then divided by the offered-load target",
            "draw_order_after_first": ["interarrival_u", "compute_cycles", "upload_bytes"],
        },
        "seed_splits": splits,
        "seed_assignment": {
            "intensities": list(INTENSITIES),
            "per_intensity": dict(STREAMS_PER_INTENSITY),
            "rule": "Within a phase, seeds are grouped low, then medium, then high. Each seed is used once. Held-out uses the proposal's provisional 12 streams per intensity. Training and pilot use one stream per intensity so those splits are non-empty and disjoint; that count is not a frozen sample size.",
            "environment_seed": ENVIRONMENT_SEED,
        },
        "policy_configs": _policies(),
        "software_versions": {"generator": GENERATOR_VERSION, "simulator": None, "metrics_calculator": None},
        "numeric_tolerance": {"absolute": 1e-9, "relative": 1e-9, "status": "provisional_not_frozen"},
        "raw_data_paths": {"instances": instance_paths or [], "runs": [], "event_logs": []},
    }


def write_provisional_archive(root: Path) -> None:
    """Write the three phase manifests and every frozen instance they name."""
    configs = root / "configs" / "provisional"
    configs.mkdir(parents=True, exist_ok=True)
    for phase in PHASES:
        manifest = build_phase_manifest(phase)
        relative_paths = []
        for intensity in INTENSITIES:
            for seed in seeds_for_intensity(manifest, intensity):
                instance = generate_instance(manifest, intensity, seed)
                relative_paths.append(f"../../artifacts/workloads/provisional/{phase}/{instance['instance_id']}.json")
                target = root / "artifacts" / "workloads" / "provisional" / phase / f"{instance['instance_id']}.json"
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(canonical_json(instance), encoding="utf-8")
        manifest = build_phase_manifest(phase, relative_paths)
        (configs / f"{phase}.json").write_text(canonical_json(manifest), encoding="utf-8")
        written = root / "artifacts" / "workloads" / "provisional" / phase
        named = {Path(path).name for path in relative_paths}
        for path in written.glob("*.json"):
            if path.name not in named:
                path.unlink()
