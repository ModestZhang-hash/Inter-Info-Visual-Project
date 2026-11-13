import { OBJECTIVES, PAIRS } from "./pareto.mjs";
import { defaultAxisRanges, readBundle } from "./model.mjs";
import { createViewState } from "../shared/state.mjs?v=unlimited-1";
import { mountRunList } from "../shared/run_list.mjs?v=unlimited-1";
import { POLICY_COLORS, POLICY_SHAPES, stableConfigIndex } from "../shared/encoding.mjs?v=ink-1";
import { configLabel, runLabel } from "../shared/labels.mjs";
import { mountMatrix, renderFocusedPair } from "../3b/matrix.mjs?v=ink-18";
import { mountParallel } from "../3b/parallel.mjs?v=ink-1";
import { mountView3d } from "../3b/view3d.mjs?v=ink-17";

const META = {
  makespan_s: { short: "M", label: "Makespan M (s) ↓" },
  energy_j: { short: "E", label: "Task-related energy E (J) ↓" },
  mean_latency_s: { short: "L", label: "Mean end-to-end latency L (s) ↓" },
};
let model;
let state;
let unsubscribe;
let unmountViews = [];
let focusedPair = null;

const $ = (id) => document.getElementById(id);
const safe = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const number = (value) => Number.isFinite(value) ? Number(value.toPrecision(7)).toString() : "—";
const fullNumber = (value) => Number.isFinite(value) ? String(value) : "—";
const configName = (config) => configLabel(model, config);
const runName = (run) => runLabel(model, run);

function notice(message, error = false) {
  $("notice").textContent = message;
  $("notice").classList.toggle("error", error);
}

function loadBundle(bundle) {
  const next = readBundle(bundle);
  const axisRanges = defaultAxisRanges(next.runs);
  if (unsubscribe) unsubscribe();
  unmountViews.forEach(unmount => unmount());
  model = next;
  $("controls-feedback").textContent = "";
  $("parallel-title").textContent = next.instance.intensity_label === "synthetic-stress-test" && next.manifest.phase === "fixture"
    ? `Parallel coordinates · SYNTHETIC TEST DATA (${next.runs.length} runs)` : "Parallel coordinates";
  closeFocusedPair();
  state = createViewState({
    schema_version: "1.0.0",
    current_instance_id: next.instance.instance_id,
    selected_run_ids: [],
    visible_policy_config_ids: next.configs.map((item) => item.policy_config_id),
    axis_ranges: axisRanges,
    pareto_reference_run_ids: next.referenceStatus === "complete" ? next.referenceRuns.map((run) => run.run_id) : [],
    pareto_reference_status: next.referenceStatus,
  }, { runs: model.runs });
  renderControls();
  // All four view types subscribe to this one model/state pair.
  unmountViews = [
    mountMatrix($("matrix"), model, state, { onExpand: openFocusedPair }),
    mountParallel($("parallel"), model, state, {
      onlySelectedInput: $("parallel-only-selected"),
      summary: $("parallel-count"),
    }),
    mountView3d($("view3d"), model, state),
    mountRunList($("run-list"), model, state, {
      searchInput: $("run-search"), scopeInput: $("run-scope"), prevButton: $("runs-prev"), nextButton: $("runs-next"),
      pageSummary: $("runs-page"), basket: $("comparison-basket"), message: $("comparison-message"), compareMatchesButton: $("compare-matches"),
      randomCompareButton: $("random-compare"), randomCountInput: $("random-count"), randomFeedback: $("random-feedback"),
    }),
  ];
  unsubscribe = state.subscribe(render);
  if (next.instance.intensity_label === "synthetic-stress-test" && next.referenceStatus === "fixture_only") notice(`SYNTHETIC TEST DATA — ${next.runs.length} generated runs on one test instance. For visualization stress testing only; not scheduler outputs or algorithm comparisons. Pareto labels and witnesses are not calculated for this dataset.`);
  else if (next.referenceStatus === "fixture_only") notice(`Manual demo data: ${next.runs.length} fixed placements for checking interactions and dominance calculations. These are not scheduler outputs or formal experimental results.`);
  else if (next.referenceStatus === "incomplete_candidates") notice("Incomplete reference set: runs and event records are available, but default seven-candidate Pareto labels are withheld.");
  else notice("Seven complete candidates share one frozen instance. Dominance uses unrounded values and manifest tolerances; filters do not change the reference set.");
}

function renderControls() {
  const filters = $("policy-filters");
  filters.replaceChildren();
  model.configs.forEach((config) => {
    const index = stableConfigIndex(model.configs, config.policy_config_id);
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = true;
    input.dataset.configId = config.policy_config_id;
    input.addEventListener("change", () => {
      const ids = [...filters.querySelectorAll("input:checked")].map((item) => item.dataset.configId);
      state.setVisibleConfigs(ids);
    });
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = POLICY_COLORS[index % POLICY_COLORS.length];
    const name = document.createElement("span");
    name.textContent = `${POLICY_SHAPES[index % POLICY_SHAPES.length]} ${configName(config)}`;
    label.append(input, swatch, name);
    filters.append(label);
  });
  const axes = $("axis-controls");
  axes.replaceChildren();
  for (const key of OBJECTIVES) {
    const wrapper = document.createElement("label");
    wrapper.textContent = META[key].label;
    const row = document.createElement("div");
    row.className = "axis-row";
    for (const side of ["min", "max"]) {
      const input = document.createElement("input");
      input.type = "number";
      input.step = "any";
      input.dataset.axis = key;
      input.dataset.side = side;
      input.setAttribute("aria-label", `${META[key].label} ${side}`);
      input.addEventListener("change", () => {
        const current = state.get().axis_ranges[key];
        const candidate = { ...current, [side]: Number(input.value) };
        if (!Number.isFinite(candidate.min) || !Number.isFinite(candidate.max) || candidate.min >= candidate.max) {
          notice("Invalid axis range: the minimum must be less than the maximum.", true);
          render(state.get());
          return;
        }
        state.setAxisRange(key, candidate);
      });
      row.append(input);
    }
    wrapper.append(row);
    axes.append(wrapper);
  }
}

function render(snapshot) {
  $("controls-feedback").textContent = snapshot.comparison_error;
  $("instance-id").textContent = snapshot.current_instance_id;
  $("reference-status").textContent = {
    complete: "Seven candidates · Complete",
    incomplete_candidates: "Incomplete reference set",
    fixture_only: model.labels.full.size ? "Manual demo · Not an experimental front" : "Test fixtures · Pareto not calculated",
  }[snapshot.pareto_reference_status];
  const completeRuns = model.runs.filter((run) => run.status === "complete");
  const visible = completeRuns.filter((run) => snapshot.visible_policy_config_ids.includes(run.policy_config_id));
  $("run-count").textContent = `${visible.length} / ${completeRuns.length}`;
  $("selection-count").textContent = `${snapshot.comparison_run_ids.length} selected`;
  $("matching-count").textContent = String(snapshot.filtered_run_ids.length);
  $("selection-ids").textContent = snapshot.selected_run_ids.join(", ") || "None";
  $("reference-ids").textContent = snapshot.pareto_reference_run_ids.join(", ") || "None (demo or incomplete set)";
  for (const input of $("policy-filters").querySelectorAll("input")) input.checked = snapshot.visible_policy_config_ids.includes(input.dataset.configId);
  for (const input of $("axis-controls").querySelectorAll("input")) input.value = number(snapshot.axis_ranges[input.dataset.axis][input.dataset.side]);
  if (focusedPair) renderFocusedPair($("focused-plot"), model, state, ...focusedPair);
  renderDetails(snapshot);
}

function statusText(entry) { return entry ? entry.nonDominated ? "Non-dominated" : "Dominated" : "Not calculated"; }

function renderDetails(snapshot) {
  const box = $("details-content");
  const run = model.runs.find(run => run.run_id === snapshot.inspected_run_id);
  if (!run) { box.innerHTML = `<p class="muted">Click a point or line to toggle its comparison membership and open its evidence. View evidence in the results list opens a record without changing comparisons.</p>`; return; }
  box.innerHTML = detailCard(run);

}

function detailCard(run) {
  const events = model.events.filter((event) => event.run_id === run.run_id);
  const rows = PAIRS.map((pair) => {
    const result = model.labels.pairs.get(pair.join("|"))?.get(run.run_id);
    const name = pair.map((key) => META[key].short).join("–");
    return `<li><strong>${name}: </strong>${statusText(result)}${result?.witnesses.length ? witness(result) : ""}</li>`;
  }).join("");
  const full = model.labels.full.get(run.run_id);
  const taskRows = events.map((event) => `<tr><td>${safe(event.task_id)}</td><td>${safe(event.destination_id)}</td><td>${fullNumber(event.upload_start_s)} → ${fullNumber(event.upload_end_s)}</td><td>${fullNumber(event.compute_start_s)} → ${fullNumber(event.compute_end_s)}</td><td>${fullNumber(event.return_start_s)} → ${fullNumber(event.return_end_s)}</td><td>${fullNumber(event.completion_s)}</td><td>${fullNumber(event.compute_energy_j)} + ${fullNumber(event.transfer_energy_j)}</td></tr>`).join("");
  return `<article class="detail-card"><h3>${safe(runName(run))} <span class="muted">${safe(run.run_id)}</span></h3>
    <div class="metrics"><span>M <strong>${fullNumber(run.makespan_s)} s</strong></span><span>E <strong>${fullNumber(run.energy_j)} J</strong></span><span>L <strong>${fullNumber(run.mean_latency_s)} s</strong></span></div>
    <p class="muted">Instance ${safe(run.instance_id)} · Configuration ${safe(run.policy_config_id)} · ${safe(run.record_origin)}</p>
    <p class="${model.referenceStatus === "complete" ? "" : "warning"}">${model.referenceStatus === "complete" ? "Reference set: seven complete candidates for the same instance. Filters do not change the labels." : model.referenceStatus === "fixture_only" ? model.labels.full.size ? "Dominance calculated from manual examples; not an experimental front." : "TEST DATA ONLY — not scheduler results. Pareto labels and witnesses are not calculated for this dataset." : "Incomplete reference set; no formal dominance labels."}</p>
    <ul class="status-list">${rows}<li><strong>Full 3D M–E–L: </strong>${statusText(full)}${full?.witnesses.length ? witness(full) : ""}</li></ul>
    <div class="table-wrap"><table><thead><tr><th>Task</th><th>Node</th><th>Upload (s)</th><th>Compute (s)</th><th>Return (s)</th><th>Completion (s)</th><th>Energy J (compute + transfer)</th></tr></thead><tbody>${taskRows}</tbody></table></div></article>`;
}

function witness(classification) {
  const entry = classification.witnesses[0];
  const candidate = model.runs.find((run) => run.run_id === entry.witnessRunId);
  const relationName = { strict_improvement: "Strictly better", equal: "Equal", equivalent_within_tolerance: "Equivalent within tolerance" };
  const dimensions = entry.comparedObjectives.map((key) => `${META[key].short}: ${relationName[entry.relations[key]]}`).join("; ");
  const target = OBJECTIVES.map((key) => `${META[key].short}=${fullNumber(entry.targetMetrics[key])}`).join(", ");
  const source = OBJECTIVES.map((key) => `${META[key].short}=${fullNumber(entry.witnessMetrics[key])}`).join(", ");
  const others = classification.witnessRunIds.length > 1 ? `; Other valid witnesses: ${classification.witnessRunIds.slice(1).map(safe).join(", ")}` : "";
  return `<div class="witness">Dominance witness (first by run_id lexicographic order): <strong>${safe(entry.witnessRunId)}</strong> (${safe(runName(candidate))}). Compared objectives ${safe(entry.comparedObjectives.map((key) => META[key].short).join("–"))}: ${safe(dimensions)}.<br>Selected run: ${safe(target)}<br>Witness run: ${safe(source)}${others}</div>`;
}

// Presentation switches keep all mounted views on the same model and state.
function showView(active) {
  for (const view of ["scatter", "parallel", "view3d"]) {
    $(`${view}-section`).hidden = view !== active;
    $(`show-${view}`).setAttribute("aria-pressed", String(view === active));
  }
}
function openFocusedPair(xKey, yKey) {
  focusedPair = [xKey, yKey];
  $("matrix-section").hidden = true;
  $("focused-section").hidden = false;
  $("focused-title").textContent = `${META[xKey].label.replace(" ↓", "")} × ${META[yKey].label.replace(" ↓", "")}`;
  renderFocusedPair($("focused-plot"), model, state, xKey, yKey);
  $("back-to-matrix").focus?.();
}
function closeFocusedPair() {
  focusedPair = null;
  $("matrix-section").hidden = false;
  $("focused-section").hidden = true;
  $("focused-plot").replaceChildren();
}
for (const view of ["scatter", "parallel", "view3d"]) {
  $(`show-${view}`).addEventListener("click", () => showView(view));
}
$("back-to-matrix").addEventListener("click", () => {
  closeFocusedPair();
  $("show-scatter").focus?.();
});
showView("scatter");
closeFocusedPair();

async function loadDemo(path, view) {
  const controls = [$("load-stress-demo"), $("load-small-demo"), $("bundle-file")];
  controls.forEach(control => { control.disabled = true; });
  try {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    loadBundle(await response.json());
    showView(view);
  } catch (error) { notice(`Demo load failed: ${error.message}`, true); }
  finally { controls.forEach(control => { control.disabled = false; }); }
}
$("load-stress-demo").addEventListener("click", () => loadDemo("../../examples/synthetic-stress-500/bundle.json", "scatter"));
$("load-small-demo").addEventListener("click", () => loadDemo("../../examples/3a-demo/bundle.json", "scatter"));

$("bundle-file").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try { loadBundle(JSON.parse(await file.text())); }
  catch (error) { notice(`Import failed: ${error.message}`, true); }
  event.target.value = "";
});
$("select-all").addEventListener("click", () => {
  if (!state) return;
  state.showAllRuns(defaultAxisRanges(model.runs));
  $("controls-feedback").textContent = "Showing all runs in Matrix. Filters and comparisons cleared; axis ranges restored. Pareto evidence is unchanged.";
});
$("clear-selection").addEventListener("click", () => state?.compareRuns([]));
$("reset-axes").addEventListener("click", () => {
  if (!state) return;
  const ranges = defaultAxisRanges(model.runs), before = state.get();
  const changed = Object.entries(ranges).some(([key, range]) => before.axis_ranges[key].min !== range.min || before.axis_ranges[key].max !== range.max);
  for (const [key, range] of Object.entries(ranges)) state.setAxisRange(key, range);
  $("controls-feedback").textContent = `${changed ? "Axis ranges restored." : "Axis ranges were already at their defaults."} Comparisons and visible configurations are unchanged; use Show all to restore all Matrix points.`;
});
$("export-csv").addEventListener("click", () => {
  if (!model || !state) return;
  const selected = new Set(state.get().selected_run_ids);
  const rows = model.runs.filter((run) => selected.has(run.run_id));
  if (!rows.length) { notice("Add at least one run to comparison before exporting.", true); return; }
  const columns = ["instance_id", "run_id", "policy_config_id", "status", ...OBJECTIVES];
  const csv = [columns.join(","), ...rows.map((run) => columns.map((key) => `"${String(run[key] ?? "").replaceAll('"', '""')}"`).join(","))].join("\r\n") + "\r\n";
  const url = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `topic3a-${model.instance.instance_id}-comparison.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

try {
  const bundleKey = new URLSearchParams(globalThis.location?.search ?? "").get("bundle");
  const path = bundleKey === "p3-training-low"
    ? "../../examples/p3-training-low/bundle.json"
    : bundleKey === "p6-six-heuristic"
      ? "../../examples/p6-six-heuristic/bundle.json"
      : bundleKey === "p11-held-out-low-3000"
        ? "../../examples/p11-held-out-low-3000/bundle.json"
        : "../../examples/3a-demo/bundle.json";
  const response = await fetch(path);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  loadBundle(await response.json());
} catch (error) {
  notice(`Unable to load demo data: ${error.message}. Start a local HTTP server from the repository root.`, true);
}
