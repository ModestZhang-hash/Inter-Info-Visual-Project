"""Hand-checked queue, energy, replay, and failure cases for the P2 simulator."""

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from topic3.policies import LatencyFirstPolicy, RandomPolicy  # noqa: E402
from topic3.simulator import PROVISIONAL_RANDOM_SEED, run_instance  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
DELTA = 1e-9


class FixedPolicy:
    policy_config_id = "fixed"
    policy_seed = None

    def __init__(self, destination):
        self.destination = destination

    def choose(self, task, observable_state):
        del task, observable_state
        return self.destination


class MapPolicy:
    policy_config_id = "mapped"
    policy_seed = None

    def __init__(self, destinations):
        self.destinations = destinations

    def choose(self, task, observable_state):
        del observable_state
        return self.destinations[task["task_id"]]


def load_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def manifest():
    return load_json(ROOT / "configs" / "provisional" / "training.json")


def task(index, arrival, cycles, upload, returned):
    return {
        "task_id": f"task-{index:03d}",
        "arrival_s": arrival,
        "compute_cycles": cycles,
        "upload_bytes": upload,
        "return_bytes": returned,
    }


def instance(tasks):
    source = manifest()
    return {
        "schema_version": "1.0.0",
        "instance_id": "hand-instance",
        "manifest_id": source["manifest_id"],
        "phase": "training",
        "intensity_label": "low",
        "environment_seed": 7,
        "task_generation_seed": 1000,
        "tasks": tasks,
    }


def independent_metrics(frozen, events):
    makespan = max(event["completion_s"] for event in events) - min(item["arrival_s"] for item in frozen["tasks"])
    latency = sum(event["completion_s"] - item["arrival_s"] for event, item in zip(events, frozen["tasks"])) / len(events)
    energy = sum(event["compute_energy_j"] + event["transfer_energy_j"] for event in events)
    return makespan, energy, latency


class SimulatorTests(unittest.TestCase):
    def test_contract_example_times_and_energies(self):
        frozen = instance([
            task(1, 0.0, 2_000_000_000, 1_000_000, 100_000),
            task(2, 0.5, 900_000_000, 750_000, 75_000),
        ])
        events, record = run_instance(
            frozen,
            MapPolicy({"task-001": "edge-0", "task-002": "edge-1"}),
            manifest(),
            event_log_path="events.jsonl",
        )
        local, remote = events
        self.assertIsNone(local["upload_start_s"])
        self.assertIsNone(local["return_end_s"])
        self.assertEqual(local["completion_s"], local["compute_end_s"])
        self.assertAlmostEqual(local["completion_s"], 1.0, delta=DELTA)
        self.assertAlmostEqual(local["compute_energy_j"], 5.0, delta=DELTA)
        self.assertEqual(local["transfer_energy_j"], 0.0)
        self.assertAlmostEqual(remote["upload_end_s"] - remote["upload_start_s"], 0.2, delta=DELTA)
        self.assertAlmostEqual(remote["compute_end_s"] - remote["compute_start_s"], 0.3, delta=DELTA)
        self.assertAlmostEqual(remote["return_end_s"] - remote["return_start_s"], 0.02, delta=DELTA)
        self.assertEqual(remote["completion_s"], remote["return_end_s"])
        self.assertLessEqual(remote["compute_end_s"], remote["return_start_s"])
        self.assertAlmostEqual(remote["completion_s"], 1.02, delta=DELTA)
        self.assertAlmostEqual(remote["compute_energy_j"], 1.8, delta=DELTA)
        self.assertAlmostEqual(remote["transfer_energy_j"], 0.165, delta=DELTA)
        makespan, energy, latency = independent_metrics(frozen, events)
        self.assertAlmostEqual(record["makespan_s"], 1.02, delta=DELTA)
        self.assertAlmostEqual(record["energy_j"], 6.965, delta=DELTA)
        self.assertAlmostEqual(record["mean_latency_s"], 0.76, delta=DELTA)
        self.assertAlmostEqual(record["makespan_s"], makespan, delta=DELTA)
        self.assertAlmostEqual(record["energy_j"], energy, delta=DELTA)
        self.assertAlmostEqual(record["mean_latency_s"], latency, delta=DELTA)

    def test_queue_and_node_speed_explain_completion(self):
        queued = instance([
            task(1, 0.0, 2_000_000_000, 0, 0),
            task(2, 0.2, 2_000_000_000, 0, 0),
        ])
        events, _record = run_instance(queued, FixedPolicy("edge-0"), manifest(), event_log_path="events.jsonl")
        self.assertAlmostEqual(events[0]["compute_end_s"], 1.0, delta=DELTA)
        self.assertAlmostEqual(events[1]["compute_start_s"], 1.0, delta=DELTA)
        self.assertAlmostEqual(events[1]["completion_s"], 2.0, delta=DELTA)
        fast = instance([task(1, 0.0, 4_000_000_000, 0, 0)])
        slow, _slow_record = run_instance(fast, FixedPolicy("edge-0"), manifest(), event_log_path="events.jsonl")
        quick, _quick_record = run_instance(fast, FixedPolicy("edge-2"), manifest(), event_log_path="events.jsonl")
        self.assertAlmostEqual(slow[0]["completion_s"], 2.0, delta=DELTA)
        self.assertAlmostEqual(quick[0]["completion_s"], 1.0, delta=DELTA)

    def test_shared_channel_keeps_return_behind_the_upload_queue(self):
        frozen = instance([
            task(1, 0.0, 900_000_000, 750_000, 75_000),
            task(2, 0.0, 900_000_000, 750_000, 75_000),
        ])
        events, _record = run_instance(frozen, FixedPolicy("edge-1"), manifest(), event_log_path="events.jsonl")
        self.assertAlmostEqual(events[0]["completion_s"], 0.52, delta=DELTA)
        self.assertAlmostEqual(events[1]["upload_start_s"], 0.2, delta=DELTA)
        self.assertAlmostEqual(events[1]["compute_start_s"], 0.5, delta=DELTA)
        self.assertAlmostEqual(events[1]["completion_s"], 0.82, delta=DELTA)
        self.assertGreaterEqual(events[0]["return_start_s"], events[0]["compute_end_s"])

    def test_replay_ignores_future_arrivals_and_a_deadline_has_no_objectives(self):
        frozen = instance([
            task(1, 0.0, 2_000_000_000, 500_000, 50_000),
            task(2, 0.4, 2_000_000_000, 500_000, 50_000),
        ])
        seen = []

        class RecordingPolicy:
            policy_config_id = "latency-first"
            policy_seed = None

            def choose(self, task, observable_state):
                seen.append((task["task_id"], list(observable_state["arrived_task_ids"]), set(observable_state)))
                return LatencyFirstPolicy().choose(task, observable_state)

        first, first_record = run_instance(frozen, RecordingPolicy(), manifest(), event_log_path="events.jsonl")
        second, _second_record = run_instance(frozen, LatencyFirstPolicy(), manifest(), event_log_path="events.jsonl")
        self.assertEqual(first, second)
        self.assertEqual(seen[0][1], ["task-001"])
        self.assertEqual(seen[1][1], ["task-001", "task-002"])
        self.assertNotIn("tasks", seen[0][2])
        self.assertIsNone(first_record["policy_seed"])
        failed_events, failed = run_instance(
            instance([task(1, 0.0, 2_000_000_000, 0, 0)]),
            FixedPolicy("edge-0"),
            manifest(),
            event_log_path="events.jsonl",
            deadline_s=0.5,
        )
        self.assertEqual(failed["status"], "failed")
        self.assertEqual(failed["failure_reason"], "deadline exceeded")
        self.assertIsNone(failed["makespan_s"])
        self.assertIsNone(failed["energy_j"])
        self.assertIsNone(failed["mean_latency_s"])
        self.assertIsNone(failed_events[0]["completion_s"])
        self.assertIsNone(failed_events[0]["compute_energy_j"])

    def test_random_seed_replays_and_provisional_streams_are_not_resampled(self):
        source = manifest()
        path = ROOT / "artifacts" / "workloads" / "provisional" / "training" / "provisional-training-low-1000.json"
        frozen = load_json(path)
        original = json.dumps(frozen["tasks"])
        destinations = [node["node_id"] for node in source["topology"]["nodes"]]
        seed = PROVISIONAL_RANDOM_SEED
        first, _record = run_instance(frozen, RandomPolicy(seed, destinations), source, event_log_path="events.jsonl")
        second, _again = run_instance(frozen, RandomPolicy(seed, destinations), source, event_log_path="events.jsonl")
        other, _other = run_instance(frozen, RandomPolicy(seed + 1, destinations), source, event_log_path="events.jsonl")
        self.assertEqual(first, second)
        self.assertNotEqual([event["destination_id"] for event in first], [event["destination_id"] for event in other])
        self.assertEqual(json.dumps(frozen["tasks"]), original)
        self.assertTrue(all(event["status"] == "complete" for event in first))

    def test_written_provisional_logs_match_a_fresh_replay(self):
        catalog = load_json(ROOT / "artifacts" / "workloads" / "provisional" / "p2_run_index.json")
        self.assertEqual(len(catalog["runs"]), 84)
        self.assertFalse(catalog["provisional_status"]["seven_candidate_results"])
        self.assertEqual(catalog["simulator_version"], "topic3-simulator-p2-1")
        records = ROOT / "artifacts" / "workloads" / "provisional" / "run_records"
        logs = ROOT / "artifacts" / "workloads" / "provisional" / "events"
        for run_id in catalog["runs"]:
            record = load_json(records / f"{run_id}.json")
            lines = (logs / f"{run_id}.jsonl").read_text(encoding="utf-8").splitlines()
            self.assertEqual(record["status"], "complete")
            self.assertEqual(record["task_count"], 80)
            self.assertEqual(len(lines), 80)
            self.assertIsNone(record["failure_reason"])
        sample = "provisional-training-low-1000"
        source = manifest()
        frozen = load_json(ROOT / "artifacts" / "workloads" / "provisional" / "training" / f"{sample}.json")
        destinations = [node["node_id"] for node in source["topology"]["nodes"]]
        for policy in (LatencyFirstPolicy(), RandomPolicy(PROVISIONAL_RANDOM_SEED, destinations)):
            events, record = run_instance(frozen, policy, source, event_log_path=f"../../artifacts/workloads/provisional/events/{record_name(frozen, policy)}.jsonl")
            stored = load_json(records / f"{record['run_id']}.json")
            stored_events = [json.loads(line) for line in (logs / f"{record['run_id']}.jsonl").read_text(encoding="utf-8").splitlines()]
            self.assertEqual(stored, record)
            self.assertEqual(stored_events, events)


def record_name(frozen, policy):
    name = f"{frozen['instance_id']}-{policy.policy_config_id}"
    if policy.policy_seed is not None:
        name = f"{name}-{policy.policy_seed}"
    return name


if __name__ == "__main__":
    unittest.main()
