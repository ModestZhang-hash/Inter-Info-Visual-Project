export const OBJECTIVES = ["makespan_s", "energy_j", "mean_latency_s"];
export const PAIRS = [
  ["makespan_s", "energy_j"],
  ["makespan_s", "mean_latency_s"],
  ["energy_j", "mean_latency_s"],
];

function compareIds(left, right) {
  const a = Array.from(left, (character) => character.codePointAt(0));
  const b = Array.from(right, (character) => character.codePointAt(0));
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

export function dominanceRelations(a, b, objectives, tolerance = { absolute: 0, relative: 0 }) {
  if (!objectives.length) throw new Error("At least one objective is required");
  if (!Number.isFinite(tolerance.absolute) || tolerance.absolute < 0 || !Number.isFinite(tolerance.relative) || tolerance.relative < 0) {
    throw new Error("Invalid numeric tolerance");
  }
  let strictlyBetter = false;
  const relations = {};
  for (const key of objectives) {
    if (!OBJECTIVES.includes(key)) throw new Error(`Unknown objective: ${key}`);
    const left = a[key];
    const right = b[key];
    if (!Number.isFinite(left) || !Number.isFinite(right)) {
      throw new Error(`Non-finite objective: ${key}`);
    }
    const margin = Math.max(
      tolerance.absolute ?? 0,
      (tolerance.relative ?? 0) * Math.max(Math.abs(left), Math.abs(right)),
    );
    if (left > right + margin) return null;
    if (left < right - margin) {
      strictlyBetter = true;
      relations[key] = "strict_improvement";
    } else relations[key] = left === right ? "equal" : "equivalent_within_tolerance";
  }
  return strictlyBetter ? relations : null;
}

export function dominates(a, b, objectives, tolerance = { absolute: 0, relative: 0 }) {
  return dominanceRelations(a, b, objectives, tolerance) !== null;
}

export function classify(runs, objectives, tolerance) {
  const sorted = [...runs].sort((a, b) => compareIds(a.run_id, b.run_id));
  if (new Set(sorted.map((run) => run.run_id)).size !== sorted.length) {
    throw new Error("Duplicate run_id in Pareto reference set");
  }
  if (new Set(sorted.map((run) => run.instance_id)).size > 1) {
    throw new Error("Pareto reference set mixes workload instances");
  }
  const result = new Map();
  for (const run of sorted) {
    if (run.status !== "complete") continue;
    const witnesses = sorted
      .filter((candidate) => candidate.status === "complete" && candidate.run_id !== run.run_id)
      .map((candidate) => ({ candidate, relations: dominanceRelations(candidate, run, objectives, tolerance) }))
      .filter(({ relations }) => relations !== null)
      .map(({ candidate, relations }) => ({
        witnessRunId: candidate.run_id,
        comparedObjectives: [...objectives],
        targetMetrics: Object.fromEntries(OBJECTIVES.map((key) => [key, run[key]])),
        witnessMetrics: Object.fromEntries(OBJECTIVES.map((key) => [key, candidate[key]])),
        relations,
      }));
    result.set(run.run_id, {
      nonDominated: witnesses.length === 0,
      witnessRunIds: witnesses.map((entry) => entry.witnessRunId),
      witnesses,
    });
  }
  return result;
}

export function classifyAll(runs, tolerance) {
  return {
    full: classify(runs, OBJECTIVES, tolerance),
    pairs: new Map(PAIRS.map((pair) => [pair.join("|"), classify(runs, pair, tolerance)])),
  };
}
