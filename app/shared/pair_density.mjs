export function binPairs(runs, xKey, yKey, xRange, yRange, size = 20) {
  if (!Number.isInteger(size) || size < 1 || !(xRange.min < xRange.max && yRange.min < yRange.max)) throw new Error("Invalid pair density grid");
  const valid = runs.filter(run => run.status === "complete");
  if (new Set(valid.map(run => run.instance_id)).size > 1) throw new Error("Pair density cannot mix instances");
  const bins = new Map();
  for (const run of valid) {
    const x = run[xKey], y = run[yKey];
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < xRange.min || x > xRange.max || y < yRange.min || y > yRange.max) continue;
    const col = Math.min(size - 1, Math.floor((x - xRange.min) / (xRange.max - xRange.min) * size));
    const row = Math.min(size - 1, Math.floor((y - yRange.min) / (yRange.max - yRange.min) * size));
    const key = `${col}|${row}`;
    if (!bins.has(key)) bins.set(key, { col, row, runIds: [] });
    bins.get(key).runIds.push(run.run_id);
  }
  return [...bins.values()].sort((a, b) => a.col - b.col || a.row - b.row).map(bin => ({ ...bin, count: bin.runIds.length }));
}
