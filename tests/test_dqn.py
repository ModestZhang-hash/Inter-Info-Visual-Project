"""Pure-Python DQN: greedy choose, one recorded seed, updates only while training."""

import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from topic3.dqn import (  # noqa: E402
    ACTION_COUNT,
    GAMMA,
    HIDDEN_UNITS,
    INPUT_SIZE,
    LEARNING_RATE,
    POLICY_CONFIG_ID,
    PROVISIONAL_DQN_SEED,
    REPLAY_CAPACITY,
    DqnPolicy,
    ReplayBuffer,
    copy_weights,
    feature_vector,
    forward,
    greedy_index,
    loss_and_gradients,
    sample_replay,
)
from topic3.simulator import SIMULATOR_VERSION, run_instance  # noqa: E402


def load_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def feature_config():
    return load_json(ROOT / "configs" / "provisional" / "dqn_features.json")


def destinations():
    manifest = load_json(ROOT / "configs" / "provisional" / "training.json")
    return [node["node_id"] for node in manifest["topology"]["nodes"]]


def open_weights(weights):
    for row in weights["W1"]:
        for index in range(len(row)):
            row[index] = 0.01
    for index in range(len(weights["b1"])):
        weights["b1"][index] = 0.5
    for row in weights["W2"]:
        for index in range(len(row)):
            row[index] = 0.01
    for index in range(len(weights["b2"])):
        weights["b2"][index] = 0.5
    for row in weights["W3"]:
        for index in range(len(row)):
            row[index] = 0.01
    for index in range(len(weights["b3"])):
        weights["b3"][index] = 0.0


def ones():
    return [1.0] * INPUT_SIZE


def observable(node_ids):
    nodes = []
    for node_id in node_ids:
        nodes.append({
            "node_id": node_id,
            "cpu_queue_length": 0,
            "cpu_remaining_busy_s": 0.0,
            "channel_queue_length": 0,
            "channel_remaining_busy_s": 0.0,
            "projected_completion_s": 1.0,
            "projected_task_energy_j": 1.0,
        })
    return {
        "destination_ids": list(node_ids),
        "decision_features": {
            "task_id": "task-001",
            "compute_cycles": 1_000_000_000,
            "upload_bytes": 1_000_000,
            "return_bytes": 100_000,
            "nodes": nodes,
        },
    }


class DqnTests(unittest.TestCase):
    def test_recorded_seed_and_shape_match_the_provisional_file(self):
        recorded = load_json(ROOT / "configs" / "provisional" / "dqn_policy.json")
        self.assertEqual(recorded["status"], "provisional_not_frozen")
        self.assertFalse(recorded["held_out_used"])
        self.assertIsNone(recorded["checkpoint_id"])
        self.assertEqual(recorded["policy_config_id"], POLICY_CONFIG_ID)
        self.assertEqual(recorded["seed"], PROVISIONAL_DQN_SEED)
        self.assertEqual(PROVISIONAL_DQN_SEED, 8)
        self.assertEqual(recorded["hidden_units"], list(HIDDEN_UNITS))
        self.assertEqual(recorded["action_count"], ACTION_COUNT)
        self.assertEqual(recorded["input_size"], INPUT_SIZE)
        self.assertEqual(recorded["learning_rate"], LEARNING_RATE)
        self.assertEqual(recorded["gamma"], GAMMA)
        self.assertEqual(recorded["replay_capacity"], REPLAY_CAPACITY)
        self.assertEqual(recorded["inference"], "greedy")
        policy = DqnPolicy(destinations(), feature_config())
        again = DqnPolicy(destinations(), feature_config())
        self.assertEqual(policy.policy_seed, PROVISIONAL_DQN_SEED)
        self.assertEqual(policy.online, again.online)
        self.assertEqual(policy.online, policy.target)
        self.assertEqual(len(policy.online["W1"]), 64)
        self.assertEqual(len(policy.online["W1"][0]), 27)
        self.assertEqual(len(policy.online["W2"]), 64)
        self.assertEqual(len(policy.online["W3"]), 4)
        self.assertEqual(len(policy.online["W3"][0]), 64)
        self.assertTrue(all(value == 0.0 for value in policy.online["b1"]))
        self.assertEqual(policy.rng_state, again.rng_state)

    def test_choose_is_greedy_and_does_not_train(self):
        node_ids = destinations()
        policy = DqnPolicy(node_ids, feature_config())
        open_weights(policy.online)
        policy.online["b3"] = [0.0, 0.2, 0.2, -1.0]
        policy.sync_target()
        before_online = copy_weights(policy.online)
        before_target = copy_weights(policy.target)
        before_rng = policy.rng_state
        state = observable(node_ids)
        vector = feature_vector(state, policy.feature_config, policy.destination_ids)
        self.assertEqual(len(vector), 27)
        q_values, _cache = forward(policy.online, vector)
        self.assertEqual(greedy_index(q_values), 1)
        self.assertEqual(policy.choose({"task_id": "task-001"}, state), "edge-1")
        self.assertEqual(policy.choose({"task_id": "task-001"}, state), "edge-1")
        self.assertEqual(policy.online, before_online)
        self.assertEqual(policy.target, before_target)
        self.assertEqual(policy.rng_state, before_rng)
        self.assertEqual(len(policy.replay), 0)

    def test_choose_on_the_simulator_returns_one_destination(self):
        manifest = load_json(ROOT / "configs" / "provisional" / "training.json")
        frozen = {
            "schema_version": "1.0.0",
            "instance_id": "hand-p8b",
            "manifest_id": manifest["manifest_id"],
            "phase": "training",
            "intensity_label": "low",
            "environment_seed": 7,
            "task_generation_seed": 1000,
            "tasks": [{
                "task_id": "task-001",
                "arrival_s": 0.0,
                "compute_cycles": 1_000_000_000,
                "upload_bytes": 1_000_000,
                "return_bytes": 100_000,
            }],
        }
        policy = DqnPolicy(destinations(), feature_config())
        before = copy_weights(policy.online)
        events, record = run_instance(frozen, policy, manifest, event_log_path="dqn.jsonl")
        self.assertEqual(record["simulator_version"], SIMULATOR_VERSION)
        self.assertEqual(record["status"], "complete")
        self.assertEqual(record["policy_config_id"], "dqn-fixed")
        self.assertEqual(record["policy_seed"], 8)
        self.assertIn(events[0]["destination_id"], policy.destination_ids)
        self.assertEqual(policy.online, before)
        self.assertEqual(len(policy.replay), 0)

    def test_training_step_updates_online_weights_only(self):
        policy = DqnPolicy(destinations(), feature_config())
        open_weights(policy.online)
        policy.sync_target()
        target_before = copy_weights(policy.target)
        transition = {"state": ones(), "action": 0, "reward": 1.0, "done": True}
        loss, gradients = loss_and_gradients(policy.online, policy.target, [transition], GAMMA)
        numerical = _central_difference(policy.online, policy.target, transition, "W1", 0, 0)
        self.assertAlmostEqual(numerical, gradients["W1"][0][0], places=5)
        numerical_output = _central_difference(policy.online, policy.target, transition, "W3", 0, 4)
        self.assertAlmostEqual(numerical_output, gradients["W3"][0][4], places=5)
        policy.train_step(transition)
        after, _gradients = loss_and_gradients(policy.online, policy.target, [transition], GAMMA)
        self.assertLess(after, loss)
        self.assertNotEqual(policy.online, target_before)
        self.assertEqual(policy.target, target_before)
        for _step in range(20):
            policy.train_step(transition)
        trained, _gradients = loss_and_gradients(policy.online, policy.target, [transition], GAMMA)
        self.assertLess(trained, after)

    def test_bootstrap_reads_the_target_network(self):
        policy = DqnPolicy(destinations(), feature_config())
        open_weights(policy.online)
        policy.sync_target()
        policy.target["b3"][3] = 5.0
        continued = {"state": ones(), "action": 0, "reward": 0.0, "next_state": ones(), "done": False}
        loss, _gradients = loss_and_gradients(policy.online, policy.target, [continued], GAMMA)
        policy.target["b3"][3] = 0.0
        smaller, _gradients = loss_and_gradients(policy.online, policy.target, [continued], GAMMA)
        self.assertNotEqual(loss, smaller)
        with self.assertRaises(ValueError):
            loss_and_gradients(policy.online, policy.target, [continued], 0.99)

    def test_replay_sampling_uses_the_seed_stream(self):
        policy = DqnPolicy(destinations(), feature_config())
        state_before_choose = policy.rng_state
        policy.choose({"task_id": "task-001"}, observable(destinations()))
        self.assertEqual(policy.rng_state, state_before_choose)
        for index in range(4):
            policy.remember({"state": ones(), "action": index % 4, "reward": float(index), "done": True})
        first_state, first = sample_replay(policy.replay, 2, policy.rng_state)
        _same_state, second = sample_replay(policy.replay, 2, policy.rng_state)
        self.assertEqual(first, second)
        policy.train_from_replay(2)
        self.assertEqual(policy.rng_state, first_state)
        self.assertNotEqual(policy.online, policy.target)
        buffer = ReplayBuffer(2)
        buffer.add({"state": 1})
        buffer.add({"state": 2})
        buffer.add({"state": 3})
        self.assertEqual([row["state"] for row in buffer.rows], [3, 2])


def _central_difference(online, target, transition, key, row, column):
    step = 1e-5
    loss_plus = _perturbed_loss(online, target, transition, key, row, column, step)
    loss_minus = _perturbed_loss(online, target, transition, key, row, column, -step)
    return (loss_plus - loss_minus) / (2.0 * step)


def _perturbed_loss(online, target, transition, key, row, column, step):
    trial = copy_weights(online)
    trial[key][row][column] += step
    loss, _gradients = loss_and_gradients(trial, target, [transition], GAMMA)
    return loss


if __name__ == "__main__":
    unittest.main()
