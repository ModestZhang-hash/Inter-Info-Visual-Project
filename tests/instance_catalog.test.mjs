import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const catalog = JSON.parse(readFileSync(new URL("../examples/instances/catalog.json", import.meta.url), "utf8"));
const items = catalog.groups.flatMap((group) => group.items);

test("the instance catalog lists every archived instance once", () => {
  assert.deepEqual(catalog.groups.map((group) => group.label), [
    "Training",
    "Pilot",
    "Held-out · low",
    "Held-out · medium",
    "Held-out · high",
  ]);
  assert.equal(items.length, 42);
  assert.equal(new Set(items.map((item) => item.instance_id)).size, 42);
  assert.equal(items.filter((item) => item.reference === "complete").length, 36);
  const training = items.find((item) => item.instance_id === "provisional-training-low-1000");
  const held = items.find((item) => item.instance_id === "provisional-held_out-low-3000");
  const partial = items.find((item) => item.instance_id === "provisional-training-medium-1001");
  assert.equal(training.bundle, "../../examples/p6-six-heuristic/bundle.json");
  assert.equal(training.status_label, "6 archived runs");
  assert.equal(held.bundle, "../../examples/p11-held-out-low-3000/bundle.json");
  assert.equal(held.status_label, "7 candidates");
  assert.equal(partial.archived_runs, 2);
  assert.equal(partial.reference, "incomplete");
  assert.equal(JSON.parse(readFileSync(new URL("../examples/instances/provisional-pilot-low-2000/bundle.json", import.meta.url), "utf8")).pareto_check, undefined);
  const page = readFileSync(new URL("../app/3a/index.html", import.meta.url), "utf8");
  assert.match(page, /Experimental instances/);
  assert.match(page, /id="load-small-demo"/);
  assert.match(page, /id="load-stress-demo"/);
  assert.doesNotMatch(page, /href="\?bundle=p3-training-low"/);
});

test("an instance query loads that instance and keeps legacy bundle routes", async () => {
  const bundle = JSON.parse(readFileSync(new URL("../examples/instances/provisional-held_out-low-3001/bundle.json", import.meta.url), "utf8"));
  const elements = new Map();
  class Element {
    constructor(tag = "div") {
      this.tagName = tag;
      this.children = [];
      this.dataset = {};
      this.style = {};
      this.attributes = {};
      this.listeners = {};
      this.classList = { toggle() {} };
      this.textContent = "";
      this.innerHTML = "";
      this.hidden = false;
    }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = [...children]; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name]; }
    querySelectorAll() { return []; }
    querySelector() { return new Element(); }
    setPointerCapture() {}
    getBoundingClientRect() { return { left: 0, top: 0, width: 600, height: 390 }; }
  }
  const urls = [];
  const priorDocument = globalThis.document;
  const priorFetch = globalThis.fetch;
  const priorLocation = globalThis.location;
  globalThis.document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new Element());
      return elements.get(id);
    },
    createElement(tag = "div") { return new Element(tag); },
    createElementNS(_namespace, tag) { return new Element(tag); },
  };
  globalThis.location = { search: "?instance=provisional-held_out-low-3001", pathname: "/app/3a/index.html" };
  globalThis.fetch = async (url) => {
    urls.push(url);
    const body = String(url).endsWith("catalog.json") ? catalog : bundle;
    return { ok: true, json: async () => body };
  };
  try {
    await import("../app/3a/app.mjs?instance-catalog=1");
    assert.deepEqual(urls, [
      "../../examples/instances/catalog.json",
      "../../examples/instances/provisional-held_out-low-3001/bundle.json",
    ]);
    assert.equal(elements.get("instance-id").textContent, "provisional-held_out-low-3001");
    assert.equal(elements.get("run-count").textContent, "7 / 7");
    assert.match(elements.get("reference-status").textContent, /Complete/);
    const buttons = [...elements.get("instance-menu").children].flatMap((group) => group.children.filter((child) => child.tagName === "button"));
    assert.equal(buttons.length, 42);
    assert.equal(buttons.find((button) => button.dataset.instanceId === "provisional-held_out-low-3001").attributes["aria-current"], "true");
  } finally {
    globalThis.document = priorDocument;
    globalThis.fetch = priorFetch;
    globalThis.location = priorLocation;
  }
});
