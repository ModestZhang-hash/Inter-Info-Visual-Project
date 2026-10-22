import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { classify, dominates, OBJECTIVES } from "../app/3a/pareto.mjs";
import { readBundle } from "../app/3a/model.mjs";
import { createViewState } from "../app/shared/state.mjs";
import { drawPairScatter } from "../app/shared/pair_scatter.mjs";
import { stableConfigIndex } from "../app/shared/encoding.mjs";

const fixture = JSON.parse(readFileSync(new URL("../examples/3a-demo/bundle.json", import.meta.url), "utf8"));
const clone = () => structuredClone(fixture);

test("manual fixture has auditable metrics and the required 2D/3D disagreement", () => {
  const model = readBundle(clone());
  assert.equal(model.referenceStatus, "fixture_only");
  assert.equal(model.referenceRuns.length, 7);
  const pair = model.labels.pairs.get("makespan_s|energy_j");
  assert.deepEqual(pair.get("3a-demo-run-f").witnessRunIds, ["3a-demo-run-g"]);
  assert.equal(pair.get("3a-demo-run-f").nonDominated, false);
  assert.equal(model.labels.full.get("3a-demo-run-f").nonDominated, true);
  assert.equal(model.runs.find((run) => run.run_id === "3a-demo-run-a").energy_j, 6.965);
});

test("dominance handles exact ties, an equal axis, tolerance, and instance isolation", () => {
  const tolerance = { absolute: 1e-9, relative: 0 };
  const a = { run_id: "a", instance_id: "one", status: "complete", makespan_s: 1, energy_j: 2, mean_latency_s: 3 };
  const b = { ...a, run_id: "b" };
  const c = { ...a, run_id: "c", energy_j: 4 };
  assert.equal(dominates(a, b, OBJECTIVES, tolerance), false);
  assert.equal(dominates(a, c, OBJECTIVES, tolerance), true);
  assert.equal(dominates({ ...a, makespan_s: 1 + 1e-10 }, c, OBJECTIVES, tolerance), true);
  assert.deepEqual(classify([c, b, a], OBJECTIVES, tolerance).get("c").witnessRunIds, ["a", "b"]);
  assert.throws(() => classify([a, { ...b, instance_id: "two" }], OBJECTIVES, tolerance), /mixes workload instances/);
});

test("bundle reader rejects duplicate IDs, metric drift, and failed runs with values", () => {
  const duplicate = clone();
  duplicate.runs[1].run_id = duplicate.runs[0].run_id;
  assert.throws(() => readBundle(duplicate), /Duplicate run_id/);
  const drift = clone();
  drift.runs[0].energy_j += 1;
  assert.throws(() => readBundle(drift), /Metric mismatch energy_j/);
  const failed = clone();
  failed.runs[0].status = "failed";
  failed.runs[0].failure_reason = "test failure";
  assert.throws(() => readBundle(failed), /Failed run has objective values/);
});

test("shared filters do not rewrite the reference IDs or axis ranges", () => {
  const payload = clone();
  payload.manifest.phase = "held_out";
  payload.instance.phase = "held_out";
  payload.runs.forEach((run) => { run.record_origin = "simulation"; run.simulator_version = "test-only"; });
  const model = readBundle(payload);
  assert.equal(model.referenceStatus, "complete");
  const axes = { makespan_s: { min: 0, max: 2 }, energy_j: { min: 0, max: 10 }, mean_latency_s: { min: 0, max: 2 } };
  const reference = model.referenceRuns.map((run) => run.run_id);
  const originalLabel = structuredClone(model.labels.pairs.get("makespan_s|energy_j").get("3a-demo-run-f"));
  const view = createViewState({ current_instance_id: model.instance.instance_id, selected_run_ids: ["3a-demo-run-f"], visible_policy_config_ids: model.configs.map((item) => item.policy_config_id), axis_ranges: axes, pareto_reference_run_ids: reference, pareto_reference_status: "complete" });
  view.setVisibleConfigs(["fixture-g"]);
  assert.deepEqual(view.get().axis_ranges, axes);
  assert.deepEqual(view.get().selected_run_ids, ["3a-demo-run-f"]);
  assert.deepEqual(view.get().pareto_reference_run_ids, reference);
  assert.deepEqual(model.labels.pairs.get("makespan_s|energy_j").get("3a-demo-run-f"), originalLabel);
  view.changeInstance("another", ["other-run"], ["other-config"], axes, ["other-run"], "complete");
  assert.deepEqual(view.get().selected_run_ids, []);
});

test("failed run is not classified and stale Python check is rejected", () => {
  const failed = clone();
  failed.runs[0].status = "failed";
  failed.runs[0].failure_reason = "test failure";
  for (const key of OBJECTIVES) failed.runs[0][key] = null;
  delete failed.pareto_check;
  const model = readBundle(failed);
  assert.equal(model.referenceStatus, "fixture_only");
  assert.equal(model.referenceRuns.length, 0);
  assert.equal(model.labels.full.has("3a-demo-run-a"), false);
  const stale = clone();
  stale.pareto_check.full["3a-demo-run-f"].witness_run_ids = ["wrong"];
  assert.throws(() => readBundle(stale), /Pareto check mismatch/);
});

test("3D dominance can coexist with a tied, non-dominated 2D projection", () => {
  const rows = [
    { run_id: "target", instance_id: "same", status: "complete", makespan_s: 1, energy_j: 2, mean_latency_s: 3 },
    { run_id: "w", instance_id: "same", status: "complete", makespan_s: 1, energy_j: 2, mean_latency_s: 2 },
  ];
  const two = classify(rows, ["makespan_s", "energy_j"], { absolute: 0, relative: 0 });
  const three = classify(rows, OBJECTIVES, { absolute: 0, relative: 0 });
  assert.equal(two.get("target").nonDominated, true);
  assert.equal(three.get("target").nonDominated, false);
  assert.deepEqual(three.get("target").witnesses[0].relations, {
    makespan_s: "equal", energy_j: "equal", mean_latency_s: "strict_improvement",
  });
});

test("witness contains deterministic full metrics and tolerance relations", () => {
  const rows = [
    { run_id: "target", instance_id: "one", status: "complete", makespan_s: 1, energy_j: 3, mean_latency_s: 4 },
    { run_id: "z", instance_id: "one", status: "complete", makespan_s: 1, energy_j: 2, mean_latency_s: 2 },
    { run_id: "a", instance_id: "one", status: "complete", makespan_s: 1 + 5e-10, energy_j: 1, mean_latency_s: 3 },
  ];
  const result = classify(rows, OBJECTIVES, { absolute: 1e-9, relative: 0 }).get("target");
  assert.deepEqual(result.witnessRunIds, ["a", "z"]);
  assert.deepEqual(result.witnesses[0].comparedObjectives, OBJECTIVES);
  assert.equal(result.witnesses[0].targetMetrics.mean_latency_s, 4);
  assert.equal(result.witnesses[0].witnessMetrics.makespan_s, 1 + 5e-10);
  assert.equal(result.witnesses[0].relations.makespan_s, "equivalent_within_tolerance");
});

test("policy color and shape slot does not depend on manifest array order", () => {
  const configs = fixture.manifest.policy_configs;
  for (const config of configs) {
    assert.equal(stableConfigIndex(configs, config.policy_config_id), stableConfigIndex([...configs].reverse(), config.policy_config_id));
  }
});

test("reusable scatter draws stored values and sends click and brush IDs", () => {
  const model = readBundle(clone());
  const listeners = new Map();
  let clickId, brushIds;
  const brush = { setAttribute() {} };
  const svg = {
    markup: "",
    setAttribute() {},
    set innerHTML(value) { this.markup = value; },
    get innerHTML() { return this.markup; },
    querySelector() { return brush; },
    querySelectorAll() {
      return [...this.markup.matchAll(/data-run-id="([^"]+)"/g)].map((match) => {
        const handlers = {};
        const element = { dataset: { runId: match[1] }, addEventListener(name, handler) { handlers[name] = handler; }, handlers };
        return element;
      });
    },
    addEventListener(name, handler) { listeners.set(name, handler); },
    setPointerCapture() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 600, height: 390 }; },
  };
  // Save the created marker elements to exercise their click callbacks.
  const originalQuery = svg.querySelectorAll.bind(svg);
  let markers;
  svg.querySelectorAll = () => (markers = originalQuery());
  const x = "makespan_s", y = "energy_j";
  drawPairScatter(svg, {
    runs: model.runs, xKey: x, yKey: y,
    xRange: { min: 0, max: 2 }, yRange: { min: 0, max: 10 },
    selectedRunIds: ["3a-demo-run-a"], projectedLabels: model.labels.pairs.get(`${x}|${y}`), fullLabels: model.labels.full,
    axisLabels: { [x]: "M (s) ↓", [y]: "E (J) ↓" }, encodeRun: () => ({ index: 0, color: "#197b65" }),
    tooltip: (run) => `${run.run_id} M=${run.makespan_s} E=${run.energy_j} L=${run.mean_latency_s}`,
    onSelect: (id) => { clickId = id; }, onBrush: (ids) => { brushIds = ids; }, formatValue: String,
  });
  assert.match(svg.markup, /M \(s\) ↓/);
  assert.match(svg.markup, /E \(J\) ↓/);
  assert.match(svg.markup, /3a-demo-run-a M=1\.02 E=6\.965 L=0\.76/);
  assert.match(svg.markup, /class="run-id-label"/);
  markers[0].handlers.click({ shiftKey: false });
  assert.equal(clickId, "3a-demo-run-a");
  listeners.get("pointerdown")({ target: { closest: () => null }, clientX: 0, clientY: 0, pointerId: 1 });
  listeners.get("pointermove")({ clientX: 600, clientY: 390 });
  listeners.get("pointerup")({ clientX: 600, clientY: 390, shiftKey: false });
  assert.equal(brushIds.length, 7);
});
