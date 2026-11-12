"""Rebuild held-out metrics, Pareto labels, and simulator events from the archive."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from topic3.p12 import verify_p12  # noqa: E402
from topic3.workload import canonical_json  # noqa: E402


def main():
    record = verify_p12(ROOT)
    path = ROOT / "artifacts" / "workloads" / "provisional" / "p12_acceptance" / "rebuild.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(canonical_json(record), encoding="utf-8")
    print(
        f"objectives={record['objectives_match']} pareto={record['pareto_labels_match']} "
        f"replay={record['replay_matches']} runs={record['runs_recomputed']}"
    )


if __name__ == "__main__":
    main()
