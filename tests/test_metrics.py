"""Fixed cases for the independent M, E, and L calculator."""

import ast
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from topic3.metrics import MetricError, recompute_objectives, reject_duplicate_run_ids  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from build_p3_bundle import build_bundle  # noqa: E402
LOCAL = "edge-0"


def task(task_id, arrival):
    return {"task_id": task_id, "arrival_s": arrival, "compute_cycles": 1, "upload_bytes": 0, "return_bytes": 0}


def local_event(task_id, completion, compute_energy, compute_start=0.0):
    return {
        "task_id": task_id, "destination_id": LOCAL, "status": "complete", "failure_reason": None,
        "upload_start_s": None, "upload_end_s": None, "compute_start_s": compute_start,
        "compute_end_s": completion, "return_start_s": None, "return_end_s": None,
        "completion_s": completion, "compute_energy_j": compute_energy, "transfer_energy_j": 0.0,
    }


def remote_event(task_id, completion, compute_energy, transfer_energy):
    return {
        "task_id": task_id, "destination_id": "edge-1", "status": "complete", "failure_reason": None,
        "upload_start_s": 0.0, "upload_end_s": 0.2, "compute_start_s": 0.2, "compute_end_s": 0.5,
        "return_start_s": 0.5, "return_end_s": completion, "completion_s": completion,
        "compute_energy_j": compute_energy, "transfer_energy_j": transfer_energy,
    }


class MetricTests(unittest.TestCase):
    def test_calculator_does_not_import_the_simulator(self):
        source = (ROOT / "src" / "topic3" / "metrics.py").read_text(encoding="utf-8")
        tree = ast.parse(source)
        imported = []
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported.extend(alias.name for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                imported.append(node.module)
        self.assertFalse(any("simulator" in name for name in imported))

    def test_local_transfer_is_zero_and_nonlocal_stages_enter_the_sum(self):
        frozen = {"tasks": [task("task-001", 0.0), task("task-002", 0.5)]}
        events = [local_event("task-001", 1.0, 5.0), remote_event("task-002", 1.02, 1.8, 0.165)]
        result = recompute_objectives(frozen, events, local_node_id=LOCAL)
        self.assertAlmostEqual(result["makespan_s"], 1.02, places=9)
        self.assertAlmostEqual(result["energy_j"], 6.965, places=9)
        self.assertAlmostEqual(result["mean_latency_s"], 0.76, places=9)
        local = local_event("task-001", 1.0, 5.0)
        local["upload_start_s"] = 0.1
        with self.assertRaisesRegex(MetricError, "transfer time"):
            recompute_objectives({"tasks": [task("task-001", 0.0)]}, [local], local_node_id=LOCAL)
        charged = local_event("task-001", 1.0, 5.0)
        charged["transfer_energy_j"] = 0.1
        with self.assertRaisesRegex(MetricError, "transfer energy"):
            recompute_objectives({"tasks": [task("task-001", 0.0)]}, [charged], local_node_id=LOCAL)

    def test_queue_and_node_speed_change_the_result_through_completion_time(self):
        frozen = {"tasks": [task("task-001", 0.0), task("task-002", 0.2)]}
        queued = [local_event("task-001", 1.0, 5.0), local_event("task-002", 2.0, 5.0, compute_start=1.0)]
        direct = [local_event("task-001", 1.0, 5.0), local_event("task-002", 1.2, 5.0, compute_start=0.2)]
        queued_result = recompute_objectives(frozen, queued, local_node_id=LOCAL)
        direct_result = recompute_objectives(frozen, direct, local_node_id=LOCAL)
        self.assertAlmostEqual(queued_result["makespan_s"], 2.0, places=9)
        self.assertAlmostEqual(direct_result["makespan_s"], 1.2, places=9)
        self.assertAlmostEqual(queued_result["mean_latency_s"], 1.4, places=9)
        self.assertGreater(queued_result["makespan_s"], direct_result["makespan_s"])
        slow = recompute_objectives({"tasks": [task("task-001", 0.0)]}, [local_event("task-001", 2.0, 10.0)], local_node_id=LOCAL)
        fast = recompute_objectives({"tasks": [task("task-001", 0.0)]}, [local_event("task-001", 1.0, 5.0)], local_node_id=LOCAL)
        self.assertAlmostEqual(slow["makespan_s"], 2.0, places=9)
        self.assertAlmostEqual(fast["makespan_s"], 1.0, places=9)

    def test_latest_completion_sets_makespan(self):
        frozen = {"tasks": [task("task-001", 0.0), task("task-002", 5.0)]}
        events = [local_event("task-001", 3.0, 1.0), local_event("task-002", 9.0, 1.0)]
        result = recompute_objectives(frozen, events, local_node_id=LOCAL)
        self.assertAlmostEqual(result["makespan_s"], 9.0, places=9)

    def test_failed_log_and_duplicate_ids_do_not_produce_objectives(self):
        failed = local_event("task-001", 1.0, 5.0)
        failed["status"] = "failed"
        failed["completion_s"] = None
        failed["compute_energy_j"] = None
        failed["transfer_energy_j"] = None
        with self.assertRaisesRegex(MetricError, "no objectives"):
            recompute_objectives({"tasks": [task("task-001", 0.0)]}, [failed], local_node_id=LOCAL)
        with self.assertRaisesRegex(MetricError, "Duplicate task_id"):
            recompute_objectives({"tasks": [task("task-001", 0.0), task("task-001", 1.0)]}, [], local_node_id=LOCAL)
        duplicate_event = [local_event("task-001", 1.0, 5.0), local_event("task-001", 2.0, 5.0)]
        with self.assertRaisesRegex(MetricError, "Duplicate event task_id"):
            recompute_objectives({"tasks": [task("task-001", 0.0)]}, duplicate_event, local_node_id=LOCAL)
        with self.assertRaisesRegex(MetricError, "Duplicate run_id"):
            reject_duplicate_run_ids([{"run_id": "same"}, {"run_id": "same"}])

    def test_training_low_logs_match_the_independent_values(self):
        manifest = json.loads((ROOT / "configs" / "provisional" / "training.json").read_text(encoding="utf-8"))
        frozen = json.loads((ROOT / "artifacts" / "workloads" / "provisional" / "training" / "provisional-training-low-1000.json").read_text(encoding="utf-8"))
        gateway = manifest["topology"]["gateway_node_id"]
        tolerance = manifest["numeric_tolerance"]
        for suffix in ("latency-first", "random-11"):
            run_id = f"provisional-training-low-1000-{suffix}"
            record = json.loads((ROOT / "artifacts" / "workloads" / "provisional" / "run_records" / f"{run_id}.json").read_text(encoding="utf-8"))
            events = [json.loads(line) for line in (ROOT / "artifacts" / "workloads" / "provisional" / "events" / f"{run_id}.jsonl").read_text(encoding="utf-8").splitlines()]
            result = recompute_objectives(frozen, events, local_node_id=gateway)
            for key in ("makespan_s", "energy_j", "mean_latency_s"):
                gap = abs(result[key] - record[key])
                limit = max(tolerance["absolute"], tolerance["relative"] * max(abs(result[key]), abs(record[key])))
                self.assertLessEqual(gap, limit)

    def test_exported_bundle_has_two_training_runs_and_recomputed_values(self):
        bundle = build_bundle(ROOT)
        self.assertIn("shared SVG entry", bundle["p3_note"])
        self.assertEqual(bundle["instance"]["instance_id"], "provisional-training-low-1000")
        self.assertEqual(len(bundle["runs"]), 2)
        self.assertEqual(
            {run["policy_config_id"] for run in bundle["runs"]},
            {"latency-first", "random"},
        )
        gateway = bundle["manifest"]["topology"]["gateway_node_id"]
        by_run = {}
        for event in bundle["events"]:
            by_run.setdefault(event["run_id"], []).append(event)
        for run in bundle["runs"]:
            values = recompute_objectives(bundle["instance"], by_run[run["run_id"]], local_node_id=gateway)
            self.assertEqual(run["makespan_s"], values["makespan_s"])
            self.assertEqual(run["energy_j"], values["energy_j"])
            self.assertEqual(run["mean_latency_s"], values["mean_latency_s"])


if __name__ == "__main__":
    unittest.main()
