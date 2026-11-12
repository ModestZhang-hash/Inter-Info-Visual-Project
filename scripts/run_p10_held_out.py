"""Archive the frozen seven-configuration held-out runs."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from topic3.p10 import run_p10  # noqa: E402


def main():
    payload = run_p10(ROOT)
    index = payload["index"]
    print(f"complete {index['runs_complete']} of {index['runs_expected']}; failures {index['failure_count']}")


if __name__ == "__main__":
    main()
