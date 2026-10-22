# Inter-Info-Visual-Project
Course project for CPS5745 Interactive Information Visualization, including source code, experiments, and documentation.

## Topic 3A prototype

The pairwise visualization is in [`app/3a/`](app/3a/). It shows M–E, M–L, and E–L for one workload instance, with linked selection, projected and full-space dominance, witness details, and task-event traces. See [`docs/3a.md`](docs/3a.md) for scope, input format, and checks.

For component reuse, shared-state integration, and the remaining A/B/C responsibilities, see the [3A collaborator handoff](docs/3A_合作者交接说明.md). The delivery branch is `A-WORK`.

From the repository root, start a local server with Python (the standard library is enough):

```sh
python -m http.server 8765
```

Open `http://localhost:8765/app/3a/`. The initial seven-point dataset is explicitly a **manual fixture**, not pilot or held-out scheduler results. To package archived contract records for a real instance, run:

```sh
python scripts/build_3a_bundle.py --manifest path/to/experiment_manifest.json --instance-id INSTANCE_ID --output path/to/bundle.json
```

Import the resulting JSON with the button in the app. The viewer rejects records whose event-log metrics disagree with the run record. It withholds official Pareto labels until all seven declared configurations have complete runs on the same non-fixture instance.

Run the 3A checks with `node --test tests/3a.test.mjs tests/3a_startup.test.mjs` and `python -m unittest discover -s tests -p 'test_*.py'`.
