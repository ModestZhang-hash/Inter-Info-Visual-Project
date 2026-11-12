"""Write the pilot record, decision log, and version-1 design freeze."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from topic3.p9 import run_p9  # noqa: E402
from topic3.workload import canonical_json  # noqa: E402


def main():
    result = run_p9(ROOT)
    pilot_dir = ROOT / "artifacts" / "workloads" / "provisional" / "p9_pilot"
    freeze_dir = ROOT / "configs" / "freeze"
    pilot_dir.mkdir(parents=True, exist_ok=True)
    freeze_dir.mkdir(parents=True, exist_ok=True)
    (pilot_dir / "pilot_record.json").write_text(canonical_json(result["pilot_record"]), encoding="utf-8")
    (pilot_dir / "decision_log.json").write_text(canonical_json(result["decision_log"]), encoding="utf-8")
    if result["design_freeze"] is None:
        print(f"pilot_failed {pilot_dir / 'pilot_record.json'}")
        return
    path = freeze_dir / "design_freeze_v1.json"
    path.write_text(canonical_json(result["design_freeze"]), encoding="utf-8")
    print(f"frozen {path}")


if __name__ == "__main__":
    main()
