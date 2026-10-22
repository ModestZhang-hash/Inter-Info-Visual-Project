import { classifyAll, OBJECTIVES } from "./pareto.mjs";

const fail = (message) => { throw new Error(message); };
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const requireId = (value, label) => {
  if (typeof value !== "string" || !value.trim()) fail(`${label} is required`);
};
const close = (a, b, tolerance) => Math.abs(a - b) <= Math.max(
  tolerance.absolute,
  tolerance.relative * Math.max(Math.abs(a), Math.abs(b)),
);

export function readBundle(bundle) {
  if (!bundle || bundle.schema_version !== "1.0.0") fail("Unsupported bundle schema_version");
  const { manifest, instance, runs, events } = bundle;
  if (!manifest || !instance || !Array.isArray(runs) || !Array.isArray(events)) fail("Bundle needs manifest, instance, runs, and events");
  if (manifest.schema_version !== "1.0.0" || instance.schema_version !== "1.0.0") fail("Unsupported contract schema_version");
  requireId(manifest.manifest_id, "manifest_id");
  requireId(instance.instance_id, "instance_id");
  if (instance.manifest_id !== manifest.manifest_id) fail("Instance/manifest mismatch");
  if (!["fixture", "training", "pilot", "held_out"].includes(manifest.phase) || instance.phase !== manifest.phase) fail("Invalid or mismatched phase");
  if (!Array.isArray(instance.tasks) || !instance.tasks.length) fail("Instance tasks are missing");
  const tasks = new Map();
  for (const task of instance.tasks) {
    requireId(task.task_id, "task_id");
    if (tasks.has(task.task_id)) fail(`Duplicate task_id: ${task.task_id}`);
    if (!finite(task.arrival_s) || task.arrival_s < 0) fail(`Invalid arrival: ${task.task_id}`);
    if (!finite(task.compute_cycles) || task.compute_cycles <= 0 || !Number.isSafeInteger(task.upload_bytes) || task.upload_bytes < 0 || !Number.isSafeInteger(task.return_bytes) || task.return_bytes < 0) fail(`Invalid task fields: ${task.task_id}`);
    tasks.set(task.task_id, task);
  }
  const tolerance = manifest.numeric_tolerance;
  if (!tolerance || !finite(tolerance.absolute) || !finite(tolerance.relative) || tolerance.absolute < 0 || tolerance.relative < 0) {
    fail("Invalid numeric_tolerance");
  }
  const configs = manifest.policy_configs;
  if (!Array.isArray(configs) || new Set(configs.map((item) => item.policy_config_id)).size !== configs.length) fail("Invalid policy_configs");
  for (const config of configs) requireId(config.policy_config_id, "policy_config_id");
  const configIds = new Set(configs.map((item) => item.policy_config_id));
  const nodes = new Map((manifest.topology?.nodes ?? []).map((node) => [node.node_id, node]));
  if (!nodes.size || nodes.size !== manifest.topology.nodes.length || !nodes.has(manifest.topology.gateway_node_id)) fail("Invalid topology nodes");
  const runIds = new Set();
  const byRun = new Map();
  for (const event of events) {
    requireId(event.run_id, "event.run_id");
    if (!byRun.has(event.run_id)) byRun.set(event.run_id, []);
    byRun.get(event.run_id).push(event);
  }
  for (const run of runs) {
    requireId(run.run_id, "run_id");
    if (runIds.has(run.run_id)) fail(`Duplicate run_id: ${run.run_id}`);
    runIds.add(run.run_id);
    if (run.schema_version !== "1.0.0" || run.instance_id !== instance.instance_id || run.manifest_id !== manifest.manifest_id) fail(`Invalid references: ${run.run_id}`);
    if (!configIds.has(run.policy_config_id)) fail(`Unknown policy_config_id: ${run.run_id}`);
    if (!["simulation", "manual_fixture"].includes(run.record_origin)) fail(`Invalid record_origin: ${run.run_id}`);
    if (manifest.phase !== "fixture" && run.record_origin !== "simulation") fail(`Non-fixture run must come from simulation: ${run.run_id}`);
    requireId(run.event_log_path, "event_log_path");
    if (run.task_count !== tasks.size) fail(`Task count mismatch: ${run.run_id}`);
    const runEvents = byRun.get(run.run_id) ?? [];
    const seen = new Set();
    for (const event of runEvents) {
      if (event.schema_version !== "1.0.0" || event.instance_id !== instance.instance_id) fail(`Invalid event reference: ${run.run_id}`);
      if (!tasks.has(event.task_id) || seen.has(event.task_id)) fail(`Unknown or duplicate event task: ${run.run_id}/${event.task_id}`);
      if (!nodes.has(event.destination_id)) fail(`Unknown event destination: ${run.run_id}/${event.task_id}`);
      seen.add(event.task_id);
    }
    if (run.status === "complete") {
      if (run.failure_reason !== null) fail(`Complete run has failure reason: ${run.run_id}`);
      if (runEvents.length !== tasks.size || runEvents.some((event) => event.status !== "complete")) fail(`Incomplete event log: ${run.run_id}`);
      for (const key of OBJECTIVES) if (!finite(run[key]) || run[key] < 0) fail(`Invalid ${key}: ${run.run_id}`);
      for (const event of runEvents) {
        const task = tasks.get(event.task_id);
        const node = nodes.get(event.destination_id);
        const local = event.destination_id === manifest.topology.gateway_node_id;
        const timeline = local
          ? [task.arrival_s, event.compute_start_s, event.compute_end_s, event.completion_s]
          : [task.arrival_s, event.upload_start_s, event.upload_end_s, event.compute_start_s, event.compute_end_s, event.return_start_s, event.return_end_s, event.completion_s];
        if (timeline.some((value) => !finite(value)) || timeline.some((value, index) => index > 0 && value + tolerance.absolute < timeline[index - 1])) {
          fail(`Invalid event timeline: ${run.run_id}/${event.task_id}`);
        }
        if (local && [event.upload_start_s, event.upload_end_s, event.return_start_s, event.return_end_s].some((value) => value !== null)) {
          fail(`Local task has transfer stages: ${run.run_id}/${event.task_id}`);
        }
        if (!close(event.completion_s, local ? event.compute_end_s : event.return_end_s, tolerance)) fail(`Completion mismatch: ${run.run_id}/${event.task_id}`);
        if (!finite(event.compute_energy_j) || !finite(event.transfer_energy_j) || event.compute_energy_j < 0 || event.transfer_energy_j < 0) fail(`Invalid event energy: ${run.run_id}/${event.task_id}`);
        const computeEnergy = (event.compute_end_s - event.compute_start_s) * node.active_compute_power_increment_w;
        const transferEnergy = local ? 0 : (task.upload_bytes + task.return_bytes) / 1_000_000 * node.transfer_energy_j_per_mb;
        if (!close(event.compute_energy_j, computeEnergy, tolerance) || !close(event.transfer_energy_j, transferEnergy, tolerance)) {
          fail(`Event energy mismatch: ${run.run_id}/${event.task_id}`);
        }
      }
      const completions = runEvents.map((event) => event.completion_s);
      if (completions.some((value) => !finite(value))) fail(`Invalid completion: ${run.run_id}`);
      const makespan = Math.max(...completions) - Math.min(...instance.tasks.map((task) => task.arrival_s));
      const latency = runEvents.reduce((sum, event) => sum + event.completion_s - tasks.get(event.task_id).arrival_s, 0) / tasks.size;
      const energy = runEvents.reduce((sum, event) => {
        return sum + event.compute_energy_j + event.transfer_energy_j;
      }, 0);
      for (const [key, expected] of [["makespan_s", makespan], ["mean_latency_s", latency], ["energy_j", energy]]) {
        if (!close(run[key], expected, tolerance)) fail(`Metric mismatch ${key}: ${run.run_id}`);
      }
    } else if (run.status === "failed") {
      if (typeof run.failure_reason !== "string" || !run.failure_reason.trim()) fail(`Failed run lacks reason: ${run.run_id}`);
      if (OBJECTIVES.some((key) => run[key] !== null)) fail(`Failed run has objective values: ${run.run_id}`);
    } else fail(`Unknown run status: ${run.run_id}`);
  }
  for (const id of byRun.keys()) if (!runIds.has(id)) fail(`Orphan event run_id: ${id}`);
  const complete = runs.filter((run) => run.status === "complete");
  const hasSeven = configs.length === 7 && configs.every((config) => runs.filter((run) => run.policy_config_id === config.policy_config_id).length === 1);
  const fixture = manifest.phase === "fixture" || runs.some((run) => run.record_origin === "manual_fixture");
  const referenceStatus = fixture ? "fixture_only" : hasSeven && complete.length === 7 ? "complete" : "incomplete_candidates";
  const referenceRuns = referenceStatus === "complete" || (fixture && hasSeven && complete.length === 7) ? complete : [];
  const labels = classifyAll(referenceRuns, tolerance);
  if (referenceStatus === "complete" && !bundle.pareto_check) fail("Official Pareto labels require the Python pareto_check in the bundle");
  if (bundle.pareto_check) {
    const entries = (map) => Object.fromEntries([...map].map(([id, value]) => [id, {
      non_dominated: value.nonDominated,
      witness_run_ids: value.witnessRunIds,
      witnesses: value.witnesses.map((item) => ({
        witness_run_id: item.witnessRunId,
        compared_objectives: item.comparedObjectives,
        target_metrics: item.targetMetrics,
        witness_metrics: item.witnessMetrics,
        relations: item.relations,
      })),
    }]));
    const actual = { full: entries(labels.full), pairs: Object.fromEntries([...labels.pairs].map(([key, map]) => [key, entries(map)])) };
    if (JSON.stringify(actual) !== JSON.stringify(bundle.pareto_check)) fail("Python/JavaScript Pareto check mismatch");
  }
  return { manifest, instance, runs, events, configs, tolerance, referenceStatus, referenceRuns, labels };
}

export function defaultAxisRanges(runs) {
  return Object.fromEntries(OBJECTIVES.map((key) => {
    const values = runs.filter((run) => run.status === "complete").map((run) => run[key]);
    if (!values.length) return [key, { min: 0, max: 1 }];
    const low = Math.min(...values);
    const high = Math.max(...values);
    const span = high - low || Math.max(high * 0.1, 1);
    return [key, { min: Math.max(0, low - span * 0.12), max: high + span * 0.12 }];
  }));
}
