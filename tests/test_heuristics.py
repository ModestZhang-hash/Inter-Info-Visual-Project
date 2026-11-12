"""Six heuristics on one frozen instance, with scales limited to training and pilot."""

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from topic3.policies import (  # noqa: E402
    BALANCED_WEIGHTS,
    HEURISTIC_IDS,
    EnergyFirstPolicy,
    BalancedPolicy,
    make_heuristic,
)
from topic3.scales import derive_balanced_scales, scale_run_ids  # noqa: E402
from topic3.simulator import PROVISIONAL_RANDOM_SEED, run_instance  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]


def load_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def state(destinations, completion, energy, increase):
    return {
        "destination_ids": destinations,
        "predict_completion_s": lambda destination: completion[destination],
        "predict_task_energy_j": lambda destination: energy[destination],
        "predict_makespan_increase_s": lambda destination: increase[destination],
        "arrived_task_ids": ["task-001"],
    }


class HeuristicTests(unittest.TestCase):
    def test_scales_come_only_from_training_and_pilot(self):
        derived = derive_balanced_scales(ROOT)
        self.assertFalse(derived["held_out_used"])
        self.assertEqual(len(derived["source_run_ids"]), 12)
        self.assertTrue(all("held_out" not in run_id for run_id in derived["source_run_ids"]))
        self.assertEqual(derived["source_run_ids"], scale_run_ids())
        self.assertGreater(derived["s_M"], 0)
        self.assertGreater(derived["s_E"], 0)
        self.assertGreater(derived["s_L"], 0)
        stored = load_json(ROOT / "configs" / "provisional" / "balanced_scales.json")
        for key in ("s_M", "s_E", "s_L"):
            self.assertAlmostEqual(stored[key], derived[key], places=12)

    def test_energy_and_balanced_ties_follow_node_order(self):
        destinations = ["edge-0", "edge-1"]
        task = {"task_id": "task-001", "arrival_s": 0.0}
        energy = EnergyFirstPolicy()
        self.assertEqual(energy.choose(task, state(destinations, {}, {"edge-0": 2.0, "edge-1": 2.0}, {})), "edge-0")
        self.assertEqual(energy.choose(task, state(destinations, {}, {"edge-0": 3.0, "edge-1": 1.0}, {})), "edge-1")
        scales = {"s_M": 1.0, "s_E": 1.0, "s_L": 1.0}
        makespan_policy = BalancedPolicy("balanced-makespan", scales)
        self.assertEqual(makespan_policy.weights["makespan"], BALANCED_WEIGHTS["balanced-makespan"]["makespan"])
        chosen = makespan_policy.choose(task, state(
            destinations,
            {"edge-0": 10.0, "edge-1": 1.0},
            {"edge-0": 0.0, "edge-1": 0.0},
            {"edge-0": 10.0, "edge-1": 0.0},
        ))
        self.assertEqual(chosen, "edge-1")
        energy_policy = BalancedPolicy("balanced-energy", scales)
        chosen = energy_policy.choose(task, state(
            destinations,
            {"edge-0": 1.0, "edge-1": 1.0},
            {"edge-0": 0.0, "edge-1": 10.0},
            {"edge-0": 0.0, "edge-1": 0.0},
        ))
        self.assertEqual(chosen, "edge-0")

    def test_six_policies_share_one_interface_on_one_frozen_instance(self):
        manifest = load_json(ROOT / "configs" / "provisional" / "training.json")
        frozen = load_json(ROOT / "artifacts" / "workloads" / "provisional" / "training" / "provisional-training-low-1000.json")
        scales = derive_balanced_scales(ROOT)
        destinations = [node["node_id"] for node in manifest["topology"]["nodes"]]
        seen = []

        class RecordingPolicy:
            def __init__(self, inner):
                self.inner = inner
                self.policy_config_id = inner.policy_config_id
                self.policy_seed = inner.policy_seed

            def choose(self, task, observable_state):
                seen.append(list(observable_state["arrived_task_ids"]))
                self.assert_no_future(task, observable_state)
                return self.inner.choose(task, observable_state)

            def assert_no_future(self, task, observable_state):
                later = [item["task_id"] for item in frozen["tasks"] if item["arrival_s"] > task["arrival_s"]]
                self_ids = observable_state["arrived_task_ids"]
                if any(task_id in self_ids for task_id in later):
                    raise AssertionError("future arrival was visible")

        records = []
        for config_id in HEURISTIC_IDS:
            inner = make_heuristic(config_id, destinations, scales, PROVISIONAL_RANDOM_SEED)
            wrapped = RecordingPolicy(inner)
            events, record = run_instance(frozen, wrapped, manifest, event_log_path=f"{config_id}.jsonl")
            self.assertEqual(record["policy_config_id"], config_id)
            self.assertEqual(record["status"], "complete")
            if config_id == "random":
                self.assertEqual(record["policy_seed"], PROVISIONAL_RANDOM_SEED)
            else:
                self.assertIsNone(record["policy_seed"])
            again, _again_record = run_instance(frozen, make_heuristic(config_id, destinations, scales, PROVISIONAL_RANDOM_SEED), manifest, event_log_path=f"{config_id}.jsonl")
            self.assertEqual(events, again)
            records.append(record["run_id"])
        self.assertEqual(len(set(records)), 6)
        self.assertTrue(seen)
        self.assertEqual(seen[0], ["task-001"])
        stored_random = [json.loads(line) for line in (ROOT / "artifacts" / "workloads" / "provisional" / "events" / "provisional-training-low-1000-random-11.jsonl").read_text(encoding="utf-8").splitlines()]
        random_events, _random_record = run_instance(frozen, make_heuristic("random", destinations, scales, PROVISIONAL_RANDOM_SEED), manifest, event_log_path="random.jsonl")
        self.assertEqual(random_events, stored_random)


if __name__ == "__main__":
    unittest.main()
