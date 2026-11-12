"""Checks for the provisional 500-episode DQN run."""

import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from topic3.dqn import ACTION_COUNT, HIDDEN_UNITS, INPUT_SIZE  # noqa: E402
from topic3.p8c import TOLERANCE, ledger_matches  # noqa: E402
from topic3.p8d import (  # noqa: E402
    CHECKPOINT_ID,
    EPISODE_COUNT,
    TRAINING_INSTANCE_IDS,
    training_instance_id,
)


def load_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


class TrainingScheduleTests(unittest.TestCase):
    def test_instances_cycle_through_training_only(self):
        self.assertEqual(training_instance_id(1), "provisional-training-low-1000")
        self.assertEqual(training_instance_id(2), "provisional-training-medium-1001")
        self.assertEqual(training_instance_id(3), "provisional-training-high-1002")
        self.assertEqual(training_instance_id(4), "provisional-training-low-1000")
        self.assertEqual(training_instance_id(EPISODE_COUNT), TRAINING_INSTANCE_IDS[(EPISODE_COUNT - 1) % 3])
        self.assertTrue(all("held_out" not in instance_id and "pilot" not in instance_id for instance_id in TRAINING_INSTANCE_IDS))
        with self.assertRaises(ValueError):
            training_instance_id(0)
        with self.assertRaises(ValueError):
            training_instance_id(EPISODE_COUNT + 1)

    def test_archived_run_keeps_the_final_checkpoint_rule(self):
        directory = ROOT / "artifacts" / "workloads" / "provisional" / "p8d_training"
        record = load_json(directory / f"{CHECKPOINT_ID}.json")
        weights = load_json(directory / f"{CHECKPOINT_ID}-weights.json")
        self.assertEqual(record["status"], "provisional_not_frozen")
        self.assertEqual(record["run_status"], "complete")
        self.assertFalse(record["held_out_used"])
        self.assertFalse(record["for_held_out_inference"])
        self.assertEqual(record["checkpoint_id"], CHECKPOINT_ID)
        self.assertEqual(record["seed"], 8)
        self.assertEqual(record["epsilon"], 0.1)
        self.assertEqual(record["gamma"], 1)
        self.assertEqual(record["learning_rate"], 0.001)
        self.assertEqual(record["episodes_completed"], EPISODE_COUNT)
        self.assertEqual(len(record["episodes"]), EPISODE_COUNT)
        self.assertTrue(record["target_matches_final_online"])
        self.assertEqual(weights["checkpoint_id"], CHECKPOINT_ID)
        self.assertFalse(weights["for_held_out_inference"])
        self.assertEqual(weights["episode"], EPISODE_COUNT)
        self.assertEqual(len(weights["weights"]["W1"]), HIDDEN_UNITS[0])
        self.assertEqual(len(weights["weights"]["W1"][0]), INPUT_SIZE)
        self.assertEqual(len(weights["weights"]["W2"]), HIDDEN_UNITS[1])
        self.assertEqual(len(weights["weights"]["W2"][0]), HIDDEN_UNITS[0])
        self.assertEqual(len(weights["weights"]["W3"]), ACTION_COUNT)
        self.assertEqual(len(weights["weights"]["W3"][0]), HIDDEN_UNITS[1])
        for index, episode in enumerate(record["episodes"], start=1):
            self.assertEqual(episode["status"], "complete")
            self.assertEqual(episode["instance_id"], training_instance_id(index))
            self.assertTrue(episode["target_synced_after_update"])
            self.assertTrue(ledger_matches(episode))
            self.assertLessEqual(abs(episode["transition_reward_sum"] - episode["ledger_total"]), TOLERANCE)
            self.assertEqual(sum(episode["destination_counts"].values()), 80)
        self.assertNotIn("held_out", json.dumps(record["instance_cycle"]))


if __name__ == "__main__":
    unittest.main()
