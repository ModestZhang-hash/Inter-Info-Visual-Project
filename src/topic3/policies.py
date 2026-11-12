"""Six heuristic policies on one observable-state interface.

Random uses a recorded seed. The other five are deterministic. Latency-first
minimizes projected completion. Energy-first minimizes this task's projected
compute-plus-transfer energy. The three Balanced policies minimize
w_M * makespan_increase / s_M + w_E * task_energy / s_E + w_L * task_latency / s_L.
Ties keep manifest node order. No policy receives future arrivals.
"""

from __future__ import annotations

from fractions import Fraction

from topic3.workload import _uniform_int

BALANCED_IDS = ("balanced-equal", "balanced-makespan", "balanced-energy")
HEURISTIC_IDS = ("random", "latency-first", "energy-first", *BALANCED_IDS)
BALANCED_WEIGHTS = {
    "balanced-equal": {"makespan": Fraction(1, 3), "energy": Fraction(1, 3), "latency": Fraction(1, 3)},
    "balanced-makespan": {"makespan": Fraction(3, 5), "energy": Fraction(1, 5), "latency": Fraction(1, 5)},
    "balanced-energy": {"makespan": Fraction(1, 5), "energy": Fraction(3, 5), "latency": Fraction(1, 5)},
}


def projected_task_energy(task, node, gateway_id: str) -> float:
    """Incremental compute plus transfer energy. Queue wait is not included."""
    capacity = node["compute_capacity_cycles_per_s"]
    compute = task["compute_cycles"] / capacity * node["active_compute_power_increment_w"]
    if node["node_id"] == gateway_id:
        return float(compute)
    transfer = (task["upload_bytes"] + task["return_bytes"]) / 1_000_000 * node["transfer_energy_j_per_mb"]
    return float(compute + transfer)


def _pick_minimum(destination_ids, score_for):
    best_id = None
    best_score = None
    for destination_id in destination_ids:
        score = score_for(destination_id)
        if score is None:
            continue
        if best_score is None or score < best_score:
            best_id = destination_id
            best_score = score
    if best_id is None:
        return destination_ids[0]
    return best_id


class RandomPolicy:
    policy_config_id = "random"

    def __init__(self, seed: int, destination_ids: list[str]):
        if isinstance(seed, bool) or not isinstance(seed, int) or seed < 0:
            raise ValueError("Random policy requires a non-negative integer seed")
        if not destination_ids:
            raise ValueError("Random policy requires at least one destination")
        self.policy_seed = seed
        self._state = seed
        self._destination_ids = list(destination_ids)

    def choose(self, task, observable_state) -> str:
        del task, observable_state
        self._state, index = _uniform_int(self._state, 0, len(self._destination_ids) - 1)
        return self._destination_ids[index]


class LatencyFirstPolicy:
    policy_config_id = "latency-first"
    policy_seed = None

    def choose(self, task, observable_state) -> str:
        del task
        best_id = None
        best_time = None
        for destination_id in observable_state["destination_ids"]:
            projected = observable_state["predict_completion_s"](destination_id)
            if projected is None:
                continue
            if best_time is None or projected < best_time:
                best_id = destination_id
                best_time = projected
        if best_id is None:
            return observable_state["destination_ids"][0]
        return best_id


class EnergyFirstPolicy:
    policy_config_id = "energy-first"
    policy_seed = None
    family = "energy-first"

    def choose(self, task, observable_state) -> str:
        del task
        return _pick_minimum(
            observable_state["destination_ids"],
            observable_state["predict_task_energy_j"],
        )


class BalancedPolicy:
    family = "balanced"
    policy_seed = None

    def __init__(self, config_id: str, scales: dict):
        if config_id not in BALANCED_WEIGHTS:
            raise ValueError(f"Unknown balanced configuration: {config_id}")
        for key in ("s_M", "s_E", "s_L"):
            value = scales[key]
            if isinstance(value, bool) or not isinstance(value, (int, float)) or value <= 0:
                raise ValueError(f"Balanced scale {key} must be positive")
        self.policy_config_id = config_id
        self.weights = BALANCED_WEIGHTS[config_id]
        self.scales = scales

    def choose(self, task, observable_state) -> str:
        def score(destination_id: str):
            completion = observable_state["predict_completion_s"](destination_id)
            energy = observable_state["predict_task_energy_j"](destination_id)
            if completion is None or energy is None:
                return None
            latency = completion - task["arrival_s"]
            increase = observable_state["predict_makespan_increase_s"](destination_id)
            if increase is None:
                return None
            return float(
                self.weights["makespan"] * increase / self.scales["s_M"]
                + self.weights["energy"] * energy / self.scales["s_E"]
                + self.weights["latency"] * latency / self.scales["s_L"]
            )

        return _pick_minimum(observable_state["destination_ids"], score)


def make_heuristic(config_id: str, destination_ids: list[str], scales: dict | None = None, random_seed: int | None = None):
    """Build one of the six heuristics. Random requires random_seed."""
    if config_id == "random":
        if random_seed is None:
            raise ValueError("Random policy requires a recorded seed")
        return RandomPolicy(random_seed, destination_ids)
    if config_id == "latency-first":
        return LatencyFirstPolicy()
    if config_id == "energy-first":
        return EnergyFirstPolicy()
    if config_id in BALANCED_WEIGHTS:
        if scales is None:
            raise ValueError("Balanced policies require training or pilot scales")
        return BalancedPolicy(config_id, scales)
    raise ValueError(f"Unknown heuristic: {config_id}")
