"""The two P2 policies: Random and Latency-first.

Random draws one feasible destination per arrival with splitmix64, the same
generator family as the workload streams. Latency-first picks the destination
with the smallest projected completion under work already assigned. Ties keep
the manifest node order. Neither policy receives future arrivals.
"""

from __future__ import annotations

from topic3.workload import _uniform_int


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
