# Overview, filter, and compare workflow

Updated 2026-11-10. This document describes the current unified application;
older 3A/3B notes describe component history.

## Run the app

From the repository root, run `python -m http.server 8765 --bind 127.0.0.1`
and open `/app/3a/`. `/app/3b/` redirects to the same page. The interface is English.
Use Load 500-run synthetic TEST DATA to exercise larger datasets; Load 7-run manual
demo restores the small fixture with calculated dominance witnesses. Neither
fixture is a scheduler experiment. Original experiment files are not modified.

## User workflow

1. Explore the Matrix or parallel-coordinate overview. Configuration filters
   apply to the exploration set. Matrix always shows individual scatterplot points, including the 500-run
   test dataset. Parallel coordinates default to comparison lines only; faint background lines can be enabled explicitly.
2. Rectangle and axis brushing have been removed from the unified page, along
   with the active-filter panel and clearing buttons. Use configuration checkboxes
   to narrow the runs. Axis ranges control display bounds, not membership.
3. Review matching runs in the searchable, paginated list (20 rows per page).
   Search changes the list only. Add explicit runs to comparison, or add all
   matches if the resulting union has at most 10 members. Larger requests are
   rejected atomically with a visible explanation; there is no silent truncation.
4. Comparison runs share highlighting across views. They remain in the basket
   and graphs when excluded by exploration filters. A basket label identifies
   comparisons outside the filter. Displayed axis ranges remain fixed unless
   edited; comparison runs outside those ranges can be clipped in the 2D views
   but remain in the basket and details.
5. Click a plotted point/line to toggle its comparison membership and inspect
   that record; no modifier key is required. Click View evidence in the list to
   inspect without changing comparisons. The details panel renders
   one record with full-precision metrics, all pairwise/full-space statuses,
   deterministic witnesses, and task events. Export comparisons CSV exports
   only the comparison set with the original metric values.

Clear comparisons leaves configuration visibility in place. Changing configurations
or displayed axes clears the parallel brush constraint to avoid stale brush
geometry; the Matrix constraint persists until explicitly reset. Importing a
new bundle validates it first, then disposes old subscriptions/listeners and
resets exploration, comparison, inspection, list search, and pagination.

## Shared state and reuse

The app calls `createViewState(initial, { runs: model.runs })` once. Passing the
validated run registry activates the new workflow and enforces instance and
completion-status boundaries. Existing unbound `createViewState(initial)` calls
remain supported for component compatibility; the application always uses the
bound workflow. The existing stored `ui_state.json` is not modified. Runtime
extensions are documented here rather than added to the archived data contract.

- `run_filters`: source-keyed arrays of original IDs (`matrix`, `parallel`).
  Absence of a source means unconstrained; an empty array means zero matches.
- `filtered_run_ids`: effective intersection of source constraints and visible
  configurations, restricted to complete runs in the current instance.
- `comparison_run_ids`: explicit comparison set, maximum 10. The legacy
  `selected_run_ids` is a synchronized alias so reusable highlight renderers
  continue to work; it no longer means the exploration/filter result set.
- `inspected_run_id`: one record open in the details panel, independent of both sets.
- `comparison_error`: user-visible explanation of an over-limit request.

Use `filterRuns(ids, {source})`, `clearFilters(source?)`, `addComparisons(ids)`,
`compareRuns(ids)`, `removeComparison(id)`, `toggleComparison(id)`, and `inspectRun(id)`.
Comparison mutations validate/deduplicate IDs and reject sets larger than 10;
`selectRuns` is a compatibility alias for replacing the comparison set.
`filteredRuns` and `comparisonRuns` expose the two separate populations to views.
State is in memory only, not persisted or broadcast between tabs.

## View semantics

**Matrix:** restored to individual scatterplots at every dataset size. At the comparison limit of 10 runs, Matrix and expanded cells hide all other points. Removing a comparison restores the filtered background. This display rule does not change filter membership, axis ranges, or Pareto labels; dragging does not change the candidate or comparison set. Each point
represents one complete run with stable configuration color/shape, original
metric coordinates and separate 2D/full-space Pareto encoding. Matching runs and
explicit comparison runs are shown; comparison points persist outside the filter.
Click a point to toggle comparison membership and inspect. Use Expand to enlarge a cell.
Expand opens the same projection at a larger size. Run-ID labels appear on
hover/focus to reduce label overlap. The reusable renderer still supports bins,
but the Matrix does not activate that option. Dense point overlap remains possible
with hundreds of runs; use configuration visibility, Random 10, and the results list to choose comparisons.

**Parallel coordinates:** individual lines only; the density blocks, mode selector,
legend, and density help have been removed. Only comparisons is enabled by default
in the unified page. Use Random 10 or add runs from the results list; an empty
state explains this before comparisons are added. Turn off Only comparisons to
show faint matching-run background lines. Comparison runs remain independent of
filters and are limited to 10. Axis brushing is disabled. Colored
comparison lines retain raw metric geometry and toggle comparison membership while opening evidence on click. Axis-side
symbols appear only on hover or keyboard focus.

**3D:** only comparison runs are drawn, with an instructional empty state before
any are added. The existing fixed oblique projection and full-space Pareto
encoding remain. Clicking removes that run from comparison and opens its evidence; it then disappears from this comparison-only view. Add it again from Matrix or the results list. Tooltips list nearby overlapping
IDs, and the comparison list provides an unambiguous way to inspect those runs.

**Results/details:** `mountRunList` owns local search, scope (matches/comparisons),
and pagination. The comparison basket is independent of pagination and filters.
Table values are rounded with exact values in tooltips; the evidence panel and
CSV preserve full precision. Only one evidence card is expanded at a time.

## Pareto and data integrity

All existing Pareto calculations use the full validated same-instance reference
set, unrounded metrics, and manifest tolerance. No filter, bin, brush, search,
or comparison action recomputes that reference. A hidden witness remains in the
evidence panel. Aggregates never receive invented Pareto labels or synthetic
average-run vectors. The 500-run synthetic stress fixture intentionally fails
the seven-candidate reference gate and displays Not calculated; the small fixture
still has its prior 2D/3D distinctions and deterministic witnesses.

## Verification

```sh
node --test --test-concurrency=1 tests/3a.test.mjs tests/3a_startup.test.mjs tests/3b.test.mjs
python -m unittest discover -s tests -p "test_*.py"
```

21 JavaScript tests and 9 Python tests pass. Coverage includes atomic comparison
limits, duplicate/unknown/failed/foreign IDs, independent filter intersections,
empty matches, persistence of comparisons outside filters, pagination/search,
500-run load/restore, aggregate membership and numeric boundary conservation,
click-versus-drag pointer capture, cross-view comparison overlays, one-record
inspection, stale event isolation after import, and preserved Pareto evidence.

Remaining limitations: all datasets still live in browser memory; this is not a million-run backend. Enabling background lines for hundreds of runs can be visually crowded. Comparisons can still overlap at identical/nearby
coordinates; inspection via the list remains available. 3D is not rotatable.
No performance benchmark or user-understanding improvement is claimed.

The **Random 10** button replaces the comparison set with an unweighted random sample without replacement from all current matching runs. List search and pagination do not affect sampling. Fewer than 10 matches selects all; zero matches disables the button. Filters, axes, original records, and Pareto reference labels are unchanged. Repeated clicks draw again and may overlap previous samples.

**Show all** restores all complete runs in Matrix by clearing exploration filters and comparisons, enabling all eligible configurations, and restoring default axes. Inspection and Pareto evidence are retained. **Reset axes** restores only axis ranges and clears parallel-axis filters; Matrix filters and comparisons persist. Both actions provide visible status feedback, including when axes were already at their defaults.

Plot clicks and Enter/Space activate `toggleComparison`: inspection is retained even on deselection or an over-limit attempt. Removing a comparison never changes exploration filters, axis ranges, or reference Pareto labels. At 10 comparisons, an additional selection is rejected with feedback above the plots and in the results section. Legacy unbound components retain their original selection API.

The unified page no longer exposes brush filtering or Clear filters. Internal source-filter APIs and unbound component brush callbacks remain for backward compatibility only; current Matrix and parallel views attach no brush handlers or hit regions. Strategy checkboxes, comparison toggles, Random 10, and Pareto evidence remain available.
