import { filteredRuns, comparisonRuns } from "../shared/state.mjs?v=workflow-1";
import { runLabel } from "../shared/labels.mjs";
import { OBJECTIVES } from "../3a/pareto.mjs";
import { POLICY_COLORS, POLICY_SHAPES, stableConfigIndex } from "../shared/encoding.mjs";

const META = {
  makespan_s: { short: "M", unit: "s", label: "Makespan M (s) ↓" },
  energy_j: { short: "E", unit: "J", label: "Task-related energy E (J) ↓" },
  mean_latency_s: { short: "L", unit: "s", label: "Mean end-to-end latency L (s) ↓" },
};

export const PARALLEL_LAYOUT = { width: 920, height: 420, top: 58, bottom: 356, left: 86, right: 884 };

function element(tag, className) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  if (className) node.setAttribute("class", className);
  return node;
}

export function valueToAxisY(value, range) {
  const { top, bottom } = PARALLEL_LAYOUT;
  const t = (value - range.min) / (range.max - range.min);
  return bottom - t * (bottom - top);
}

export function axisYToValue(y, range) {
  const { top, bottom } = PARALLEL_LAYOUT;
  const t = (bottom - y) / (bottom - top);
  return range.min + t * (range.max - range.min);
}

function pointerY(svg, event) {
  const rect = svg.getBoundingClientRect();
  return (event.clientY - rect.top) * PARALLEL_LAYOUT.height / rect.height;
}

function visibleRuns(model, snapshot) {
  if (snapshot.filtered_run_ids) return filteredRuns(model, snapshot);
  return model.runs.filter((run) =>
    run.instance_id === snapshot.current_instance_id &&
    run.status === "complete" &&
    snapshot.visible_policy_config_ids.includes(run.policy_config_id));
}

function formatRaw(value) {
  return Number.isFinite(value) ? String(value) : "—";
}

function displayTick(value) {
  return Number.isFinite(value) ? Number(value.toPrecision(7)).toString() : "—";
}

function axisX(index) {
  const { left, right } = PARALLEL_LAYOUT;
  return left + index * (right - left) / (OBJECTIVES.length - 1);
}

export function mountParallel(container, model, sharedState, controls = {}) {
  if (!container) throw new Error("Parallel container is required");
  const workflow = Boolean(sharedState.filterRuns);
  const { onlySelectedInput, summary, brushSummary, clearBrushButton } = controls;
  let onlySelected = workflow;
  if (onlySelectedInput) onlySelectedInput.checked = onlySelected;
  const brushes = new Map();
  let brushOrigin = null;
  let drag = null;
  let contextKey = null;

  const updateBrushSummary = (snapshot, bands = brushes, preview = false) => {
    const candidates = workflow ? filteredRuns(model, snapshot, "parallel") : visibleRuns(model, snapshot);
    if (brushSummary) brushSummary.textContent = bands.size
      ? `${preview ? "Brush preview" : "Brush matches"}: ${matchingRuns(candidates, bands).length} / ${candidates.length} filter-visible runs · ${bands.size} active ${bands.size === 1 ? "axis" : "axes"} (intersection). Shift adds matches to the shared selection.`
      : "No active axis brushes. Drag along an axis to select runs.";
    if (workflow && brushSummary) brushSummary.textContent = bands.size
      ? `${preview ? "Brush preview" : "Brush matches"}: ${matchingRuns(candidates, bands).length} / ${candidates.length} candidates · ${bands.size} active axes (intersection). Comparisons are unchanged.`
      : snapshot.run_filters.parallel ? `Parallel filter active · ${snapshot.filtered_run_ids.length} matching runs. Add comparisons from the results list.` : "Drag along an axis to filter runs; comparisons are unchanged.";
    if (clearBrushButton) clearBrushButton.disabled = workflow ? !snapshot.run_filters.parallel && !brushes.size : brushes.size === 0;
  };

  const render = (snapshot) => {
    const nextContext = JSON.stringify([snapshot.current_instance_id, snapshot.visible_policy_config_ids, snapshot.axis_ranges]);
    const selectedKey = snapshot.selected_run_ids.join("|");
    if ((contextKey !== null && nextContext !== contextKey) || (!workflow && brushOrigin !== null && selectedKey !== brushOrigin) || (workflow && !snapshot.run_filters.parallel)) {
      brushes.clear();
      brushOrigin = null;
      drag = null;
    }
    contextKey = nextContext;
    const { width, height, top, bottom } = PARALLEL_LAYOUT;
    const svg = element("svg");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Parallel coordinates: minimize M, E, and L. Positions use axis ranges; tooltips preserve raw values.");
    const candidates = visibleRuns(model, snapshot);
    const selectedIds = new Set(snapshot.selected_run_ids);
    const selectedVisible = workflow ? comparisonRuns(model, snapshot) : candidates.filter(run => selectedIds.has(run.run_id));
    const inside = run => OBJECTIVES.every(key => run[key] >= snapshot.axis_ranges[key].min && run[key] <= snapshot.axis_ranges[key].max);
    const runs = (onlySelected ? selectedVisible : workflow
      ? [...new Map([...candidates, ...selectedVisible].map(run => [run.run_id, run])).values()] : candidates).slice()
      .sort((a, b) => Number(selectedIds.has(a.run_id)) - Number(selectedIds.has(b.run_id)));
    if (summary) summary.textContent = workflow
      ? `Matching: ${candidates.length} runs · Comparing: ${selectedIds.size} · ${onlySelected ? "Comparison lines" : "Displayed lines"}: ${runs.length} · ${selectedVisible.filter(run => !inside(run)).length} comparisons outside displayed axes`
      : `Selected: ${selectedIds.size} total · ${selectedVisible.length} / ${candidates.length} filter-visible · Displayed: ${runs.length} lines${selectedIds.size > selectedVisible.length ? ` · ${selectedIds.size - selectedVisible.length} selected hidden by filters` : ""}`;
    if (!workflow) updateBrushSummary(snapshot);
    OBJECTIVES.forEach((key, index) => {
      const x = axisX(index);
      const range = snapshot.axis_ranges[key];
      const axis = element("g", "pc-axis");
      axis.dataset.role = "axis";
      axis.dataset.axis = key;
      axis.dataset.plotTop = String(top);
      axis.dataset.plotBottom = String(bottom);
      axis.dataset.rangeMin = String(range.min);
      axis.dataset.rangeMax = String(range.max);
      const stem = element("line", "pc-stem");
      stem.setAttribute("x1", x);
      stem.setAttribute("x2", x);
      stem.setAttribute("y1", top);
      stem.setAttribute("y2", bottom);
      const name = element("text", "pc-axis-name");
      const anchor = index === 0 ? "start" : index === OBJECTIVES.length - 1 ? "end" : "middle";
      name.setAttribute("x", index === 0 ? x - 46 : index === OBJECTIVES.length - 1 ? x + 46 : x);
      name.setAttribute("y", "22");
      name.setAttribute("text-anchor", anchor);
      name.textContent = META[key].label;
      const tickAnchor = index === OBJECTIVES.length - 1 ? "end" : "start";
      const tickX = index === OBJECTIVES.length - 1 ? x - 8 : x + 8;
      const maxLabel = element("text", "pc-tick");
      maxLabel.setAttribute("x", tickX);
      maxLabel.setAttribute("y", top + 4);
      maxLabel.setAttribute("text-anchor", tickAnchor);
      maxLabel.textContent = displayTick(range.max);
      const minLabel = element("text", "pc-tick");
      minLabel.setAttribute("x", tickX);
      minLabel.setAttribute("y", bottom + 4);
      minLabel.setAttribute("text-anchor", tickAnchor);
      minLabel.textContent = displayTick(range.min);
      axis.append(stem, name, maxLabel, minLabel);
      if (!workflow) {
      const preview = element("rect", "pc-brush");
      preview.dataset.brushPreview = key;
      preview.setAttribute("visibility", "hidden");
      const stored = brushes.get(key);
      if (stored) {
        const y0 = valueToAxisY(stored.hi, range);
        const y1 = valueToAxisY(stored.lo, range);
        preview.setAttribute("visibility", "visible");
        preview.setAttribute("x", String(x - 16));
        preview.setAttribute("y", String(Math.min(y0, y1)));
        preview.setAttribute("width", "32");
        preview.setAttribute("height", String(Math.max(Math.abs(y1 - y0), 1)));
      }
      const hit = element("rect", "pc-hit");
      hit.dataset.axis = key;
      hit.setAttribute("x", String(x - 14));
      hit.setAttribute("y", String(top));
      hit.setAttribute("width", "28");
      hit.setAttribute("height", String(bottom - top));
      hit.addEventListener("pointerdown", (event) => {
        if (event.target?.closest?.("[data-run-id]")) return;
        drag = { key, startY: pointerY(svg, event) };
        svg.setPointerCapture?.(event.pointerId);
      });
      axis.append(preview, hit);
      }
      svg.append(axis);
    });
    for (const run of runs) {
      const slot = stableConfigIndex(model.configs, run.policy_config_id);
      const color = POLICY_COLORS[slot % POLICY_COLORS.length];
      const selected = selectedIds.has(run.run_id);
      const points = OBJECTIVES.map((key, position) => `${axisX(position)},${valueToAxisY(run[key], snapshot.axis_ranges[key])}`);
      const group = element("g", selected ? "pc-line selected" : "pc-line");
      group.dataset.runId = run.run_id;
      group.dataset.selected = selected ? "true" : "false";
      group.setAttribute("tabindex", "0");
      group.setAttribute("role", "button");
      group.style.setProperty?.("--policy-color", color);
      const title = element("title");
      title.textContent = `${runLabel(model, run)} | ${run.run_id}\n`
        + `M=${formatRaw(run.makespan_s)} s, E=${formatRaw(run.energy_j)} J, L=${formatRaw(run.mean_latency_s)} s`;
      group.setAttribute("aria-label", title.textContent);
      const path = element("path");
      path.setAttribute("d", `M${points.join(" L")}`);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", selected ? color : "#84938e");
      path.setAttribute("stroke-opacity", selected ? "1" : "0.22");
      path.setAttribute("stroke-width", selected ? "3.5" : "1");
      const glyph = element("text", "pc-shape");
      glyph.setAttribute("x", String(axisX(0) - 28));
      glyph.setAttribute("y", String(valueToAxisY(run.makespan_s, snapshot.axis_ranges.makespan_s) + 4));
      glyph.textContent = POLICY_SHAPES[slot % POLICY_SHAPES.length];
      group.append(title, path, glyph);
      const choose = (shift) => {
        if (workflow) { sharedState.toggleComparison(run.run_id); return; }
        brushes.clear();
        brushOrigin = null;
        const ids = shift ? [...sharedState.get().selected_run_ids, run.run_id] : [run.run_id];
        sharedState.selectRuns(ids);
      };
      group.addEventListener("click", (event) => choose(event.shiftKey));
      group.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          choose(event.shiftKey);
        }
      });
      svg.append(group);
    }
    if (!runs.length) {
      const empty = element("text", "pc-empty");
      empty.setAttribute("x", String(width / 2));
      empty.setAttribute("y", String(height / 2));
      empty.setAttribute("text-anchor", "middle");
      empty.textContent = onlySelected
        ? workflow ? "No comparisons yet. Select a random sample, add runs from the results list, or turn off Only comparisons." : "No selected runs to display. Select runs in another view, brush an axis, or turn off Only selected."
        : "No complete runs within the current filters and displayed axes";
      svg.append(empty);
    }
    if (!workflow) {
    svg.addEventListener("pointermove", (event) => {
      if (!drag) return;
      const y = pointerY(svg, event);
      const preview = findBrushPreview(svg, drag.key);
      if (!preview) return;
      const x = axisX(OBJECTIVES.indexOf(drag.key));
      preview.setAttribute("visibility", "visible");
      preview.setAttribute("x", String(x - 16));
      preview.setAttribute("y", String(Math.min(drag.startY, y)));
      preview.setAttribute("width", "32");
      preview.setAttribute("height", String(Math.max(Math.abs(y - drag.startY), 1)));
      const snapshot = sharedState.get();
      const range = snapshot.axis_ranges[drag.key];
      const bands = new Map(brushes);
      const a = axisYToValue(drag.startY, range), b = axisYToValue(y, range);
      bands.set(drag.key, { lo: Math.min(a, b), hi: Math.max(a, b) });
      updateBrushSummary(snapshot, bands, true);
    });
    svg.addEventListener("pointerup", (event) => {
      if (!drag) return;
      const { key, startY } = drag;
      const endY = pointerY(svg, event);
      drag = null;
      const range = sharedState.get().axis_ranges[key];
      if (Math.abs(endY - startY) <= 5) {
        brushes.delete(key);
        if (brushes.size) commit(sharedState, model, brushes, event.shiftKey, (value) => { brushOrigin = value; });
        else { brushOrigin = null; if (workflow) sharedState.clearFilters("parallel"); else render(sharedState.get()); }
        return;
      }
      const lo = Math.min(axisYToValue(startY, range), axisYToValue(endY, range));
      const hi = Math.max(axisYToValue(startY, range), axisYToValue(endY, range));
      brushes.set(key, { lo, hi });
      commit(sharedState, model, brushes, event.shiftKey, (value) => { brushOrigin = value; });
    });
    svg.addEventListener("pointercancel", () => { drag = null; render(sharedState.get()); });
    }
    container.replaceChildren(svg);
  };
  const toggle = () => { onlySelected = onlySelectedInput.checked; render(sharedState.get()); };
  const clear = () => { brushes.clear(); brushOrigin = null; drag = null; if (workflow) sharedState.clearFilters("parallel"); else render(sharedState.get()); };
  onlySelectedInput?.addEventListener("change", toggle);
  clearBrushButton?.addEventListener("click", clear);
  const unsubscribe = sharedState.subscribe(render);
  return () => {
    unsubscribe();
    onlySelectedInput?.removeEventListener("change", toggle);
    clearBrushButton?.removeEventListener("click", clear);
  };
}

function findBrushPreview(svg, key) {
  for (const node of svg.children) {
    for (const child of node.children ?? []) {
      if (child.dataset?.brushPreview === key) return child;
    }
  }
  return null;
}

function matchingRuns(runs, brushes) {
  return runs.filter(run => [...brushes].every(([key, band]) => run[key] >= band.lo && run[key] <= band.hi));
}

function commit(sharedState, model, brushes, shift, setOrigin) {
  const snapshot = sharedState.get();
  const matched = matchingRuns(visibleRuns(model, sharedState.filterRuns ? { ...snapshot, run_filters: {} } : snapshot), brushes).map(run => run.run_id);
  if (sharedState.filterRuns) { sharedState.filterRuns(matched, { source: "parallel" }); return; }
  const merged = [...new Set(shift ? [...snapshot.selected_run_ids, ...matched] : matched)];
  setOrigin(merged.join("|"));
  sharedState.selectRuns(merged);
}
