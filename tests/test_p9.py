"""Pilot checks stay off held-out logs and keep the recorded checkpoint rule."""

import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from topic3.p9 import run_p9  # noqa: E402
from topic3.workload import canonical_json  # noqa: E402


class PilotFreezeTests(unittest.TestCase):
    def test_pilot_checks_and_freeze_list(self):
        result = run_p9(ROOT)
        record = result["pilot_record"]
        freeze = result["design_freeze"]
        self.assertEqual(record["status"], "pilot_complete")
        self.assertFalse(record["held_out_results_read"])
        self.assertFalse(record["checkpoint_weights_updated"])
        self.assertEqual(record["runs_complete"], record["runs_requested"])
        self.assertEqual(record["runs_requested"], 21)
        self.assertTrue(all(run["accounting_ok"] and run["ledger_ok"] for run in record["runs"]))
        self.assertEqual(len({run["instance_id"] for run in record["runs"]}), 3)
        self.assertTrue(all(run["instance_id"].startswith("provisional-pilot-") for run in record["runs"]))
        self.assertIsNotNone(freeze)
        self.assertEqual(freeze["freeze_version"], "1")
        self.assertTrue(freeze["read_only"])
        self.assertFalse(freeze["held_out_results_read_before_freeze"])
        self.assertEqual(freeze["seed_splits"]["training"], [1000, 1001, 1002])
        self.assertEqual(freeze["seed_splits"]["pilot"], [2000, 2001, 2002])
        self.assertEqual(freeze["seed_splits"]["held_out"], list(range(3000, 3036)))
        self.assertEqual(freeze["evaluation"]["expected_complete_runs"], 252)
        self.assertEqual(freeze["dqn"]["checkpoint_id"], "provisional-dqn-seed8-episode500")
        self.assertFalse(result["decision_log"]["entries"][1]["changed"])
        pilot_dir = ROOT / "artifacts" / "workloads" / "provisional" / "p9_pilot"
        freeze_path = ROOT / "configs" / "freeze" / "design_freeze_v1.json"
        pilot_dir.mkdir(parents=True, exist_ok=True)
        freeze_path.parent.mkdir(parents=True, exist_ok=True)
        (pilot_dir / "pilot_record.json").write_text(canonical_json(record), encoding="utf-8")
        (pilot_dir / "decision_log.json").write_text(canonical_json(result["decision_log"]), encoding="utf-8")
        freeze_path.write_text(canonical_json(freeze), encoding="utf-8")
        stored = json.loads(freeze_path.read_text(encoding="utf-8"))
        self.assertEqual(stored["freeze_version"], "1")


if __name__ == "__main__":
    unittest.main()
