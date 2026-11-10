# Inter-Info-Visual-Project
Course project for CPS5745 Interactive Information Visualization, including source code, experiments, and documentation.

## Topic 3A + 3B linked prototype

The unified English page is in [`app/3a/`](app/3a/). It combines M–E, M–L, and E–L plots with a scatterplot matrix, parallel coordinates, and a fixed 3D reference. All views share one validated model, an exploration/filter set, and a separate explicit comparison set limited to 10 runs. Matrix uses individual scatterplots; parallel coordinates default to individual comparison lines with optional faint background lines; 3D shows comparison runs only. A searchable list displays 20 rows per page and opens one evidence record at a time, including full metric values, projected/full-space dominance, witnesses, and task events. The old `/app/3b/` URL redirects to the matrix section of the same page. See [`docs/integration.md`](docs/integration.md) for integration behavior and checks, and [`docs/3a.md`](docs/3a.md) for the data contract and scope.

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

Run all checks with `node --test --test-concurrency=1 tests/3a.test.mjs tests/3a_startup.test.mjs tests/3b.test.mjs` and `python -m unittest discover -s tests -p 'test_*.py'`.
