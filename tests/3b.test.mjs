import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { OBJECTIVES } from "../app/3a/pareto.mjs";
import { defaultAxisRanges, readBundle } from "../app/3a/model.mjs";
import { POLICY_COLORS, stableConfigIndex } from "../app/shared/encoding.mjs";
import { listPage, randomComparisonIds } from "../app/shared/run_list.mjs";
import { binPairs } from "../app/shared/pair_density.mjs";
import { createViewState } from "../app/shared/state.mjs";
import { mountMatrix } from "../app/3b/matrix.mjs";
import { axisYToValue, mountParallel, PARALLEL_LAYOUT, valueToAxisY } from "../app/3b/parallel.mjs";
import { coincidentIds, mountView3d, projectRun, projectNormalized, DEFAULT_CAMERA, constrainCamera } from "../app/3b/view3d.mjs";

const fixture = JSON.parse(readFileSync(new URL("../examples/3a-demo/bundle.json", import.meta.url), "utf8"));
const clone = () => structuredClone(fixture);
const stressFixture = JSON.parse(readFileSync(new URL("../examples/synthetic-stress-500/bundle.json", import.meta.url), "utf8"));

function createDom() {
  class Element {
    constructor(tag = "div") {
      this.tagName = tag;
      this.children = [];
      this.dataset = {};
      this.style = {};
      this.listeners = {};
      this.attributes = {};
      this.className = "";
      this.classList = { toggle() {} };
      this.textContent = "";
      this._html = "";
      this.checked = false;
      this.value = "";
      this.type = "";
      this.markers = null;
    }
    set innerHTML(value) { this._html = value; this.markers = null; this.bins = null; }
    get innerHTML() { return this._html; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = [...nodes]; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name]; }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    removeEventListener(name, callback) { if (this.listeners[name] === callback) delete this.listeners[name]; }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
    querySelectorAll(selector) {
      if (selector === "[data-bin-index]") {
        if (!this.bins) this.bins = [...this._html.matchAll(/data-bin-index="(\d+)" data-count="(\d+)"/g)].map(match => {
          const el = new Element("rect"); el.dataset.binIndex = match[1]; el.dataset.count = match[2]; return el;
        });
        return this.bins;
      }
      if (selector === "[data-run-id]") {
        const fromTree = [];
        const visit = (node) => {
          for (const child of node.children) {
            if (child.dataset?.runId) fromTree.push(child);
            visit(child);
          }
        };
        visit(this);
        if (fromTree.length) return fromTree;
        if (!this.markers) {
          this.markers = [...this._html.matchAll(/data-run-id="([^"]+)"/g)].map((match) => {
            const marker = new Element("g");
            marker.dataset.runId = match[1];
            return marker;
          });
        }
        return this.markers;
      }
      if (selector === ".brush") return [new Element("rect")];
      const found = [];
      const visit = (node) => {
        for (const child of node.children) {
          if (matches(child, selector)) found.push(child);
          visit(child);
        }
      };
      visit(this);
      return found;
    }
    getBoundingClientRect() { return { left: 0, top: 0, width: 600, height: 390 }; }
    setPointerCapture() {}
  }
  const matches = (node, selector) => {
    if (selector === "svg") return node.tagName === "svg";
    if (selector === "input") return node.tagName === "input";
    if (selector === "input:checked") return node.tagName === "input" && node.checked;
    return false;
  };
  const elements = new Map();
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new Element("div"));
      return elements.get(id);
    },
    createElement(tag = "div") { return new Element(tag); },
    createElementNS(_namespace, tag) { return new Element(tag); },
  };
  return { document, elements };
}

function withDocument(run) {
  const prior = globalThis.document;
  const dom = createDom();
  globalThis.document = dom.document;
  const finish = () => { globalThis.document = prior; };
  const result = run(dom);
  return Promise.resolve(result).finally(finish);
}

function initialState(model, visible = model.configs.map((item) => item.policy_config_id)) {
  return createViewState({
    schema_version: "1.0.0",
    current_instance_id: model.instance.instance_id,
    selected_run_ids: [],
    visible_policy_config_ids: visible,
    axis_ranges: defaultAxisRanges(model.runs),
    pareto_reference_run_ids: [],
    pareto_reference_status: model.referenceStatus,
  });
}

function cells(container) {
  return container.children[0].children;
}

function scatters(container) {
  return cells(container).filter((cell) => cell.dataset.role === "scatter");
}

function cell(container, xKey, yKey) {
  return cells(container).find((item) => item.dataset.x === xKey && item.dataset.y === yKey);
}

function svgOf(item) {
  return item.children.find((child) => child.tagName === "svg");
}

function markerStroke(markup, runId) {
  const match = markup.match(new RegExp(`data-run-id="${runId}"[\\s\\S]*?stroke="(#[0-9a-fA-F]{6})"`));
  return match?.[1].toLowerCase();
}

describe("3B scatterplot matrix", { concurrency: 1 }, () => {
  test("random comparisons sample without replacement and handle small or empty pools", () => {
    const ids = Array.from({ length: 500 }, (_, i) => `run-${i}`);
    const original = [...ids];
    const sampled = randomComparisonIds(ids, 10, () => 0.5);
    assert.equal(sampled.length, 10);
    assert.equal(new Set(sampled).size, 10);
    assert.ok(sampled.every(id => ids.includes(id)));
    assert.notDeepEqual(sampled, ids.slice(0, 10));
    assert.deepEqual(ids, original);
    assert.deepEqual(randomComparisonIds([], 30, () => 0), []);
    assert.deepEqual(randomComparisonIds(["a", "b", "a"], 30, () => 0), ["a", "b"]);
    assert.equal(new Set(randomComparisonIds(ids, 123)).size, 123);
    assert.equal(randomComparisonIds(ids, 900).length, 500);
    assert.equal(randomComparisonIds(ids, 1).length, 1);
    for (const invalid of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => randomComparisonIds(ids, invalid), RangeError);
    }
  });
  test("exploration state permits unlimited comparisons while isolating instances and failures", () => {
    const model = readBundle(structuredClone(stressFixture));
    const ids = model.runs.map(run => run.run_id);
    const state = createViewState(initialState(model).get(), { runs: [...model.runs,
      { ...model.runs[0], run_id: "foreign", instance_id: "other" }, { ...model.runs[0], run_id: "failed", status: "failed" }] });
    const axes = state.get().axis_ranges, labels = structuredClone(model.labels);
    assert.equal(state.get().filtered_run_ids.length, 500);
    assert.equal(state.addComparisons(ids), true);
    assert.deepEqual(state.get().comparison_run_ids, ids);
    state.compareRuns([]);
    assert.equal(state.addComparisons(ids.slice(0, 10)), true);
    assert.equal(state.addComparisons([ids[10]]), true);
    assert.deepEqual(state.get().comparison_run_ids, ids.slice(0, 11));
    assert.equal(state.toggleComparison(ids[10]), true);
    assert.equal(state.get().inspected_run_id, ids[10]);
    assert.equal(state.get().comparison_error, "");
    assert.equal(state.toggleComparison("foreign"), false);
    assert.equal(state.toggleComparison("failed"), false);
    assert.equal(state.toggleComparison("unknown"), false);
    assert.deepEqual(state.get().comparison_run_ids, ids.slice(0, 10));
    state.toggleComparison(ids[0]);
    assert.equal(state.get().comparison_run_ids.length, 9);
    state.toggleComparison(ids[0]);
    state.compareRuns(ids.slice(0, 10));
    state.addComparisons([ids[0], "foreign", "failed", "unknown"]);
    assert.equal(state.get().comparison_run_ids.length, 10);
    state.filterRuns(ids.slice(0, 100), { source: "matrix" });
    state.filterRuns(ids.slice(50, 150), { source: "parallel" });
    assert.deepEqual(state.get().filtered_run_ids, ids.slice(50, 100));
    assert.deepEqual(state.get().comparison_run_ids, ids.slice(0, 10));
    state.filterRuns([], { source: "matrix" });
    assert.equal(state.get().filtered_run_ids.length, 0);
    state.inspectRun(ids[0]);
    assert.equal(state.get().inspected_run_id, ids[0]);
    state.clearFilters("matrix");
    assert.equal(state.get().filtered_run_ids.length, 100);
    state.clearFilters();
    state.removeComparison(ids[0]);
    assert.equal(state.addComparisons([ids[10]]), true);
    assert.deepEqual(state.get().selected_run_ids, state.get().comparison_run_ids);
    assert.deepEqual(state.get().axis_ranges, axes);
    assert.deepEqual(model.labels, labels);
    assert.equal(listPage(model, state.get()).rows.length, 20);
    assert.equal(listPage(model, state.get(), "", "matches", 99).page, 24);
    assert.equal(listPage(model, state.get(), "0499").rows[0].run_id, ids[498]);
    assert.equal(listPage(model, state.get(), "", "comparisons").rows.length, 10);
    state.changeInstance("other", [], [], axes, [], "fixture_only");
    assert.equal(state.get().comparison_run_ids.length, 0);
    assert.equal(state.get().filtered_run_ids.length, 0);
    assert.equal(state.get().inspected_run_id, null);
  });

  test("Reusable pair bins conserve raw run membership, including ties and exact maximum boundaries", () => {
    const model = readBundle(structuredClone(stressFixture));
    const ranges = defaultAxisRanges(model.runs);
    const bins = binPairs(model.runs, "makespan_s", "energy_j", ranges.makespan_s, ranges.energy_j);
    assert.equal(bins.reduce((sum, bin) => sum + bin.count, 0), 500);
    assert.equal(new Set(bins.flatMap(bin => bin.runIds)).size, 500);
    const run = { run_id: "a", instance_id: "one", status: "complete", makespan_s: 10, energy_j: 10 };
    const tied = binPairs([run, { ...run, run_id: "b" }], "makespan_s", "energy_j", { min: 0, max: 10 }, { min: 0, max: 10 });
    assert.equal(tied[0].col, 19); assert.equal(tied[0].row, 19); assert.equal(tied[0].count, 2);
    assert.throws(() => binPairs([run, { ...run, instance_id: "other" }], "makespan_s", "energy_j", ranges.makespan_s, ranges.energy_j), /mix instances/);
  });
  test("parallel coordinates show comparison lines without density, with optional background", () => withDocument(dom => {
    const model = readBundle(structuredClone(stressFixture));
    const state = createViewState(initialState(model).get(), { runs: model.runs });
    const container = dom.document.createElement("div");
    const onlySelectedInput = dom.document.createElement("input");
    const before = structuredClone(model.labels);
    const unmount = mountParallel(container, model, state, { onlySelectedInput });
    const lines = () => container.children[0].querySelectorAll("[data-run-id]");
    assert.equal(onlySelectedInput.checked, true);
    assert.equal(lines().length, 0);
    state.compareRuns(model.runs.slice(0, 10).map(run => run.run_id));
    assert.equal(lines().length, 10);
    onlySelectedInput.checked = false;
    onlySelectedInput.listeners.change();
    assert.equal(lines().length, 500);
    assert.equal(lines().filter(line => line.dataset.selected === "true").length, 10);
    assert.ok(!container.children[0].children.some(node => /density/.test(node.getAttribute("class") ?? "")));
    const ids = state.get().comparison_run_ids;
    const clicked = lines()[0].dataset.runId;
    lines()[0].listeners.click({});
    assert.deepEqual(state.get().comparison_run_ids, [...ids, clicked]);
    assert.ok(state.get().inspected_run_id);
    assert.deepEqual(model.labels, before);
    unmount();
    assert.equal(onlySelectedInput.listeners.change, undefined);
  }));
  test("500-run synthetic fixture passes event/metric validation without official Pareto labels", () => {
    const model = readBundle(structuredClone(stressFixture));
    assert.equal(model.runs.length, 500);
    assert.equal(model.events.length, 4000);
    assert.equal(new Set(model.runs.map(run => run.run_id)).size, 500);
    assert.equal(new Set(model.runs.map(run => [run.makespan_s, run.energy_j, run.mean_latency_s].join("|"))).size, 500);
    assert.equal(model.referenceStatus, "fixture_only");
    assert.equal(model.labels.full.size, 0);
    assert.equal(model.referenceRuns.length, 0);
    assert.ok(model.configs.every(config => config.label.includes("not an algorithm")));
    const corrupted = structuredClone(stressFixture);
    corrupted.runs[250].energy_j += 1;
    assert.throws(() => readBundle(corrupted), /Metric mismatch/);
  });
  test("matrix keeps one shared state, reverse labels, and the full seven-candidate encoding", () => withDocument((dom) => {
    const model = readBundle(clone());
    const state = initialState(model);
    const before = state.get();
    const container = dom.document.createElement("div");
    mountMatrix(container, model, state);
    assert.deepEqual(state.get(), before);
    const all = cells(container);
    assert.equal(all.length, 9);
    assert.equal(all.filter((item) => item.dataset.role === "diagonal").length, 3);
    assert.equal(scatters(container).length, 6);
    for (const key of OBJECTIVES) {
      const diagonal = cell(container, key, key);
      assert.equal(diagonal.querySelector("svg"), null);
      assert.match(diagonal.children.map((child) => child.textContent).join(" "), /↓/);
    }
    const forward = cell(container, "makespan_s", "energy_j");
    const reverse = cell(container, "energy_j", "makespan_s");
    assert.equal(forward.dataset.pair, "makespan_s|energy_j");
    assert.equal(reverse.dataset.pair, forward.dataset.pair);
    assert.equal(forward.dataset.orientation, "canonical");
    assert.equal(reverse.dataset.orientation, "reverse");
    assert.match(reverse.children.map((child) => child.textContent).join(" "), /Reversed axes/);
    const forwardMarkup = svgOf(forward).innerHTML;
    const reverseMarkup = svgOf(reverse).innerHTML;
    for (const runId of model.runs.map((run) => run.run_id)) {
      assert.match(forwardMarkup, new RegExp(runId));
      assert.match(reverseMarkup, new RegExp(runId));
    }
    assert.equal(markerStroke(forwardMarkup, "3a-demo-run-f"), "#ffffff");
    assert.equal(markerStroke(reverseMarkup, "3a-demo-run-f"), "#ffffff");
    assert.equal(
      forwardMarkup.match(/stroke="#b8751a"/g).length,
      reverseMarkup.match(/stroke="#b8751a"/g).length,
    );
    assert.match(forwardMarkup, /3a-demo-run-f[\s\S]*E=5\.0925[\s\S]*2D: Dominated; 3D: Non-dominated/);
    assert.match(reverseMarkup, /3a-demo-run-f[\s\S]*E=5\.0925[\s\S]*2D: Dominated; 3D: Non-dominated/);
    const labelBefore = structuredClone(model.labels.pairs.get("makespan_s|energy_j").get("3a-demo-run-f"));
    const axesBefore = structuredClone(state.get().axis_ranges);
    state.setVisibleConfigs(["fixture-g"]);
    const onlyG = svgOf(cell(container, "makespan_s", "energy_j")).innerHTML;
    assert.match(onlyG, /3a-demo-run-g/);
    assert.doesNotMatch(onlyG, /3a-demo-run-f/);
    assert.match(onlyG, new RegExp(`fill="${POLICY_COLORS[stableConfigIndex(model.configs, "fixture-g")]}"`));
    assert.notEqual(POLICY_COLORS[stableConfigIndex(model.configs, "fixture-g")], POLICY_COLORS[0]);
    assert.deepEqual(state.get().axis_ranges, axesBefore);
    assert.deepEqual(state.get().pareto_reference_run_ids, []);
    assert.deepEqual(model.labels.pairs.get("makespan_s|energy_j").get("3a-demo-run-f"), labelBefore);
    svgOf(cell(container, "makespan_s", "energy_j")).markers[0].listeners.click({ shiftKey: false });
    assert.deepEqual(state.get().selected_run_ids, ["3a-demo-run-g"]);
    assert.match(svgOf(cell(container, "energy_j", "makespan_s")).innerHTML, /class="run-id-label"[\s\S]*3a-demo-run-g/);
    svgOf(cell(container, "makespan_s", "mean_latency_s")).markers
      .find((marker) => marker.dataset.runId === "3a-demo-run-g").listeners.click({ shiftKey: true });
    assert.deepEqual(state.get().selected_run_ids, ["3a-demo-run-g"]);
    state.setVisibleConfigs(model.configs.map((item) => item.policy_config_id));
    const brushSvg = svgOf(cell(container, "makespan_s", "energy_j"));
    brushSvg.listeners.pointerdown({ target: { closest: () => null }, clientX: 0, clientY: 0, pointerId: 1 });
    brushSvg.listeners.pointermove({ clientX: 600, clientY: 390 });
    brushSvg.listeners.pointerup({ clientX: 600, clientY: 390, shiftKey: true });
    assert.equal(state.get().selected_run_ids.length, 7);
    assert.ok(state.get().selected_run_ids.includes("3a-demo-run-f"));
  }));

  test("a failed run is omitted from every matrix cell", () => withDocument((dom) => {
    const failed = clone();
    failed.runs[0].status = "failed";
    failed.runs[0].failure_reason = "test failure";
    for (const key of OBJECTIVES) failed.runs[0][key] = null;
    delete failed.pareto_check;
    const model = readBundle(failed);
    const container = dom.document.createElement("div");
    mountMatrix(container, model, initialState(model));
    const markup = scatters(container).map((item) => svgOf(item).innerHTML).join("\n");
    assert.equal(model.runs[0].run_id, "3a-demo-run-a");
    assert.doesNotMatch(markup, /3a-demo-run-a/);
    assert.match(markup, /3a-demo-run-f/);
  }));

  test("parallel coordinates share selection and keep raw values outside the brush", () => withDocument((dom) => {
    const model = readBundle(clone());
    const state = initialState(model);
    const matrix = dom.document.createElement("div");
    const parallel = dom.document.createElement("div");
    const stateKeys = Object.keys(state.get()).sort();
    const axesBefore = structuredClone(state.get().axis_ranges);
    const labelBefore = structuredClone(model.labels.pairs.get("makespan_s|energy_j").get("3a-demo-run-f"));
    mountMatrix(matrix, model, state);
    mountParallel(parallel, model, state);
    const svg = parallel.children[0];
    const lines = () => svg.querySelectorAll("[data-run-id]");
    assert.equal(lines().length, 7);
    const energyAxis = svg.children.find((node) => node.dataset.axis === "energy_j");
    assert.match(energyAxis.children.find((node) => node.getAttribute("class") === "pc-axis-name").textContent, /E \(J\) ↓/);
    assert.notEqual(Number(energyAxis.dataset.rangeMin), 0);
    assert.notEqual(Number(energyAxis.dataset.rangeMax), 1);
    const fLine = lines().find((line) => line.dataset.runId === "3a-demo-run-f");
    assert.match(fLine.children.find((node) => node.tagName === "title").textContent, /E=5\.0925 J/);
    const gLine = lines().find((line) => line.dataset.runId === "3a-demo-run-g");
    assert.equal(gLine.children.find((node) => node.getAttribute("class") === "pc-shape").textContent, "×");
    const clientY = (viewY) => viewY * 390 / PARALLEL_LAYOUT.height;
    const brush = (key, startValue, endValue) => {
      const current = parallel.children[0];
      const axis = current.children.find((node) => node.dataset.axis === key);
      const range = { min: Number(axis.dataset.rangeMin), max: Number(axis.dataset.rangeMax) };
      const hit = axis.children.find((node) => node.getAttribute("class") === "pc-hit");
      hit.listeners.pointerdown({ clientY: clientY(valueToAxisY(startValue, range)), pointerId: 1 });
      current.listeners.pointermove({ clientY: clientY(valueToAxisY(endValue, range)) });
      current.listeners.pointerup({ clientY: clientY(valueToAxisY(endValue, range)), shiftKey: false });
    };
    const makespan = svg.children.find((node) => node.dataset.axis === "makespan_s");
    brush("makespan_s", Number(makespan.dataset.rangeMax), Number(makespan.dataset.rangeMin));
    assert.equal(state.get().selected_run_ids.length, 7);
    brush("energy_j", Number(parallel.children[0].children.find((node) => node.dataset.axis === "energy_j").dataset.rangeMax), 6.6);
    assert.deepEqual(state.get().selected_run_ids, ["3a-demo-run-a", "3a-demo-run-b"]);
    assert.deepEqual(state.get().axis_ranges, axesBefore);
    assert.deepEqual(state.get().visible_policy_config_ids, model.configs.map((item) => item.policy_config_id));
    assert.deepEqual(Object.keys(state.get()).sort(), stateKeys);
    assert.equal(state.get().parallel_brushes, undefined);
    assert.deepEqual(model.labels.pairs.get("makespan_s|energy_j").get("3a-demo-run-f"), labelBefore);
    assert.ok(axisYToValue(valueToAxisY(6.6, axesBefore.energy_j), axesBefore.energy_j) - 6.6 < 1e-9);
    parallel.children[0].querySelectorAll("[data-run-id]").find((line) => line.dataset.runId === "3a-demo-run-f").listeners.click({ shiftKey: false });
    assert.deepEqual(state.get().selected_run_ids, ["3a-demo-run-f"]);
    assert.match(svgOf(cell(matrix, "makespan_s", "energy_j")).innerHTML, /class="run-id-label"[\s\S]*3a-demo-run-f/);
    const preview = parallel.children[0].children.find((node) => node.dataset.axis === "energy_j")
      .children.find((node) => node.dataset.brushPreview === "energy_j");
    assert.equal(preview.getAttribute("visibility"), "hidden");
  }));

  test("parallel focus controls preserve shared state and report brush matches independently of selection", () => withDocument((dom) => {
    const model = readBundle(clone());
    const state = initialState(model);
    const original = state.get();
    const labels = structuredClone(model.labels);
    const container = dom.document.createElement("div");
    const controls = Object.fromEntries(["onlySelectedInput", "summary", "brushSummary", "clearBrushButton"]
      .map(key => [key, dom.document.createElement("div")]));
    const unmount = mountParallel(container, model, state, controls);
    const lines = () => container.children[0].querySelectorAll("[data-run-id]");
    const path = line => line.children.find(child => child.tagName === "path");
    assert.equal(lines().length, 7);
    assert.ok(lines().every(line => path(line).getAttribute("stroke") === "#84938e" && path(line).getAttribute("stroke-opacity") === "0.22"));
    assert.match(controls.summary.textContent, /Selected: 0 total.*0 \/ 7 filter-visible.*Displayed: 7/);
    controls.onlySelectedInput.checked = true;
    controls.onlySelectedInput.listeners.change();
    assert.equal(lines().length, 0);
    assert.ok(container.children[0].children.some(node => node.textContent.includes("No selected runs")));
    assert.deepEqual(state.get(), original);
    state.selectRuns(["3a-demo-run-f"]);
    assert.deepEqual(lines().map(line => line.dataset.runId), ["3a-demo-run-f"]);
    assert.equal(path(lines()[0]).getAttribute("stroke-opacity"), "1");
    const index = stableConfigIndex(model.configs, "fixture-f");
    assert.equal(path(lines()[0]).getAttribute("stroke"), POLICY_COLORS[index % POLICY_COLORS.length]);
    controls.onlySelectedInput.checked = false;
    controls.onlySelectedInput.listeners.change();
    assert.equal(lines().at(-1).dataset.runId, "3a-demo-run-f");
    assert.equal(lines().length, 7);
    controls.onlySelectedInput.checked = true;
    controls.onlySelectedInput.listeners.change();
    // Even in Only selected mode, the brush matches all filter-visible runs.
    const brush = (key, lo, hi, shift = false, cancel = false) => {
      const svg = container.children[0];
      const axis = svg.children.find(node => node.dataset.axis === key);
      const range = state.get().axis_ranges[key];
      const y = value => valueToAxisY(value, range) * 390 / PARALLEL_LAYOUT.height;
      axis.children.find(node => node.getAttribute("class") === "pc-hit").listeners.pointerdown({ clientY: y(lo), pointerId: 1 });
      svg.listeners.pointermove({ clientY: y(hi) });
      const preview = controls.brushSummary.textContent;
      if (cancel) svg.listeners.pointercancel();
      else svg.listeners.pointerup({ clientY: y(hi), shiftKey: shift });
      return preview;
    };
    assert.match(brush("energy_j", 6.6, 7.2, true), /Brush preview: 2 \/ 7/);
    assert.match(controls.brushSummary.textContent, /Brush matches: 2 \/ 7.*1 active axis/);
    assert.match(controls.summary.textContent, /Selected: 3 total.*Displayed: 3/);
    assert.deepEqual(state.get().selected_run_ids, ["3a-demo-run-f", "3a-demo-run-a", "3a-demo-run-b"]);
    brush("makespan_s", .99, 1.01);
    assert.match(controls.brushSummary.textContent, /Brush matches: 1 \/ 7.*2 active axes/);
    assert.deepEqual(state.get().selected_run_ids, ["3a-demo-run-b"]);
    brush("energy_j", 4.3, 4.4);
    assert.match(controls.brushSummary.textContent, /Brush matches: 0 \/ 7/);
    assert.equal(lines().length, 0);
    controls.clearBrushButton.listeners.click();
    assert.match(controls.brushSummary.textContent, /No active axis brushes/);
    assert.deepEqual(state.get().selected_run_ids, []);
    brush("energy_j", 6.6, 7.2, false, true);
    assert.match(controls.brushSummary.textContent, /No active axis brushes/);
    assert.deepEqual(state.get().selected_run_ids, []);
    brush("energy_j", 6.6, 7.2);
    state.setVisibleConfigs(["fixture-a"]);
    assert.match(controls.summary.textContent, /Selected: 2 total.*1 \/ 1 filter-visible.*Displayed: 1.*1 selected hidden/);
    assert.match(controls.brushSummary.textContent, /No active axis brushes/);
    assert.deepEqual(state.get().axis_ranges, original.axis_ranges);
    assert.deepEqual(model.labels, labels);
    const { selected_run_ids, visible_policy_config_ids, ...rest } = state.get();
    const { selected_run_ids: unusedSelection, visible_policy_config_ids: unusedFilters, ...originalRest } = original;
    assert.deepEqual(rest, originalRest);
    unmount();
    assert.equal(controls.onlySelectedInput.listeners.change, undefined);
    assert.equal(controls.clearBrushButton.listeners.click, undefined);
  }));

  test("the interactive 3D projection keeps run identity and reports coincident points", () => withDocument((dom) => {
    const demo = readBundle(clone());
    const state = initialState(demo);
    const matrix = dom.document.createElement("div");
    const view = dom.document.createElement("div");
    const axesBefore = structuredClone(state.get().axis_ranges);
    const labelBefore = structuredClone(demo.labels.full.get("3a-demo-run-f"));
    const stateKeys = Object.keys(state.get()).sort();
    mountMatrix(matrix, demo, state);
    mountView3d(view, demo, state);
    const points = () => view.children[0].querySelectorAll("[data-run-id]");
    assert.equal(points().length, 7);
    const overlaps = points()
      .map((point) => point.dataset.coincident)
      .filter((value, index, all) => all.indexOf(value) === index && value.includes("|"));
    assert.deepEqual(overlaps, []);
    const visible = demo.runs.filter((run) => run.status === "complete");
    for (const run of visible) {
      assert.deepEqual(coincidentIds(visible, state.get().axis_ranges, run.run_id), [run.run_id]);
    }
    points().find((point) => point.dataset.runId === "3a-demo-run-g").listeners.click({ shiftKey: false });
    assert.deepEqual(state.get().selected_run_ids, ["3a-demo-run-g"]);
    assert.match(svgOf(cell(matrix, "makespan_s", "energy_j")).innerHTML, /class="run-id-label"[\s\S]*3a-demo-run-g/);
    assert.deepEqual(state.get().axis_ranges, axesBefore);
    assert.deepEqual(demo.labels.full.get("3a-demo-run-f"), labelBefore);
    assert.deepEqual(Object.keys(state.get()).sort(), stateKeys);
    state.setVisibleConfigs(["fixture-a"]);
    assert.deepEqual(points().map((point) => point.dataset.runId), ["3a-demo-run-a"]);
    assert.deepEqual(state.get().axis_ranges, axesBefore);

    const same = {
      instance: { instance_id: "same" },
      configs: [
        { policy_config_id: "left" },
        { policy_config_id: "right" },
        { policy_config_id: "apart" },
      ],
      runs: [
        { run_id: "overlap-b", instance_id: "same", status: "complete", policy_config_id: "left", makespan_s: 1, energy_j: 2, mean_latency_s: 3 },
        { run_id: "overlap-a", instance_id: "same", status: "complete", policy_config_id: "right", makespan_s: 1, energy_j: 2, mean_latency_s: 3 },
        { run_id: "apart", instance_id: "same", status: "complete", policy_config_id: "apart", makespan_s: 3, energy_j: 1, mean_latency_s: 2 },
        { run_id: "failed-run", instance_id: "same", status: "failed", policy_config_id: "left", makespan_s: null, energy_j: null, mean_latency_s: null },
      ],
      labels: { full: new Map([
        ["overlap-a", { nonDominated: true }],
        ["overlap-b", { nonDominated: true }],
        ["apart", { nonDominated: false }],
      ]) },
    };
    const overlapState = initialState(same);
    const overlapView = dom.document.createElement("div");
    mountView3d(overlapView, same, overlapState);
    const overlapPoints = overlapView.children[0].querySelectorAll("[data-run-id]");
    assert.equal(overlapPoints.some((point) => point.dataset.runId === "failed-run"), false);
    const clicked = overlapPoints.find((point) => point.dataset.runId === "overlap-b");
    assert.equal(clicked.dataset.coincident, "overlap-a|overlap-b");
    assert.match(clicked.children.find((child) => child.tagName === "title").textContent, /M=1 s, E=2 J, L=3 s/);
    clicked.listeners.click({ shiftKey: false });
    assert.deepEqual(overlapState.get().selected_run_ids, ["overlap-a", "overlap-b"]);
  }));

  test("3D rotation and zoom preserve metrics, reference labels and shared state", () => withDocument(dom => {
    const model = readBundle(clone()), state = initialState(model), view = dom.document.createElement("div");
    const before = structuredClone(state.get()), raw = JSON.stringify(model.runs), labels = structuredClone([...model.labels.full]);
    const unmount = mountView3d(view, model, state);
    const svg = view.children[0], toolbar = view.children[1];
    const button = action => toolbar.children.find(node => node.dataset.cameraAction === action);
    const point = () => svg.querySelectorAll("[data-run-id]").find(node => node.dataset.runId === "3a-demo-run-f");
    const initial = { ...point().dataset };
    button("right").listeners.click();
    assert.notEqual(point().dataset.x, initial.x);
    const rotatedYaw = svg.dataset.yaw;
    button("in").listeners.click();
    assert.equal(Number(svg.dataset.zoom), 1.1);
    assert.deepEqual(state.get(), before);
    assert.equal(JSON.stringify(model.runs), raw);
    assert.deepEqual([...model.labels.full], labels);
    point().listeners.keydown({ key: "Enter", preventDefault() {} });
    assert.deepEqual(state.get().selected_run_ids, ["3a-demo-run-f"]);
    assert.equal(svg.dataset.yaw, rotatedYaw, "shared selection updates preserve the camera");
    assert.equal(point().dataset.fullNonDominated, initial.fullNonDominated);
    const expected = projectRun(model.runs.find(run => run.run_id === "3a-demo-run-f"), state.get().axis_ranges,
      { yaw: Number(svg.dataset.yaw), pitch: Number(svg.dataset.pitch), zoom: Number(svg.dataset.zoom) });
    assert.equal(Number(point().dataset.x), expected.x);
    assert.equal(Number(point().dataset.y), expected.y);
    button("reset").listeners.click();
    assert.ok(Math.abs(Number(point().dataset.x) - Number(initial.x)) < 1e-10);
    assert.deepEqual(state.get().selected_run_ids, ["3a-demo-run-f"]);
    const selected = structuredClone(state.get());
    const stale = point();
    unmount();
    stale.listeners.click({});
    button("right").listeners.click();
    assert.deepEqual(state.get(), selected, "disposed views cannot change shared state");
  }));

  test("3D pointer drag rotates without selecting; click and keyboard remain independent", () => withDocument(dom => {
    const model = readBundle(clone()), state = initialState(model), view = dom.document.createElement("div");
    mountView3d(view, model, state);
    const svg = view.children[0], before = structuredClone(state.get());
    const point = () => svg.querySelectorAll("[data-run-id]")[0];
    svg.listeners.pointerdown({ button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    svg.listeners.pointermove({ pointerId: 1, clientX: 160, clientY: 130 });
    svg.listeners.pointerup({ pointerId: 1 });
    assert.notEqual(Number(svg.dataset.yaw), DEFAULT_CAMERA.yaw);
    point().listeners.click({});
    assert.deepEqual(state.get(), before, "release after dragging must not toggle a point");
    svg.listeners.pointerdown({ button: 0, pointerId: 2, clientX: 100, clientY: 100 });
    svg.listeners.pointerup({ pointerId: 2 });
    const chosenId = point().dataset.runId;
    point().listeners.click({});
    assert.deepEqual(state.get().selected_run_ids, [chosenId]);
    const yaw = svg.dataset.yaw;
    svg.listeners.keydown({ target: svg, key: "ArrowLeft", preventDefault() {} });
    assert.notEqual(svg.dataset.yaw, yaw);
    const zoom = Number(svg.dataset.zoom);
    svg.listeners.wheel({ deltaY: -100, preventDefault() {} });
    assert.ok(Number(svg.dataset.zoom) > zoom);
    svg.listeners.keydown({ target: svg, key: "Home", preventDefault() {} });
    assert.equal(Number(svg.dataset.zoom), 1);
    assert.deepEqual(state.get().selected_run_ids, [chosenId]);
  }));

  test("3D camera bounds and equal metric axes remain finite", () => {
    assert.deepEqual(constrainCamera({ yaw: 0, pitch: 100, zoom: 100 }), { yaw: 0, pitch: 1.4, zoom: 1.6 });
    const run = { makespan_s: 2, energy_j: 2, mean_latency_s: 2 };
    const ranges = Object.fromEntries(Object.keys(run).map(key => [key, { min: 2, max: 2 }]));
    const point = projectRun(run, ranges);
    assert.ok(Object.values(point).every(Number.isFinite));
    assert.deepEqual(projectNormalized(0.5, 0.5, 0.5), { x: 360, y: 240, depth: 0 });
  });

  test("the integrated workflow separates filtering, comparison, inspection, and dataset loading", async () => {
    const priorDocument = globalThis.document, priorFetch = globalThis.fetch;
    const dom = createDom(); globalThis.document = dom.document;
    globalThis.fetch = async url => ({ ok: true, json: async () => structuredClone(url.includes("synthetic-stress-500") ? stressFixture : fixture) });
    try {
      await import("../app/3b/app.mjs");
      const { elements } = dom;
      const rows = () => elements.get("run-list").children[0].children[1].children;
      const action = (id, index) => rows().find(row => row.dataset.runId === id).children.at(-1).children[index].listeners.click();
      const assertCompare = ids => {
        assert.equal(elements.get("selection-count").textContent, `${ids.length} selected`);
        for (const key of ["parallel", "view3d"]) assert.deepEqual(elements.get(key).children[0].querySelectorAll("[data-run-id]")
          .filter(node => node.dataset.selected === "true").map(node => node.dataset.runId).sort(), [...ids].sort());
        for (const plot of scatters(elements.get("matrix"))) assert.deepEqual([...svgOf(plot).innerHTML.matchAll(/class="run-id-label"[^>]*>([^<]+)</g)].map(match => match[1]).sort(), [...ids].sort());
      };
      assert.equal(elements.get("matching-count").textContent, "7");
      assert.equal(elements.get("view3d").children[0].querySelectorAll("[data-run-id]").length, 0);
      const matrixSvg = () => svgOf(cell(elements.get("matrix"), "makespan_s", "energy_j"));
      matrixSvg().markers.find(node => node.dataset.runId === "3a-demo-run-f").listeners.click({});
      assertCompare(["3a-demo-run-f"]);
      assert.match(elements.get("details-content").innerHTML, /M–E: <\/strong>Dominated/);
      assert.match(elements.get("details-content").innerHTML, /3a-demo-run-g/);
      elements.get("parallel").children[0].querySelectorAll("[data-run-id]")[0].listeners.click({});
      assertCompare([]);
      matrixSvg().markers.find(node => node.dataset.runId === "3a-demo-run-f").listeners.click({});
      elements.get("view3d").children[0].querySelectorAll("[data-run-id]")[0].listeners.keydown({ key: "Enter", preventDefault() {} });
      assertCompare([]);
      matrixSvg().markers.find(node => node.dataset.runId === "3a-demo-run-f").listeners.click({});
      assertCompare(["3a-demo-run-f"]);
      matrixSvg().markers.find(node => node.dataset.runId === "3a-demo-run-f").listeners.click({});
      assertCompare([]);
      elements.get("parallel-only-selected").checked = false;
      elements.get("parallel-only-selected").listeners.change();
      elements.get("parallel").children[0].querySelectorAll("[data-run-id]").find(node => node.dataset.runId === "3a-demo-run-f").listeners.click({});
      assertCompare(["3a-demo-run-f"]);
      assert.equal(elements.get("matching-count").textContent, "7");
      const originalEvidence = elements.get("details-content").innerHTML;
      for (const input of elements.get("policy-filters").querySelectorAll("input")) input.checked = input.dataset.configId === "fixture-a";
      elements.get("policy-filters").querySelectorAll("input")[0].listeners.change();
      assert.equal(elements.get("matching-count").textContent, "1");
      assertCompare(["3a-demo-run-f"]);
      assert.equal(elements.get("details-content").innerHTML, originalEvidence);
      assert.equal(rows().length, 1);
      elements.get("select-all").listeners.click();
      const oldMarker = matrixSvg().markers[0];
      elements.get("show-parallel").listeners.click();
      await elements.get("load-stress-demo").listeners.click();
      assert.equal(elements.get("scatter-section").hidden, false);
      assert.equal(elements.get("matrix-section").hidden, false);
      assert.equal(elements.get("parallel-section").hidden, true);
      assert.equal(elements.get("view3d-section").hidden, true);
      assertCompare([]);
      assert.equal(elements.get("matching-count").textContent, "500");
      assert.equal(rows().length, 20);
      assert.match(elements.get("runs-page").textContent, /Page 1 \/ 25/);
      assert.equal(elements.get("parallel-only-selected").checked, true);
      assert.ok(!elements.has("parallel-mode"));
      assert.ok(!elements.has("parallel-density-legend"));
      assert.match(elements.get("notice").textContent, /SYNTHETIC TEST DATA/);
      assert.doesNotMatch(matrixSvg().innerHTML, /AGGREGATE:|data-bin-index/);
      assert.equal(matrixSvg().querySelectorAll("[data-run-id]").length, 500);
      oldMarker.listeners.click({});
      assertCompare([]);
      elements.get("compare-matches").listeners.click();
      assertCompare(stressFixture.runs.map(run => run.run_id));
      assert.equal(elements.get("comparison-message").textContent, "");
      elements.get("random-count").value = "25";
      elements.get("random-compare").listeners.click();
      const randomIds = matrixSvg().querySelectorAll("[data-run-id]").map(node => node.dataset.runId);
      assert.equal(new Set(randomIds).size, 25);
      assertCompare(randomIds);
      assert.equal(elements.get("matching-count").textContent, "500");
      for (const invalid of ["", "0", "-2", "1.5", "invalid"]) {
        elements.get("random-count").value = invalid;
        elements.get("random-compare").listeners.click();
        assertCompare(randomIds);
        assert.match(elements.get("random-feedback").textContent, /positive whole number/);
      }
      elements.get("random-count").value = "999";
      elements.get("random-count").listeners.keydown({ key: "Enter", preventDefault() {} });
      assertCompare(stressFixture.runs.map(run => run.run_id));
      assert.match(elements.get("random-feedback").textContent, /selected all 500/);
      elements.get("random-count").value = "25";
      // Restore the earlier sample to keep following reset checks deterministic.
      elements.get("clear-selection").listeners.click();
      for (const id of randomIds) {
        elements.get("run-search").value = id; elements.get("run-search").listeners.input();
        action(id, 1);
      }
      elements.get("run-search").value = ""; elements.get("run-search").listeners.input();
      elements.get("reset-axes").listeners.click();
      assertCompare(randomIds);
      assert.match(elements.get("controls-feedback").textContent, /already at their defaults/);
      const axisInput = elements.get("axis-controls").querySelectorAll("input")[0];
      const originalMin = Number(axisInput.value);
      axisInput.value = originalMin + 0.01;
      axisInput.listeners.change();
      elements.get("reset-axes").listeners.click();
      assert.equal(Number(axisInput.value), originalMin);
      assert.match(elements.get("controls-feedback").textContent, /Axis ranges restored/);
      elements.get("select-all").listeners.click();
      assertCompare([]);
      assert.equal(elements.get("matching-count").textContent, "500");
      assert.equal(matrixSvg().querySelectorAll("[data-run-id]").length, 500);
      assert.match(elements.get("controls-feedback").textContent, /Showing all runs/);
      const firstTen = stressFixture.runs.slice(0, 10).map(run => run.run_id);
      for (const id of firstTen) action(id, 1);
      assertCompare(firstTen);
      for (const plot of scatters(elements.get("matrix"))) {
        assert.deepEqual(svgOf(plot).querySelectorAll("[data-run-id]").map(node => node.dataset.runId).sort(), [...firstTen].sort());
      }
      assert.equal(elements.get("matching-count").textContent, "500");
      action(firstTen[9], 1);
      assert.equal(matrixSvg().querySelectorAll("[data-run-id]").length, 9);
      action(firstTen[9], 1);
      assert.equal(matrixSvg().querySelectorAll("[data-run-id]").length, 10);
      action(stressFixture.runs[10].run_id, 1);
      assertCompare([...firstTen, stressFixture.runs[10].run_id]);
      assert.equal(elements.get("comparison-message").textContent, "");
      action(firstTen[0], 0);
      assert.equal((elements.get("details-content").innerHTML.match(/class="detail-card"/g) ?? []).length, 1);
      assert.match(elements.get("details-content").innerHTML, /TEST DATA ONLY/);
      elements.get("runs-next").listeners.click();
      assert.equal(rows()[0].dataset.runId, stressFixture.runs[20].run_id);
      elements.get("run-search").value = "0499";
      elements.get("run-search").listeners.input();
      assert.equal(rows().length, 1);
      assert.equal(elements.get("matching-count").textContent, "500");
      elements.get("run-search").value = ""; elements.get("run-search").listeners.input();
      assert.equal(matrixSvg().listeners.pointerdown, undefined);
      assert.equal(matrixSvg().listeners.pointerup, undefined);
      assert.doesNotMatch(matrixSvg().innerHTML, /class="brush"/);
      const pc = elements.get("parallel").children[0];
      assert.equal(pc.listeners.pointerup, undefined);
      for (const axis of pc.children.filter(node => node.dataset.axis)) {
        assert.ok(!axis.children.some(node => ["pc-hit", "pc-brush"].includes(node.getAttribute("class"))));
      }
      for (const id of ["filter-summary", "reset-filters", "parallel-clear-brushes", "parallel-brush-count"]) assert.ok(!elements.has(id));
      assertCompare([...firstTen, stressFixture.runs[10].run_id]);
      elements.get("clear-selection").listeners.click();
      assertCompare([]);
      assert.equal(elements.get("matching-count").textContent, "500");
      assert.equal(matrixSvg().querySelectorAll("[data-run-id]").length, 500);
      elements.get("run-scope").value = "comparisons"; elements.get("run-scope").listeners.change();
      assert.equal(rows().length, 0);
      // Failed imports preserve the current model and controls.
      await elements.get("bundle-file").listeners.change({ target: { files: [{ text: async () => "{}" }], value: "" } });
      assert.equal(elements.get("matching-count").textContent, "500");
      assert.match(elements.get("notice").textContent, /Import failed/);
      await elements.get("load-small-demo").listeners.click();
      assertCompare([]);
      assert.equal(rows().length, 7);
      for (const input of elements.get("policy-filters").querySelectorAll("input")) input.checked = input.dataset.configId === "fixture-a";
      elements.get("policy-filters").querySelectorAll("input")[0].listeners.change();
      elements.get("random-compare").listeners.click();
      assertCompare(["3a-demo-run-a"]);
      for (const input of elements.get("policy-filters").querySelectorAll("input")) input.checked = false;
      elements.get("policy-filters").querySelectorAll("input")[0].listeners.change();
      assert.equal(elements.get("random-compare").disabled, true);
      elements.get("random-compare").listeners.click();
      assertCompare(["3a-demo-run-a"]);
      elements.get("select-all").listeners.click();
      action("3a-demo-run-f", 0);
      assert.match(elements.get("details-content").innerHTML, /3a-demo-run-g/);
      assert.match(elements.get("details-content").innerHTML, /Full 3D M–E–L: <\/strong>Non-dominated/);
    } finally { globalThis.document = priorDocument; globalThis.fetch = priorFetch; }
  });
});
