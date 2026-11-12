"""Reward ledger, decision features, and unchanged heuristic logs for P8a."""

import json
import math
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from topic3.features import derive_feature_config, feature_instance_ids, normalize_decision_features  # noqa: E402
from topic3.metrics import recompute_objectives  # noqa: E402
from topic3.policies import make_heuristic  # noqa: E402
from topic3.reward_ledger import LedgerError, build_ledger, complete_run_reward  # noqa: E402
from topic3.simulator import PROVISIONAL_RANDOM_SEED, SIMULATOR_VERSION, run_instance  # noqa: E402
from topic3.workload import canonical_json  # noqa: E402


def load_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def load_events(path):
    return [json.loads(line) for line in Path(path).read_text(encoding="utf-8").splitlines()]


class FixedPolicy:
    policy_config_id = "fixed"
    policy_seed = None

    def __init__(self, destination):
        self.destination = destination

    def choose(self, task, observable_state):
        del task
        self.last = observable_state["decision_features"]
        return self.destination


class CapturePolicy:
    policy_config_id = "capture"
    policy_seed = None

    def __init__(self):
        self.features = {}

    def choose(self, task, observable_state):
        self.features[task["task_id"]] = observable_state["decision_features"]
        return "edge-0"


def hand_instance(tasks):
    manifest = load_json(ROOT / "configs" / "provisional" / "training.json")
    return manifest, {
        "schema_version": "1.0.0",
        "instance_id": "hand-p8a",
        "manifest_id": manifest["manifest_id"],
        "phase": "training",
        "intensity_label": "low",
        "environment_seed": 7,
        "task_generation_seed": 1000,
        "tasks": tasks,
    }


class RewardLedgerTests(unittest.TestCase):
    def test_hand_credits_sum_to_the_complete_run_target(self):
        scales = {"s_M": 1.0, "s_E": 1.0, "s_L": 1.0}
        instance = {"tasks": [
            {"task_id": "task-a", "arrival_s": 0.0},
            {"task_id": "task-b", "arrival_s": 0.0},
        ]}
        events = [
            {"task_id": "task-a", "status": "complete", "completion_s": 10.0, "compute_energy_j": 4.0, "transfer_energy_j": 0.0},
            {"task_id": "task-b", "status": "complete", "completion_s": 6.0, "compute_energy_j": 2.0, "transfer_energy_j": 0.0},
        ]
        ledger = build_ledger(instance, events, scales)
        self.assertEqual(ledger["gamma"], 1)
        by_component = {}
        for entry in ledger["entries"]:
            by_component.setdefault((entry["task_id"], entry["component"]), entry)
            self.assertGreaterEqual(entry["time_s"], 6.0)
        self.assertEqual(by_component[("task-b", "makespan")]["amount"], -2.0)
        self.assertEqual(by_component[("task-a", "makespan")]["amount"], -4.0 / 3.0)
        self.assertEqual(by_component[("task-b", "energy")]["amount"], -2.0 / 3.0)
        self.assertEqual(by_component[("task-a", "energy")]["amount"], -4.0 / 3.0)
        self.assertEqual(by_component[("task-b", "latency")]["amount"], -1.0)
        self.assertEqual(by_component[("task-a", "latency")]["amount"], -10.0 / 6.0)
        objectives = {"makespan_s": 10.0, "energy_j": 6.0, "mean_latency_s": 8.0}
        self.assertEqual(ledger["total"], complete_run_reward(objectives, scales))
        self.assertEqual(ledger["total"], -8.0)

    def test_incomplete_log_has_no_reward_total(self):
        instance = {"tasks": [{"task_id": "task-a", "arrival_s": 0.0}, {"task_id": "task-b", "arrival_s": 1.0}]}
        events = [{"task_id": "task-a", "status": "complete", "completion_s": 2.0, "compute_energy_j": 1.0, "transfer_energy_j": 0.0}]
        with self.assertRaises(LedgerError):
            build_ledger(instance, events, {"s_M": 1.0, "s_E": 1.0, "s_L": 1.0})

    def test_nonlocal_energy_and_latency_wait_for_return(self):
        manifest, frozen = hand_instance([{
            "task_id": "task-001",
            "arrival_s": 0.0,
            "compute_cycles": 3_000_000_000,
            "upload_bytes": 3_000_000,
            "return_bytes": 300_000,
        }])
        policy = FixedPolicy("edge-1")
        events, record = run_instance(frozen, policy, manifest, event_log_path="hand.jsonl")
        self.assertEqual(record["simulator_version"], "topic3-simulator-p2-1")
        event = events[0]
        self.assertGreater(event["return_end_s"], event["compute_end_s"])
        scales = load_json(ROOT / "configs" / "provisional" / "balanced_scales.json")
        ledger = build_ledger(frozen, events, scales)
        credited = [entry for entry in ledger["entries"] if entry["component"] in ("energy", "latency")]
        self.assertEqual({entry["time_s"] for entry in credited}, {event["completion_s"]})
        self.assertTrue(all(entry["time_s"] == event["return_end_s"] for entry in credited))
        self.assertTrue(all(entry["time_s"] > event["compute_end_s"] for entry in credited))
        objectives = recompute_objectives(frozen, events, local_node_id="edge-0")
        self.assertTrue(math.isclose(ledger["total"], complete_run_reward(objectives, scales), rel_tol=0.0, abs_tol=1e-9))

    def test_gateway_queue_snapshot_excludes_the_current_task(self):
        cycles = 2_000_000_000
        tasks = []
        for index, arrival in enumerate((0.0, 0.2, 0.3), start=1):
            tasks.append({
                "task_id": f"task-{index:03d}",
                "arrival_s": arrival,
                "compute_cycles": cycles,
                "upload_bytes": 500_000,
                "return_bytes": 50_000,
            })
        manifest, frozen = hand_instance(tasks)
        policy = CapturePolicy()
        run_instance(frozen, policy, manifest, event_log_path="hand.jsonl")
        config = derive_feature_config(ROOT)
        third = policy.features["task-003"]
        local = third["nodes"][0]
        self.assertEqual([node["node_id"] for node in third["nodes"]], ["edge-0", "edge-1", "edge-2", "cloud-0"])
        self.assertEqual(local["cpu_queue_length"], 1)
        self.assertEqual(local["channel_queue_length"], 0)
        self.assertEqual(local["channel_remaining_busy_s"], 0.0)
        self.assertTrue(math.isclose(local["cpu_remaining_busy_s"], 1.7))
        self.assertTrue(math.isclose(local["projected_completion_s"], 3.0))
        self.assertTrue(math.isclose(local["projected_task_energy_j"], 5.0))
        self.assertEqual(policy.features["task-001"]["nodes"][0]["cpu_queue_length"], 0)
        self.assertTrue(math.isclose(policy.features["task-002"]["nodes"][0]["cpu_remaining_busy_s"], 0.8))
        normalized = normalize_decision_features(third, config)
        self.assertEqual(normalized["nodes"][0]["cpu_queue_length"], 1)
        self.assertTrue(math.isclose(normalized["nodes"][0]["cpu_remaining_busy_normalized"], 1.7 / config["s_M"]))
        self.assertTrue(math.isclose(normalized["nodes"][0]["projected_completion_normalized"], 3.0 / config["s_M"]))
        self.assertTrue(math.isclose(normalized["nodes"][0]["projected_task_energy_normalized"], 5.0 / config["s_E"]))
        for node in normalized["nodes"][1:]:
            self.assertEqual(node["cpu_queue_length"], 0)
            self.assertEqual(node["channel_queue_length"], 0)
            self.assertEqual(node["channel_remaining_busy_normalized"], 0.0)

    def test_feature_scales_use_training_and_pilot_only(self):
        derived = derive_feature_config(ROOT)
        self.assertFalse(derived["held_out_used"])
        self.assertEqual(derived["status"], "provisional_not_frozen")
        self.assertEqual(derived["gamma"], 1)
        self.assertEqual(derived["source_instance_ids"], feature_instance_ids())
        self.assertEqual(len(derived["source_instance_ids"]), 6)
        self.assertTrue(all("held_out" not in instance_id for instance_id in derived["source_instance_ids"]))
        cycles, uploads, returns = [], [], []
        for instance_id in derived["source_instance_ids"]:
            phase = "training" if "-training-" in instance_id else "pilot"
            frozen = load_json(ROOT / "artifacts" / "workloads" / "provisional" / phase / f"{instance_id}.json")
            self.assertIn(frozen["phase"], ("training", "pilot"))
            for task in frozen["tasks"]:
                cycles.append(task["compute_cycles"])
                uploads.append(task["upload_bytes"])
                returns.append(task["return_bytes"])
        self.assertEqual(derived["compute_cycles_scale"], max(cycles))
        self.assertEqual(derived["upload_bytes_scale"], max(uploads))
        self.assertEqual(derived["return_bytes_scale"], max(returns))
        scales = load_json(ROOT / "configs" / "provisional" / "balanced_scales.json")
        for key in ("s_M", "s_E", "s_L"):
            self.assertEqual(derived[key], scales[key])
        stored = load_json(ROOT / "configs" / "provisional" / "dqn_features.json")
        self.assertEqual(stored, derived)
        self.assertEqual(canonical_json(stored), (ROOT / "configs" / "provisional" / "dqn_features.json").read_text(encoding="utf-8"))

    def test_archived_heuristic_logs_and_reward_sums(self):
        self.assertEqual(SIMULATOR_VERSION, "topic3-simulator-p2-1")
        scales = load_json(ROOT / "configs" / "provisional" / "balanced_scales.json")
        cases = [
            ("training", "provisional-training-low-1000", "latency-first", None),
            ("training", "provisional-training-low-1000", "random", PROVISIONAL_RANDOM_SEED),
            ("pilot", "provisional-pilot-low-2000", "latency-first", None),
        ]
        for phase, instance_id, config_id, seed in cases:
            manifest = load_json(ROOT / "configs" / "provisional" / f"{phase}.json")
            frozen = load_json(ROOT / "artifacts" / "workloads" / "provisional" / phase / f"{instance_id}.json")
            policy = make_heuristic(config_id, [node["node_id"] for node in manifest["topology"]["nodes"]], scales, seed)
            events, record = run_instance(frozen, policy, manifest, event_log_path=f"{config_id}.jsonl")
            self.assertEqual(record["simulator_version"], SIMULATOR_VERSION)
            self.assertEqual(record["status"], "complete")
            suffix = "random-11" if config_id == "random" else config_id
            stored = load_events(ROOT / "artifacts" / "workloads" / "provisional" / "events" / f"{instance_id}-{suffix}.jsonl")
            self.assertEqual(events, stored)
            objectives = recompute_objectives(frozen, events, local_node_id=manifest["topology"]["gateway_node_id"])
            ledger = build_ledger(frozen, events, scales)
            self.assertEqual(ledger["gamma"], 1)
            self.assertTrue(math.isclose(ledger["total"], complete_run_reward(objectives, scales), rel_tol=0.0, abs_tol=1e-9))
            for entry in ledger["entries"]:
                completion = next(event["completion_s"] for event in events if event["task_id"] == entry["task_id"])
                self.assertEqual(entry["time_s"], completion)

    def test_ledger_source_does_not_import_the_simulator(self):
        source = (ROOT / "src" / "topic3" / "reward_ledger.py").read_text(encoding="utf-8")
        imports = [line for line in source.splitlines() if line.startswith("import ") or line.startswith("from ")]
        self.assertFalse(any("simulator" in line or "held_out" in line for line in imports))


if __name__ == "__main__":
    unittest.main()
