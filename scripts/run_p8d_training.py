"""Train the provisional DQN for 500 episodes and archive the final weights."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from topic3.p8d import CHECKPOINT_ID, run_p8d  # noqa: E402
from topic3.workload import canonical_json  # noqa: E402


def main():
    record, checkpoint = run_p8d(ROOT)
    directory = ROOT / "artifacts" / "workloads" / "provisional" / "p8d_training"
    directory.mkdir(parents=True, exist_ok=True)
    record_path = directory / f"{CHECKPOINT_ID}.json"
    record_path.write_text(canonical_json(record), encoding="utf-8")
    if checkpoint is not None:
        weight_path = directory / f"{CHECKPOINT_ID}-weights.json"
        weight_path.write_text(canonical_json(checkpoint), encoding="utf-8")
        print(f"{record['run_status']} {weight_path}", flush=True)
    else:
        print(f"{record['run_status']} {record_path}", flush=True)


if __name__ == "__main__":
    main()
