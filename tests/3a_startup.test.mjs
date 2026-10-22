import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("3A application initializes three plots from the archived demo bundle", async () => {
  const bundle = JSON.parse(readFileSync(new URL("../examples/3a-demo/bundle.json", import.meta.url), "utf8"));
  const elements = new Map();
  class Element {
    constructor() {
      this.children = [];
      this.dataset = {};
      this.style = {};
      this.listeners = {};
      this.classList = { toggle() {} };
      this.textContent = "";
      this.innerHTML = "";
    }
    addEventListener(name, callback) { this.listeners[name] = callback; }
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
    createElement() { return new Element(); },
    createElementNS() { return new Element(); },
  };
  globalThis.fetch = async (url) => {
    requested = url;
    return { ok: true, json: async () => bundle };
  };
  try {
    await import("../app/3a/app.mjs");
    assert.equal(requested, "../../examples/3a-demo/bundle.json");
    assert.equal(elements.get("plots").children.length, 3);
    assert.equal(elements.get("instance-id").textContent, "3a-demo-instance-001");
    assert.equal(elements.get("run-count").textContent, "7 / 7");
    assert.doesNotMatch(elements.get("notice").textContent, /无法载入|导入失败/);
    const firstSvg = elements.get("plots").children[0].children[2];
    firstSvg.markers.find((marker) => marker.dataset.runId === "3a-demo-run-f").listeners.click({ shiftKey: false });
    assert.equal(elements.get("selection-count").textContent, "1");
    assert.match(elements.get("details-content").innerHTML, /3a-demo-run-g/);
    assert.match(elements.get("details-content").innerHTML, /严格更优/);
    const nextSvg = elements.get("plots").children[0].children[2];
    nextSvg.listeners.pointerdown({ target: { closest: () => null }, clientX: 0, clientY: 0, pointerId: 1 });
    nextSvg.listeners.pointermove({ clientX: 600, clientY: 390 });
    nextSvg.listeners.pointerup({ clientX: 600, clientY: 390, shiftKey: false });
    assert.equal(elements.get("selection-count").textContent, "7");
  } finally {
    globalThis.document = priorDocument;
    globalThis.fetch = priorFetch;
  }
});
