"""Replay and seed-split checks for the provisional P1 workload generator."""

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from topic3.workload import (  # noqa: E402
    ENVIRONMENT_SEED,
    INTENSITIES,
    PHASES,
    STREAMS_PER_INTENSITY,
    TASK_COUNT,
    assert_disjoint_seeds,
    build_phase_manifest,
    generate_instance,
    phase_seeds,
    validate_workload_instance,
    write_provisional_archive,
)

ROOT = Path(__file__).resolve().parents[1]


def load_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


class WorkloadGeneratorTests(unittest.TestCase):
    def test_same_manifest_and_seed_replay_the_same_tasks(self):
        manifest = build_phase_manifest("held_out")
        first = generate_instance(manifest, "low", 3000)
        second = generate_instance(manifest, "low", 3000)
        self.assertEqual(first, second)
        self.assertEqual(json.loads(json.dumps(first)), second)
        self.assertEqual(first["tasks"][0]["arrival_s"], 0.0)
        self.assertEqual(len(first["tasks"]), TASK_COUNT)
        self.assertEqual([task["task_id"] for task in first["tasks"]], [f"task-{index:03d}" for index in range(1, TASK_COUNT + 1)])

    def test_stream_uses_the_provisional_integer_ranges(self):
        manifest = build_phase_manifest("pilot")
        instance = generate_instance(manifest, "high", 2002)
        validate_workload_instance(instance)
        arrivals = [task["arrival_s"] for task in instance["tasks"]]
        self.assertEqual(arrivals, sorted(arrivals))
        self.assertTrue(all(later > earlier for earlier, later in zip(arrivals, arrivals[1:])))
        for task in instance["tasks"]:
            self.assertGreaterEqual(task["compute_cycles"], 500_000_000)
            self.assertLessEqual(task["compute_cycles"], 2_000_000_000)
            self.assertGreaterEqual(task["upload_bytes"], 500_000)
            self.assertLessEqual(task["upload_bytes"], 2_000_000)
            self.assertEqual(task["return_bytes"], task["upload_bytes"] // 10)
        self.assertNotEqual(
            generate_instance(manifest, "low", 2000)["tasks"],
            generate_instance(manifest, "high", 2002)["tasks"],
        )

    def test_phase_seeds_are_disjoint_and_a_foreign_seed_is_rejected(self):
        splits = {phase: phase_seeds(phase) for phase in PHASES}
        splits["fixture"] = []
        assert_disjoint_seeds(splits)
        self.assertEqual(len(set(splits["training"]) & set(splits["pilot"]) & set(splits["held_out"])), 0)
        self.assertNotIn(ENVIRONMENT_SEED, set().union(*splits.values()))
        overlapped = {key: list(value) for key, value in splits.items()}
        overlapped["pilot"].append(splits["training"][0])
        with self.assertRaisesRegex(ValueError, "Seed collision"):
            assert_disjoint_seeds(overlapped)
        manifest = build_phase_manifest("training")
        with self.assertRaisesRegex(ValueError, "not assigned"):
            generate_instance(manifest, "low", splits["held_out"][0])

    def test_archive_has_unique_instances_and_rereads_the_same_tasks(self):
        with tempfile.TemporaryDirectory() as temporary:
            write_provisional_archive(Path(temporary))
            self._assert_archive(Path(temporary))
        self._assert_archive(ROOT)

    def _assert_archive(self, root):
        seen = {}
        for phase, count in STREAMS_PER_INTENSITY.items():
            manifest = load_json(root / "configs" / "provisional" / f"{phase}.json")
            self.assertFalse(manifest["provisional_status"]["design_freeze"])
            self.assertFalse(manifest["provisional_status"]["pilot_results"])
            self.assertFalse(manifest["provisional_status"]["held_out_results"])
            self.assertIsNone(manifest["software_versions"]["simulator"])
            self.assertEqual(manifest["workload_distribution"]["offered_load_by_intensity"]["low"]["decimal"], "0.35")
            self.assertEqual(manifest["workload_distribution"]["offered_load_by_intensity"]["medium"]["decimal"], "0.70")
            self.assertEqual(manifest["workload_distribution"]["offered_load_by_intensity"]["high"]["decimal"], "1.05")
            self.assertEqual(len(manifest["raw_data_paths"]["instances"]), count * len(INTENSITIES))
            self.assertEqual(manifest["raw_data_paths"]["runs"], [])
            base = root / "configs" / "provisional"
            for relative in manifest["raw_data_paths"]["instances"]:
                path = base / relative
                first = load_json(path)
                second = load_json(path)
                self.assertEqual(first["tasks"], second["tasks"])
                self.assertEqual(first["instance_id"], second["instance_id"])
                self.assertEqual(len(first["tasks"]), TASK_COUNT)
                regenerated = generate_instance(manifest, first["intensity_label"], first["task_generation_seed"])
                self.assertEqual(regenerated, first)
                self.assertNotIn(first["instance_id"], seen)
                seen[first["instance_id"]] = first["phase"]
        self.assertEqual(len(seen), 3 + 3 + 36)
        for phase in PHASES:
            self.assertEqual(sum(value == phase for value in seen.values()), STREAMS_PER_INTENSITY[phase] * len(INTENSITIES))

    def test_energy_constants_do_not_change_the_frozen_stream(self):
        manifest = build_phase_manifest("training")
        original = generate_instance(manifest, "medium", 1001)
        manifest["topology"]["nodes"][1]["active_compute_power_increment_w"] = 99
        manifest["topology"]["nodes"][1]["transfer_energy_j_per_mb"] = 4
        self.assertEqual(generate_instance(manifest, "medium", 1001), original)

    def test_contract_example_instance_still_validates(self):
        instance = load_json(ROOT / "examples" / "contract" / "workload_instance.json")
        validate_workload_instance(instance)
        manifest = load_json(ROOT / "examples" / "contract" / "experiment_manifest.json")
        assert_disjoint_seeds(manifest["seed_splits"])


if __name__ == "__main__":
    unittest.main()
