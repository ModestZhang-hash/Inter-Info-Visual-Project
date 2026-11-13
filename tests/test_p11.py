"""Held-out paired summaries stay inside one instance and match an independent recalculation."""

import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from topic3.p11 import THRESHOLD_S, analyze_p11, median  # noqa: E402
from topic3.workload import canonical_json  # noqa: E402


def independent_span(values):
    ordered = sorted(values)
    half = len(ordered) // 2
    lower = (ordered[2] + ordered[3]) / 2 if half == 6 else None
    upper = (ordered[half + 2] + ordered[half + 3]) / 2 if half == 6 else None
    middle = (ordered[5] + ordered[6]) / 2
    return lower, middle, upper, upper - lower


class AnalysisTests(unittest.TestCase):
    def test_summaries_and_cases_match_the_archive(self):
        summary = analyze_p11(ROOT)
        objectives = json.loads((ROOT / "artifacts" / "workloads" / "provisional" / "p10_held_out" / "objectives.json").read_text(encoding="utf-8"))
        low_latency = []
        for instance_id in sorted({run["instance_id"] for run in objectives["runs"] if "-low-" in run["instance_id"]}):
            group = [run for run in objectives["runs"] if run["instance_id"] == instance_id]
            dqn = next(run for run in group if run["policy_config_id"] == "dqn-fixed")
            other = next(run for run in group if run["policy_config_id"] == "latency-first")
            low_latency.append(dqn["mean_latency_s"] - other["mean_latency_s"])
        q1, middle, q3, iqr = independent_span(low_latency)
        row = next(item for item in summary["paired_summaries"] if item["intensity"] == "low" and item["heuristic"] == "latency-first")
        self.assertEqual(row["mean_latency_s"]["n"], 12)
        self.assertEqual(row["mean_latency_s"]["q1"], q1)
        self.assertEqual(row["mean_latency_s"]["median"], middle)
        self.assertEqual(row["mean_latency_s"]["q3"], q3)
        self.assertEqual(row["mean_latency_s"]["iqr"], iqr)
        self.assertEqual(median(low_latency), middle)
        self.assertTrue(all(instance_id.startswith("provisional-held_out-low-") for instance_id in row["instance_ids"]))
        counts = {item["policy_config_id"]: item["count"] for item in summary["non_dominated_counts"]["by_policy"]}
        self.assertEqual(counts["dqn-fixed"], 1)
        self.assertEqual(summary["failure_count"], 0)
        self.assertFalse(summary["bootstrap_intervals"])
        self.assertFalse(summary["pooled_pareto"])
        case = summary["cases"]["dqn_versus_heuristics_on_one_instance"]
        self.assertEqual(case["status"], "reported")
        self.assertEqual(case["freeze_version"], "2")
        self.assertEqual(case["seed"], 3000)
        self.assertEqual(case["instance_id"], "provisional-held_out-low-3000")
        self.assertEqual(case["dqn_run_id"], "provisional-held_out-low-3000-dqn-fixed-8")
        self.assertTrue(case["full_non_dominated"])
        self.assertEqual(case["witness_run_ids"], [])
        self.assertEqual([row["heuristic"] for row in case["differences"]], [
            "random", "latency-first", "energy-first", "balanced-equal", "balanced-makespan", "balanced-energy",
        ])
        energy = next(row for row in case["differences"] if row["heuristic"] == "energy-first")
        low3000 = [run for run in objectives["runs"] if run["instance_id"] == case["instance_id"]]
        dqn = next(run for run in low3000 if run["policy_config_id"] == "dqn-fixed")
        other = next(run for run in low3000 if run["policy_config_id"] == "energy-first")
        self.assertEqual(energy["makespan_s"], dqn["makespan_s"] - other["makespan_s"])
        self.assertEqual(energy["energy_j"], dqn["energy_j"] - other["energy_j"])
        self.assertEqual(energy["mean_latency_s"], dqn["mean_latency_s"] - other["mean_latency_s"])
        pair = summary["cases"]["pair_versus_full"]
        self.assertEqual(pair["instance_id"], "provisional-held_out-low-3000")
        self.assertEqual(pair["third_objective"], "mean_latency_s")
        self.assertLess(pair["target_value"], pair["witness_value"])
        self.assertEqual(len(summary["cases"]["energy_under_latency_ceiling"]), 36)
        self.assertTrue(all(item["threshold_s"] == THRESHOLD_S for item in summary["cases"]["energy_under_latency_ceiling"]))
        intensities = summary["cases"]["intensity_comparison"]
        self.assertEqual([item["intensity"] for item in intensities], ["low", "medium", "high"])
        self.assertTrue(all(len(item["within_instance_fronts"]) == 12 for item in intensities))
        out = ROOT / "artifacts" / "workloads" / "provisional" / "p11_analysis" / "summary.json"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(canonical_json(summary), encoding="utf-8")


if __name__ == "__main__":
    unittest.main()
