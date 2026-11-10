"""P5 checks: hand cases, the second enumerator, and the six-heuristic reference."""

import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "tests"))
from reference_pareto import enumerate_all, enumerate_runs  # noqa: E402
from topic3.pareto import OBJECTIVES, classify_all, classify_runs  # noqa: E402

sys.path.insert(0, str(ROOT / "scripts"))
from build_p5_reference import INSTANCE_ID, build_reference  # noqa: E402
TOL = {"absolute": 1e-9, "relative": 1e-9}


def run(run_id, m, e, l, *, instance="one", status="complete"):
    return {
        "run_id": run_id, "instance_id": instance, "status": status,
        "makespan_s": m, "energy_j": e, "mean_latency_s": l,
    }


class ParetoReferenceTests(unittest.TestCase):
    def test_hand_cases_agree_and_keep_known_relations(self):
        strict = [run("target", 2, 3, 4), run("w", 1, 3, 2)]
        self.assertEqual(classify_runs(strict, OBJECTIVES, TOL), enumerate_runs(strict, OBJECTIVES, TOL))
        self.assertEqual(classify_runs(strict, OBJECTIVES, TOL)["target"]["witnesses"][0]["relations"]["energy_j"], "equal")
        identical = [run("a", 1, 2, 3), run("b", 1, 2, 3)]
        agreed = enumerate_runs(identical, OBJECTIVES, TOL)
        self.assertTrue(agreed["a"]["non_dominated"] and agreed["b"]["non_dominated"])
        projection = [run("target", 1, 2, 3), run("w", 1, 2, 2)]
        both = enumerate_all(projection, TOL)
        self.assertEqual(both, classify_all(projection, TOL))
        self.assertTrue(both["pairs"]["makespan_s|energy_j"]["target"]["non_dominated"])
        self.assertFalse(both["full"]["target"]["non_dominated"])
        ordered = [run("z", 3, 3, 3), run("b", 2, 2, 2), run("a", 1, 1, 1)]
        self.assertEqual(enumerate_runs(list(reversed(ordered)), OBJECTIVES, TOL)["z"]["witness_run_ids"], ["a", "b"])

    def test_failed_values_stay_out_of_the_front_and_instances_stay_separate(self):
        runs = [run("good", 1, 1, 1), run("failed", 0, 0, 0, status="failed")]
        self.assertEqual(set(enumerate_runs(runs, OBJECTIVES, TOL)), {"good"})
        with self.assertRaisesRegex(ValueError, "mixes workload instances"):
            enumerate_runs([runs[0], run("other", 1, 1, 1, instance="two")], OBJECTIVES, TOL)

    def test_six_heuristic_reference_is_not_an_official_front(self):
        record = build_reference(ROOT)
        self.assertFalse(record["official_seven_candidate_front"])
        self.assertEqual(record["reference_status"], "incomplete_candidates")
        self.assertEqual(record["missing_policy_config_ids"], ["dqn-fixed"])
        self.assertEqual(record["instance_id"], INSTANCE_ID)
        self.assertEqual(len(record["reference_run_ids"]), 6)
        self.assertTrue(record["filter_does_not_recompute_reference"])
        self.assertEqual(set(record["classification"]["full"]), set(record["reference_run_ids"]))
        stored = json.loads((ROOT / "artifacts" / "workloads" / "provisional" / "p5_six_heuristic" / f"{INSTANCE_ID}.json").read_text(encoding="utf-8"))
        self.assertEqual(stored, record)
        self.assertTrue(any(entry["non_dominated"] for entry in record["classification"]["full"].values()))
        self.assertTrue(any(not entry["non_dominated"] for entry in record["classification"]["full"].values()))


if __name__ == "__main__":
    unittest.main()
