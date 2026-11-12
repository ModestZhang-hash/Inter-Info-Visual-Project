"""Write the two-episode provisional DQN feasibility record."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from topic3.p8c import INSTANCE_ID, run_p8c  # noqa: E402
from topic3.workload import canonical_json  # noqa: E402


def main():
    document = run_p8c(ROOT)
    path = ROOT / "artifacts" / "workloads" / "provisional" / "p8c_feasibility" / f"{INSTANCE_ID}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(canonical_json(document), encoding="utf-8")
    print(f"{document['run_status']} {path}")


if __name__ == "__main__":
    main()
