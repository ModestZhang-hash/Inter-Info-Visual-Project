"""Package archived contract records for the read-only Topic 3A viewer."""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from topic3.pareto import classify_all  # noqa: E402


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path, help="ExperimentManifest JSON")
    parser.add_argument("--instance-id", required=True, help="One frozen workload instance ID")
    parser.add_argument("--output", required=True, type=Path, help="Bundle JSON for the 3A viewer")
    args = parser.parse_args()
    manifest_path = args.manifest.resolve()
    base = manifest_path.parent
    manifest = read_json(manifest_path)
    paths = manifest["raw_data_paths"]
    instances = [read_json(base / relative) for relative in paths["instances"]]
    matched = [instance for instance in instances if instance["instance_id"] == args.instance_id]
    if len(matched) != 1:
        parser.error(f"Expected exactly one instance {args.instance_id!r}; found {len(matched)}")
    runs = [read_json(base / relative) for relative in paths["runs"]]
    runs = [run for run in runs if run["instance_id"] == args.instance_id]
    if not runs:
        parser.error("No runs found for the requested instance")
    logs = {}
    events = []
    for run in runs:
        log_path = run["event_log_path"]
        if log_path not in logs:
            logs[log_path] = [json.loads(line) for line in (base / log_path).read_text(encoding="utf-8").splitlines() if line.strip()]
        events.extend(event for event in logs[log_path] if event["run_id"] == run["run_id"])
    configs = manifest["policy_configs"]
    full_set = len(configs) == 7 and all(
        len([run for run in runs if run["policy_config_id"] == config["policy_config_id"]]) == 1
        for config in configs
    ) and all(run["status"] == "complete" for run in runs)
    # This check is independent from the JavaScript classifier in the viewer.
    reference = runs if full_set else []
    bundle = {
        "schema_version": "1.0.0", "manifest": manifest, "instance": matched[0],
        "runs": runs, "events": events,
        "pareto_check": classify_all(reference, manifest["numeric_tolerance"]),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(bundle, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(runs)} runs and {len(events)} task events to {args.output}")


if __name__ == "__main__":
    main()
