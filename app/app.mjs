import { OBJECTIVES } from "./3a/pareto.mjs";
import { defaultAxisRanges } from "./3a/model.mjs";
import { detailsHTML } from "./3a/details.mjs";
import { mountPairPlots } from "./3a/plots.mjs";
import { mountMatrix } from "./3b/matrix.mjs";
import { mountParallel } from "./3b/parallel.mjs";
import { mountView3d } from "./3b/view3d.mjs";
import { POLICY_COLORS, POLICY_SHAPES, stableConfigIndex } from "./shared/encoding.mjs";
import { createSession } from "./shared/session.mjs";
import { text } from "./shared/copy.mjs";

const COPY = { lang: "en" };
const META = {
  makespan_s: { short: "M", label: "Makespan M (s) ↓" },
  energy_j: { short: "E", label: "Task energy E (J) ↓" },
  mean_latency_s: { short: "L", label: "Mean latency L (s) ↓" },
};

let model;
let state;
const unsubscribers = [];

const $ = (id) => document.getElementById(id);
const displayNumber = (value) => Number.isFinite(value) ? Number(value.toPrecision(7)).toString() : "—";

function notice(message, error = false) {
  $("notice").textContent = message;
  $("notice").classList.toggle("error", error);
}

function provenanceText(status) {
  if (status === "fixture_only") return "fixture_only · hand-placed demonstration data · these points are not scheduler results and are not an official seven-candidate front.";
  if (status === "incomplete_candidates") return "Reference set incomplete · runs can be inspected, but the default seven-candidate Pareto labels are hidden.";
  return "Seven complete candidates from one frozen instance · dominance uses unrounded values and the manifest tolerance; filtering does not change the reference set.";
}

function showStatusNotice() {
  if (!model) return;
  if (model.referenceStatus === "fixture_only") {
    notice("fixture_only: hand-placed demonstration data for checking linked 3A, matrix, parallel coordinates, and fixed 3D views. These are not scheduler results and not an official seven-candidate front.");
  } else if (model.referenceStatus === "incomplete_candidates") {
    notice("Reference set incomplete: runs can be inspected, but the default seven-candidate Pareto labels are hidden.");
  } else {
    notice("Seven complete candidates come from one frozen instance. Dominance uses unrounded values and the manifest tolerance. Filtering does not change the reference set.");
  }
}

function disconnect() {
  while (unsubscribers.length) unsubscribers.pop()();
}

function loadBundle(bundle) {
  const next = createSession(bundle);
  disconnect();
  model = next.model;
  state = next.state;
  renderControls();
  unsubscribers.push(
    mountPairPlots($("plots"), model, state, COPY),
    mountMatrix($("matrix"), model, state, COPY),
    mountParallel($("parallel"), model, state, COPY),
    mountView3d($("view3d"), model, state, COPY),
    state.subscribe(renderChrome),
  );
  showStatusNotice();
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
    name.textContent = `${POLICY_SHAPES[index % POLICY_SHAPES.length]} ${text("en").displayName(config.label, config.policy_config_id)}`;
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
          renderChrome(state.get());
          return;
        }
        state.setAxisRange(key, candidate);
        showStatusNotice();
      });
      row.append(input);
    }
    wrapper.append(row);
    axes.append(wrapper);
  }
}

function renderChrome(snapshot) {
  $("instance-id").textContent = snapshot.current_instance_id;
  $("reference-status").textContent = {
    complete: "Seven candidates on one instance · complete",
    incomplete_candidates: "Reference set incomplete",
    fixture_only: "Hand-placed demo · fixture_only · not an official front",
  }[snapshot.pareto_reference_status];
  $("provenance").textContent = provenanceText(snapshot.pareto_reference_status);
  $("reference-ids").textContent = snapshot.pareto_reference_run_ids.length ? snapshot.pareto_reference_run_ids.join(", ") : "None";
  const completeRuns = model.runs.filter((run) => run.status === "complete");
  const visible = completeRuns.filter((run) => snapshot.visible_policy_config_ids.includes(run.policy_config_id));
  $("run-count").textContent = `${visible.length} / ${completeRuns.length}`;
  $("selection-count").textContent = String(snapshot.selected_run_ids.length);
  $("selection-ids").textContent = snapshot.selected_run_ids.length ? snapshot.selected_run_ids.join(", ") : "None";
  for (const input of $("policy-filters").querySelectorAll("input")) {
    input.checked = snapshot.visible_policy_config_ids.includes(input.dataset.configId);
  }
  for (const input of $("axis-controls").querySelectorAll("input")) {
    input.value = displayNumber(snapshot.axis_ranges[input.dataset.axis][input.dataset.side]);
  }
  $("details-content").innerHTML = detailsHTML(model, snapshot, "en");
}

$("bundle-file").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try { loadBundle(JSON.parse(await file.text())); }
  catch (error) { notice(`Import failed: ${error.message}`, true); }
  event.target.value = "";
});
$("select-all").addEventListener("click", () => state?.setVisibleConfigs(model.configs.map((item) => item.policy_config_id)));
$("clear-selection").addEventListener("click", () => state?.selectRuns([]));
$("reset-axes").addEventListener("click", () => {
  if (!state) return;
  for (const [key, range] of Object.entries(defaultAxisRanges(model.runs))) state.setAxisRange(key, range);
  showStatusNotice();
});

try {
  const response = await fetch("../examples/3a-demo/bundle.json");
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  loadBundle(await response.json());
} catch (error) {
  notice(`Could not load the demonstration data: ${error.message}. Start a local HTTP server from the project root.`, true);
}
