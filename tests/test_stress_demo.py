"""Synthetic fixture provenance, reproducibility and archive consistency."""
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts.build_stress_demo import OUTPUT, build_bundle


class StressDemoTests(unittest.TestCase):
    def test_reproducible_isolated_archive(self):
        bundle = build_bundle()
        self.assertEqual(bundle, json.loads((OUTPUT / "bundle.json").read_text(encoding="utf-8")))
        self.assertEqual(len(bundle["runs"]), 500)
        self.assertEqual(len(bundle["events"]), 4000)
        self.assertEqual(bundle["manifest"]["phase"], "fixture")
        self.assertEqual({r["record_origin"] for r in bundle["runs"]}, {"manual_fixture"})
        self.assertEqual({r["instance_id"] for r in bundle["runs"]}, {bundle["instance"]["instance_id"]})
        self.assertTrue(all(r["simulator_version"] is None for r in bundle["runs"]))
        for name, key in [("experiment_manifest.json", "manifest"), ("workload_instance.json", "instance")]:
            self.assertEqual(json.loads((OUTPUT / name).read_text(encoding="utf-8")), bundle[key])
        for run, relative in zip(bundle["runs"], bundle["manifest"]["raw_data_paths"]["runs"]):
            self.assertEqual(json.loads((OUTPUT / relative).read_text(encoding="utf-8")), run)
        self.assertEqual([json.loads(line) for line in (OUTPUT / "task_events.jsonl").read_text(encoding="utf-8").splitlines()], bundle["events"])
