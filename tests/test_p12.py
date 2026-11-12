"""Archived held-out logs rebuild the stored objectives, labels, and events."""

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from topic3.p12 import verify_p12  # noqa: E402


class RebuildTests(unittest.TestCase):
    def test_archive_rebuilds_within_tolerance(self):
        record = verify_p12(ROOT)
        self.assertEqual(record["runs_recomputed"], 252)
        self.assertEqual(record["failure_count"], 0)
        self.assertFalse(record["pooled_pareto"])
        self.assertTrue(record["objectives_match"])
        self.assertTrue(record["pareto_labels_match"])
        self.assertTrue(record["replay_matches"])
        self.assertEqual(record["metric_mismatches"], [])
        self.assertEqual(record["pareto_label_mismatches"], [])
        self.assertEqual(record["replay_event_mismatches"], [])


if __name__ == "__main__":
    unittest.main()
