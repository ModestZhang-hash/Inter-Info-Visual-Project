"""Two training episodes for the provisional DQN feasibility check."""

import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from topic3.dqn import DqnPolicy, copy_weights, epsilon_greedy_index, greedy_index  # noqa: E402
from topic3.p8c import EPSILON, EPISODE_COUNT, INSTANCE_ID, EpsilonGreedyTrainer, ledger_matches, run_p8c  # noqa: E402
from topic3.workload import canonical_json  # noqa: E402


def load_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


class FeasibilityTests(unittest.TestCase):
    def test_epsilon_draw_does_not_update_weights(self):
        config = load_json(ROOT / "configs" / "provisional" / "dqn_features.json")
        manifest = load_json(ROOT / "configs" / "provisional" / "training.json")
        policy = DqnPolicy([node["node_id"] for node in manifest["topology"]["nodes"]], config)
        before = copy_weights(policy.online)
        q_values = [0.2, 0.2, -1.0, 0.0]
        greedy_state, greedy_action, explored = epsilon_greedy_index(q_values, 0.0, policy.rng_state)
        self.assertEqual(greedy_action, greedy_index(q_values))
        self.assertFalse(explored)
        self.assertNotEqual(greedy_state, policy.rng_state)
        _state, _action, always = epsilon_greedy_index(q_values, 1.0, policy.rng_state)
        self.assertTrue(always)
        self.assertEqual(policy.online, before)
        trainer = EpsilonGreedyTrainer(policy)
        self.assertEqual(trainer.epsilon, EPSILON)

    def test_two_training_episodes_match_the_ledger(self):
        document = run_p8c(ROOT)
        path = ROOT / "artifacts" / "workloads" / "provisional" / "p8c_feasibility" / f"{INSTANCE_ID}.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(canonical_json(document), encoding="utf-8")
        self.assertEqual(document["status"], "provisional_not_frozen")
        self.assertEqual(document["run_status"], "complete")
        self.assertFalse(document["held_out_used"])
        self.assertIsNone(document["checkpoint_id"])
        self.assertEqual(document["instance_id"], INSTANCE_ID)
        self.assertEqual(document["seed"], 8)
        self.assertEqual(document["epsilon"], 0.1)
        self.assertEqual(document["episode_count_requested"], EPISODE_COUNT)
        self.assertEqual(document["episodes_completed"], 2)
        self.assertFalse(document["target_synced"])
        self.assertTrue(document["online_weights_changed"])
        self.assertTrue(document["target_weights_unchanged"])
        self.assertGreater(document["total_elapsed_s"], 0.0)
        self.assertEqual(len(document["episodes"]), 2)
        allowed = {"edge-0", "edge-1", "edge-2", "cloud-0"}
        for episode in document["episodes"]:
            self.assertEqual(episode["status"], "complete")
            self.assertIsNone(episode["failure_reason"])
            self.assertEqual(episode["task_count"], 80)
            self.assertTrue(ledger_matches(episode))
            self.assertTrue(abs(episode["transition_reward_sum"] - episode["ledger_total"]) <= 1e-9)
            self.assertEqual(sum(episode["destination_counts"].values()), 80)
            self.assertTrue(set(episode["destination_counts"]) <= allowed)
            self.assertTrue(episode["weight_update"])
            self.assertGreater(episode["elapsed_s"], 0.0)
        stored = load_json(path)
        self.assertEqual(stored["episodes"][0]["makespan_s"], document["episodes"][0]["makespan_s"])
        self.assertNotIn("held_out", path.as_posix())


if __name__ == "__main__":
    unittest.main()
