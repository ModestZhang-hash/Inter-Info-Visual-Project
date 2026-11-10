# Synthetic stress demo — TEST DATA ONLY

500 synthetic runs, 4,000 complete task events, one frozen instance with eight tasks.
These are arithmetic test fixtures for visualization and interaction checks, NOT
scheduler outputs, measured experiments, algorithm comparisons, or DQN results.

Open `/app/3a/` and click **Load 500-run synthetic TEST DATA**. The page switches
to parallel coordinates. Brush an axis to filter the results, then add up to 10 runs from the results list to comparison. **Only comparisons** hides the overview background. **Load 7-run
manual demo** restores the small example and its existing dominance evidence.
Loading either dataset clears selection and local brush/display controls.

The three synthetic color groups A/B/C share the same generation rule and are
not scheduling algorithms. Run IDs and instance IDs explicitly include
`synthetic`. `phase=fixture`, `record_origin=manual_fixture`, and null simulator
and checkpoint fields preserve the existing contract's fixture provenance.

Generation uses fixed seed 5745500. Node rates/powers are read from the existing
contract template without modifying it. Tasks receive seeded synthetic sizes;
each trace assigns seeded destinations and inserts artificial idle gaps.
Tasks are serialized to avoid overlapping resources. Stage durations use the
declared node rates, and M/E/L are recomputed from complete events. This is an
analytic fixture constructor, not a scheduling simulator or a policy benchmark.

The existing seven-candidate Pareto gate is unchanged. This 500-run dataset has
no Pareto labels or dominance witnesses: the page explicitly says **Not
calculated**. Use the small demo to inspect those features. Do not interpret
absence of a Pareto ring as a dominated classification.

Regenerate from the repository root:

```sh
python scripts/build_stress_demo.py
```

The generator writes only this dedicated directory. `bundle.json` is directly
importable. The manifest, instance, 500 individual run records, and JSONL event
log are also archived here for reproducible checking with existing tools.
Existing `examples/contract` and `examples/3a-demo` files are never overwritten.

This dataset tests visual clutter and interaction behavior; it does not prove
large-data performance or improved user comprehension. Large selections still
produce many SVG lines and detail cards. Density overview is now the default for this dataset. Its blue-gray cells represent aggregate run counts; only explicit comparison runs (maximum 10) are overlaid as individual lines. Individual lines remains available through the Background dropdown.
