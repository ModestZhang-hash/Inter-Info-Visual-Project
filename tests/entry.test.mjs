import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { createSession } from "../app/shared/session.mjs";
import { mountPairPlots } from "../app/3a/plots.mjs";
import { mountMatrix } from "../app/3b/matrix.mjs";
import { mountParallel } from "../app/3b/parallel.mjs";
import { mountView3d } from "../app/3b/view3d.mjs";

const fixture = JSON.parse(readFileSync(new URL("../examples/3a-demo/bundle.json", import.meta.url), "utf8"));

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
          if (selector === "input" && child.tagName === "input") found.push(child);
          if (selector === "input:checked" && child.tagName === "input" && child.checked) found.push(child);
          visit(child);
        }
      };
      visit(this);
      return found;
    }
    getBoundingClientRect() { return { left: 0, top: 0, width: 600, height: 390 }; }
    setPointerCapture() {}
  }
  const elements = new Map();
  return {
    elements,
    document: {
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, new Element("div"));
        return elements.get(id);
      },
      createElement(tag = "div") { return new Element(tag); },
      createElementNS(_namespace, tag) { return new Element(tag); },
    },
  };
}

describe("shared entry", { concurrency: 1 }, () => {
  test("the merged training-instance route loads both policies without inventing Pareto labels", async () => {
    const priorDocument = globalThis.document, priorFetch = globalThis.fetch, priorLocation = globalThis.location;
    const dom = createDom();
    globalThis.document = dom.document;
    globalThis.location = { search: "?bundle=p3-training-low" };
    const bundle = JSON.parse(readFileSync(new URL("../examples/p3-training-low/bundle.json", import.meta.url), "utf8"));
    let requested;
    globalThis.fetch = async url => { requested = url; return { ok: true, json: async () => structuredClone(bundle) }; };
    try {
      await import("../app/3a/app.mjs?p3-route-test");
      assert.equal(requested, "../../examples/p3-training-low/bundle.json");
      assert.equal(dom.elements.get("run-count").textContent, "2 / 2");
      assert.match(dom.elements.get("reference-status").textContent, /Incomplete/);
      assert.match(dom.elements.get("notice").textContent, /Incomplete reference set/);
      dom.elements.get("random-compare").listeners.click();
      assert.equal(dom.elements.get("selection-count").textContent, "2 selected");
      assert.equal(dom.elements.get("view3d").children[0].querySelectorAll("[data-run-id]").length, 2);
      assert.match(dom.elements.get("details-content").innerHTML, /Not calculated/);
      const page = readFileSync(new URL("../app/index.html", import.meta.url), "utf8");
      assert.match(page, /target.search = location.search/);
      assert.match(page, /location.replace\(target.href\)/);
    } finally {
      globalThis.document = priorDocument; globalThis.fetch = priorFetch; globalThis.location = priorLocation;
    }
  });
  test("one session highlights the same run across 3A and 3B views", () => {
    const prior = globalThis.document;
    const dom = createDom();
    globalThis.document = dom.document;
    try {
      const { model, state } = createSession(structuredClone(fixture));
      const plots = dom.document.createElement("div");
      const matrix = dom.document.createElement("div");
      const parallel = dom.document.createElement("div");
      const view = dom.document.createElement("div");
      const axes = structuredClone(state.get().axis_ranges);
      const label = structuredClone(model.labels.pairs.get("makespan_s|energy_j").get("3a-demo-run-f"));
      mountPairPlots(plots, model, state);
      mountMatrix(matrix, model, state);
      mountParallel(parallel, model, state);
      mountView3d(view, model, state);
      const svg = plots.children[0].children[2];
      svg.querySelectorAll("[data-run-id]").find((marker) => marker.dataset.runId === "3a-demo-run-f").listeners.click({ shiftKey: false });
      assert.deepEqual(state.get().selected_run_ids, ["3a-demo-run-f"]);
      assert.equal(parallel.children[0].querySelectorAll("[data-run-id]").find((line) => line.dataset.runId === "3a-demo-run-f").dataset.selected, "true");
      assert.equal(view.children[0].querySelectorAll("[data-run-id]").find((point) => point.dataset.runId === "3a-demo-run-f").dataset.selected, "true");
      const matrixGrid = matrix.children[0].children.find((child) => child.dataset.role === "grid");
      const matrixSvg = matrixGrid.children.find((cell) => cell.dataset.x === "makespan_s" && cell.dataset.y === "energy_j").children.find((child) => child.tagName === "svg");
      assert.match(matrixSvg.innerHTML, /3a-demo-run-f/);
      state.setVisibleConfigs(["fixture-a"]);
      assert.deepEqual(state.get().axis_ranges, axes);
      assert.deepEqual(model.labels.pairs.get("makespan_s|energy_j").get("3a-demo-run-f"), label);
      assert.deepEqual(state.get().selected_run_ids, ["3a-demo-run-f"]);
    } finally {
      globalThis.document = prior;
    }
  });

  test("the shared page loads the demo bundle once for every view", async () => {
    const priorDocument = globalThis.document;
    const priorFetch = globalThis.fetch;
    const dom = createDom();
    globalThis.document = dom.document;
    let requested;
    globalThis.fetch = async (url) => {
      requested = url;
      return { ok: true, json: async () => structuredClone(fixture) };
    };
    try {
      await import("../app/app.mjs");
      assert.equal(requested, "../../examples/3a-demo/bundle.json");
      const matrixGrid = dom.elements.get("matrix").children[0].children.find((child) => child.dataset.role === "grid");
      assert.equal(matrixGrid.children.length, 9);
      assert.match(dom.elements.get("reference-ids").textContent, /None/);
      assert.match(dom.elements.get("notice").textContent, /not scheduler outputs/);
      const svg = matrixGrid.children.find(cell => cell.dataset.x === "makespan_s" && cell.dataset.y === "energy_j").children.find(child => child.tagName === "svg");
      svg.querySelectorAll("[data-run-id]").find((marker) => marker.dataset.runId === "3a-demo-run-f").listeners.click({ shiftKey: false });
      assert.equal(dom.elements.get("selection-ids").textContent, "3a-demo-run-f");
      assert.match(dom.elements.get("details-content").innerHTML, /3a-demo-run-g/);
      assert.match(dom.elements.get("details-content").innerHTML, /Strictly better/);
      assert.equal(
        dom.elements.get("view3d").children[0].querySelectorAll("[data-run-id]").find((point) => point.dataset.runId === "3a-demo-run-f").dataset.selected,
        "true",
      );
      dom.elements.get("clear-selection").listeners.click();
      assert.equal(dom.elements.get("selection-ids").textContent, "None");
    } finally {
      globalThis.document = priorDocument;
      globalThis.fetch = priorFetch;
    }
  });
});
