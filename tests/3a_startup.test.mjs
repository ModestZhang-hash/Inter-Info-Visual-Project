import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("application starts with the matrix and expands one cell from the archived demo bundle", async () => {
  const bundle = JSON.parse(readFileSync(new URL("../examples/3a-demo/bundle.json", import.meta.url), "utf8"));
  const elements = new Map();
  class Element {
    constructor(tag = "div") {
      this.tagName = tag;
      this.children = [];
      this.dataset = {};
      this.style = {};
      this.listeners = {};
      this.classList = { toggle() {} };
      this.textContent = "";
      this.innerHTML = "";
    }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    removeEventListener(name, callback) { if (this.listeners[name] === callback) delete this.listeners[name]; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = [...children]; }
    querySelectorAll(selector) {
      if (selector !== "[data-run-id]") return [];
      this.markers = [...this.innerHTML.matchAll(/data-run-id="([^"]+)"/g)].map((match) => {
        const marker = new Element();
        marker.dataset.runId = match[1];
        return marker;
      });
      return this.markers;
    }
    querySelector() { return new Element(); }
    setAttribute() {}
    setPointerCapture() {}
    getBoundingClientRect() { return { left: 0, top: 0, width: 600, height: 390 }; }
  }
  const priorDocument = globalThis.document;
  const priorFetch = globalThis.fetch;
  let requested;
  globalThis.document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new Element());
      return elements.get(id);
    },
    createElement(tag = "div") { return new Element(tag); },
    createElementNS(_namespace, tag) { return new Element(tag); },
  };
  globalThis.fetch = async (url) => {
    requested = url;
    return { ok: true, json: async () => bundle };
  };
  try {
    await import("../app/3a/app.mjs");
    assert.equal(requested, "../../examples/3a-demo/bundle.json");
    const matrixGrid = elements.get("matrix").children[0].children.find((child) => child.dataset.role === "grid");
    assert.equal(matrixGrid.children.length, 9);
    assert.equal(elements.get("focused-section").hidden, true);
    const firstCell = matrixGrid.children.find(cell => cell.dataset.x === "makespan_s" && cell.dataset.y === "energy_j");
    firstCell.children.find((child) => child.tagName === "button").listeners.click();
    assert.equal(elements.get("matrix-section").hidden, true);
    assert.equal(elements.get("focused-section").hidden, false);
    assert.equal(elements.get("focused-plot").children.length, 1);
    assert.equal(elements.get("instance-id").textContent, "3a-demo-instance-001");
    assert.equal(elements.get("run-count").textContent, "7 / 7");
    assert.doesNotMatch(elements.get("notice").textContent, /Unable to load|Import failed/);
    const firstSvg = elements.get("focused-plot").children[0].children.find((child) => child.tagName === "svg");
    firstSvg.markers.find((marker) => marker.dataset.runId === "3a-demo-run-f").listeners.click({ shiftKey: false });
    assert.equal(elements.get("selection-count").textContent, "1 selected");
    assert.match(elements.get("details-content").innerHTML, /3a-demo-run-g/);
    assert.match(elements.get("details-content").innerHTML, /Strictly better/);
    const nextSvg = elements.get("focused-plot").children[0].children.find((child) => child.tagName === "svg");
    assert.equal(nextSvg.listeners.pointerdown, undefined);
    assert.equal(nextSvg.listeners.pointerup, undefined);
    assert.doesNotMatch(nextSvg.innerHTML, /class="brush"/);
    assert.equal(elements.get("selection-count").textContent, "1 selected");
    assert.equal(elements.get("matching-count").textContent, "7");
  } finally {
    globalThis.document = priorDocument;
    globalThis.fetch = priorFetch;
  }
});
