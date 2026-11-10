import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { OBJECTIVES } from "../app/3a/pareto.mjs";
import { defaultAxisRanges, readBundle } from "../app/3a/model.mjs";
import { POLICY_COLORS, stableConfigIndex } from "../app/shared/encoding.mjs";
import { createViewState } from "../app/shared/state.mjs";
import { mountMatrix } from "../app/3b/matrix.mjs";
import { axisYToValue, mountParallel, PARALLEL_LAYOUT, valueToAxisY } from "../app/3b/parallel.mjs";
import { coincidentIds, mountView3d } from "../app/3b/view3d.mjs";

const fixture = JSON.parse(readFileSync(new URL("../examples/3a-demo/bundle.json", import.meta.url), "utf8"));
const clone = () => structuredClone(fixture);

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
    set innerHTML(value) { this._html = value; this.markers = null; }
    get innerHTML() { return this._html; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = [...nodes]; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name]; }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
    querySelectorAll(selector) {
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
    assert.match(reverse.children.map((child) => child.textContent).join(" "), /反向轴/);
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
    assert.match(forwardMarkup, /3a-demo-run-f[\s\S]*E=5\.0925[\s\S]*二维：被支配；三维：非支配/);
    assert.match(reverseMarkup, /3a-demo-run-f[\s\S]*E=5\.0925[\s\S]*二维：被支配；三维：非支配/);
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

  test("the fixed 3D projection keeps run identity and reports coincident points", () => withDocument((dom) => {
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

  test("the 3B page loads one fixture model and selects the same run_id from the matrix", async () => {
    const priorDocument = globalThis.document;
    const priorFetch = globalThis.fetch;
    const dom = createDom();
    globalThis.document = dom.document;
    let requested;
    globalThis.fetch = async (url) => {
      requested = url;
      return { ok: true, json: async () => clone() };
    };
    try {
      await import("../app/3b/app.mjs");
      assert.equal(requested, "../../examples/3a-demo/bundle.json");
      const { elements } = dom;
      assert.equal(elements.get("instance-id").textContent, "3a-demo-instance-001");
      assert.equal(elements.get("run-count").textContent, "7 / 7");
      assert.equal(elements.get("reference-ids").textContent, "无");
      assert.match(elements.get("reference-status").textContent, /fixture_only/);
      assert.match(elements.get("reference-status").textContent, /非正式前沿/);
      assert.match(elements.get("provenance").textContent, /fixture_only/);
      assert.match(elements.get("provenance").textContent, /不是调度算法结果/);
      assert.match(elements.get("notice").textContent, /不是正式七候选前沿/);
      assert.doesNotMatch(elements.get("notice").textContent, /无法载入|导入失败/);
      const forward = cell(elements.get("matrix"), "makespan_s", "energy_j");
      svgOf(forward).markers.find((marker) => marker.dataset.runId === "3a-demo-run-f").listeners.click({ shiftKey: false });
      const parallelLine = elements.get("parallel").children[0].querySelectorAll("[data-run-id]")
        .find((line) => line.dataset.runId === "3a-demo-run-f");
      assert.equal(parallelLine.dataset.selected, "true");
      assert.match(parallelLine.children.find((child) => child.tagName === "title").textContent, /E=5\.0925 J/);
      const viewPoint = elements.get("view3d").children[0].querySelectorAll("[data-run-id]")
        .find((point) => point.dataset.runId === "3a-demo-run-f");
      assert.equal(viewPoint.dataset.selected, "true");
      assert.equal(viewPoint.dataset.fullNonDominated, "true");
      assert.match(viewPoint.children.find((child) => child.tagName === "title").textContent, /E=5\.0925 J/);
      assert.equal(elements.get("selection-count").textContent, "1");
      assert.equal(elements.get("selection-ids").textContent, "3a-demo-run-f");
      assert.match(elements.get("details-content").innerHTML, /5\.0925/);
      assert.match(elements.get("details-content").innerHTML, /3a-demo-run-g/);
      assert.match(elements.get("details-content").innerHTML, /M–E：<\/strong>被支配/);
      assert.match(elements.get("details-content").innerHTML, /三维 M–E–L：<\/strong>非支配/);
      const axes = [...elements.get("axis-controls").querySelectorAll("input")].map((input) => input.value);
      const hidden = [...elements.get("policy-filters").querySelectorAll("input")]
        .find((input) => input.dataset.configId === "fixture-g");
      hidden.checked = false;
      hidden.listeners.change();
      assert.equal(elements.get("run-count").textContent, "6 / 7");
      assert.equal(elements.get("selection-ids").textContent, "3a-demo-run-f");
      assert.deepEqual([...elements.get("axis-controls").querySelectorAll("input")].map((input) => input.value), axes);
      assert.doesNotMatch(svgOf(cell(elements.get("matrix"), "makespan_s", "energy_j")).innerHTML, /3a-demo-run-g/);
      const parallelMarkup = elements.get("parallel").children[0].querySelectorAll("[data-run-id]").map((line) => line.dataset.runId);
      assert.equal(parallelMarkup.length, 6);
      assert.equal(parallelMarkup.includes("3a-demo-run-g"), false);
      elements.get("clear-selection").listeners.click();
      assert.equal(elements.get("selection-count").textContent, "0");
      elements.get("select-all").listeners.click();
      assert.equal(elements.get("run-count").textContent, "7 / 7");
    } finally {
      globalThis.document = priorDocument;
      globalThis.fetch = priorFetch;
    }
  });
});
