"""Write the provisional P1 manifests and frozen workload instances."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from topic3.workload import write_provisional_archive  # noqa: E402


def main():
    root = Path(__file__).resolve().parents[1]
    write_provisional_archive(root)
    print(f"Wrote provisional workloads under {root / 'configs' / 'provisional'}")


if __name__ == "__main__":
    main()
