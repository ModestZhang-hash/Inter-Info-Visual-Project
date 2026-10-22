"""Reference cases for the Python Pareto classifier."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from topic3.pareto import OBJECTIVES, PAIRS, classify_all, classify_runs, dominates  # noqa: E402


TOL = {"absolute": 1e-9, "relative": 1e-9}


def run(run_id, m, e, l, *, instance="one", status="complete"):
    return {
        "run_id": run_id, "instance_id": instance, "status": status,
        "makespan_s": m, "energy_j": e, "mean_latency_s": l,
    }


class ParetoTests(unittest.TestCase):
    def test_strict_dominance_and_equal_axis(self):
        result = classify_runs([run("target", 2, 3, 4), run("w", 1, 3, 2)], OBJECTIVES, TOL)
        evidence = result["target"]["witnesses"][0]
        self.assertEqual(evidence["witness_run_id"], "w")
        self.assertEqual(evidence["relations"], {
            "makespan_s": "strict_improvement", "energy_j": "equal", "mean_latency_s": "strict_improvement"
        })
        self.assertEqual(evidence["target_metrics"], {"makespan_s": 2, "energy_j": 3, "mean_latency_s": 4})
        self.assertEqual(evidence["witness_metrics"], {"makespan_s": 1, "energy_j": 3, "mean_latency_s": 2})

    def test_identical_vectors_do_not_dominate(self):
        result = classify_runs([run("a", 1, 2, 3), run("b", 1, 2, 3)], OBJECTIVES, TOL)
        self.assertTrue(result["a"]["non_dominated"])
        self.assertTrue(result["b"]["non_dominated"])

    def test_2d_dominated_but_3d_non_dominated(self):
        runs = [run("target", 2, 2, 1), run("w", 1, 1, 3)]
        result = classify_all(runs, TOL)
        self.assertFalse(result["pairs"]["makespan_s|energy_j"]["target"]["non_dominated"])
        self.assertTrue(result["full"]["target"]["non_dominated"])

    def test_3d_dominated_but_2d_equal_projection_non_dominated(self):
        runs = [run("target", 1, 2, 3), run("w", 1, 2, 2)]
        result = classify_all(runs, TOL)
        self.assertTrue(result["pairs"]["makespan_s|energy_j"]["target"]["non_dominated"])
        self.assertFalse(result["full"]["target"]["non_dominated"])
        self.assertEqual(result["full"]["target"]["witnesses"][0]["relations"], {
            "makespan_s": "equal", "energy_j": "equal", "mean_latency_s": "strict_improvement"
        })

    def test_multiple_witnesses_have_stable_id_order(self):
        runs = [run("z", 3, 3, 3), run("b", 2, 2, 2), run("a", 1, 1, 1)]
        for ordered in (runs, list(reversed(runs))):
            self.assertEqual(classify_runs(ordered, OBJECTIVES, TOL)["z"]["witness_run_ids"], ["a", "b"])

    def test_absolute_and_relative_tolerance(self):
        target = run("target", 1, 2, 3)
        witness = run("w", 1 + 5e-10, 1, 3)
        self.assertTrue(dominates(witness, target, OBJECTIVES, TOL))
        relation = classify_runs([target, witness], OBJECTIVES, TOL)["target"]["witnesses"][0]["relations"]
        self.assertEqual(relation["makespan_s"], "equivalent_within_tolerance")
        self.assertFalse(dominates(run("bad", 1 + 2e-8, 1, 3), target, OBJECTIVES, TOL))
        self.assertTrue(dominates(run("large", 1000 + 5e-7, 1, 3), run("base", 1000, 2, 3), OBJECTIVES, TOL))

    def test_failed_run_ignored_and_instances_isolated(self):
        runs = [run("good", 1, 1, 1), run("failed", None, None, None, status="failed")]
        self.assertEqual(set(classify_runs(runs, OBJECTIVES, TOL)), {"good"})
        with self.assertRaisesRegex(ValueError, "mixes workload instances"):
            classify_runs([runs[0], run("other", 1, 1, 1, instance="two")], OBJECTIVES, TOL)

    def test_all_pair_keys_and_unrounded_values(self):
        a = run("a", 1, 1, 1)
        b = run("b", 1 + 1e-6, 1, 1)
        result = classify_all([a, b], TOL)
        self.assertEqual(set(result["pairs"]), {"|".join(pair) for pair in PAIRS})
        self.assertFalse(result["full"]["b"]["non_dominated"])
        self.assertEqual(result["full"]["b"]["witnesses"][0]["target_metrics"]["makespan_s"], 1 + 1e-6)


if __name__ == "__main__":
    unittest.main()
