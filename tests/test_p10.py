"""The held-out archive uses one frozen checkpoint and one task list per instance."""

import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from topic3.metrics import recompute_objectives  # noqa: E402
from topic3.p10 import CHECKPOINT_ID, run_p10  # noqa: E402


def load_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


class HeldOutArchiveTests(unittest.TestCase):
    def test_frozen_grid_is_archived_without_retraining(self):
        weights_path = ROOT / "artifacts" / "workloads" / "provisional" / "p8d_training" / f"{CHECKPOINT_ID}-weights.json"
        before = weights_path.read_text(encoding="utf-8")
        payload = run_p10(ROOT)
        index = payload["index"]
        self.assertEqual(weights_path.read_text(encoding="utf-8"), before)
        self.assertFalse(index["retrained"])
        self.assertFalse(index["weights_updated"])
        self.assertEqual(index["checkpoint_id"], CHECKPOINT_ID)
        self.assertEqual(index["runs_expected"], 252)
        self.assertEqual(index["instances"], 36)
        self.assertEqual(index["runs_complete"] + index["failure_count"], 252)
        self.assertTrue(index["same_task_list_for_each_instance"])
        self.assertEqual(len({row["run_id"] for row in payload["objectives"]["runs"]}), index["runs_complete"])
        archive = ROOT / "artifacts" / "workloads" / "provisional" / "p10_held_out"
        if index["failure_count"] == 0:
            self.assertEqual(len(list((archive / "events").glob("*.jsonl"))), 252)
        self.assertFalse(payload["pareto"]["pooled_instances"])
        self.assertEqual(len(payload["pareto"]["instances"]), 36)
        if index["failure_count"] == 0:
            self.assertTrue(all(item["reference_status"] == "complete" and item["candidate_count"] == 7 for item in payload["pareto"]["instances"]))
        sample = next(row for row in payload["objectives"]["runs"] if row["run_id"].endswith("latency-first") and row["instance_id"].endswith("3000"))
        events = [json.loads(line) for line in (archive / "events" / f"{sample['run_id']}.jsonl").read_text(encoding="utf-8").splitlines()]
        frozen = load_json(ROOT / "artifacts" / "workloads" / "provisional" / "held_out" / f"{sample['instance_id']}.json")
        metrics = recompute_objectives(frozen, events, local_node_id="edge-0")
        self.assertEqual(metrics["makespan_s"], sample["makespan_s"])
        self.assertEqual(metrics["energy_j"], sample["energy_j"])
        self.assertEqual(metrics["mean_latency_s"], sample["mean_latency_s"])


if __name__ == "__main__":
    unittest.main()
