/** Reusable pairwise SVG renderer. The owning view supplies records, labels and state callbacks. */
import { binPairs } from "./pair_density.mjs";
import { formatTick, niceTicks } from "./axis_ticks.mjs";
import { MARK_RING_3D, MARK_RING_COMPARISON, MARK_STROKE_2D } from "./encoding.mjs?v=ink-1";

export const PAIR_LAYOUT = Object.freeze({ width: 600, height: 390, left: 68, right: 25, top: 26, bottom: 58 });
const { width: W, height: H, left: LEFT, right: RIGHT, top: TOP, bottom: BOTTOM } = PAIR_LAYOUT;
const xml = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

export function scatterMarker(index, x, y, color, stroke) {
  const common = `fill="${color}" stroke="${stroke}" stroke-width="1"`;
  switch (index % 7) {
    case 0: return `<circle class="mark-shape" cx="${x}" cy="${y}" r="4" ${common}/>`;
    case 1: return `<rect class="mark-shape" x="${x - 3.5}" y="${y - 3.5}" width="7" height="7" ${common}/>`;
    case 2: return `<path class="mark-shape" d="M${x} ${y - 5} L${x + 5} ${y} L${x} ${y + 5} L${x - 5} ${y}Z" ${common}/>`;
    case 3: return `<path class="mark-shape" d="M${x} ${y - 5} L${x + 5} ${y + 4} L${x - 5} ${y + 4}Z" ${common}/>`;
    case 4: return `<path class="mark-shape" d="M${x} ${y - 5} L${x + 4.6} ${y - 1.4} L${x + 2.8} ${y + 4.2} L${x - 2.8} ${y + 4.2} L${x - 4.6} ${y - 1.4}Z" ${common}/>`;
    case 5: return `<path class="mark-shape" d="M${x - 1.4} ${y - 4.6} H${x + 1.4} V${y - 1.4} H${x + 4.6} V${y + 1.4} H${x + 1.4} V${y + 4.6} H${x - 1.4} V${y + 1.4} H${x - 4.6} V${y - 1.4} H${x - 1.4}Z" ${common}/>`;
    default: return `<path class="mark-shape" d="M${x - 3.6} ${y - 5} L${x} ${y - 1.4} L${x + 3.6} ${y - 5} L${x + 5} ${y - 3.6} L${x + 1.4} ${y} L${x + 5} ${y + 3.6} L${x + 3.6} ${y + 5} L${x} ${y + 1.4} L${x - 3.6} ${y + 5} L${x - 5} ${y + 3.6} L${x - 1.4} ${y} L${x - 5} ${y - 3.6}Z" ${common}/>`;
  }
}

export function drawPairScatter(svg, options) {
  const { runs, xKey, yKey, xRange, yRange, selectedRunIds, projectedLabels, fullLabels, axisLabels, encodeRun, tooltip, onSelect, onBrush } = options;
  if (!(xRange.min < xRange.max && yRange.min < yRange.max)) throw new Error("Invalid scatterplot axis range");
  const showTitles = options.showAxisTitles !== false;
  const tickLabels = options.showTickLabels ?? { x: true, y: true };
  const px = (v) => LEFT + (v - xRange.min) / (xRange.max - xRange.min) * (W - LEFT - RIGHT);
  const py = (v) => H - BOTTOM - (v - yRange.min) / (yRange.max - yRange.min) * (H - TOP - BOTTOM);
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `${axisLabels[xKey]} vs. ${axisLabels[yKey]} pairwise scatterplot`);
  let html = `<rect class="plot-frame" x="${LEFT}" y="${TOP}" width="${W - LEFT - RIGHT}" height="${H - TOP - BOTTOM}" fill="#ffffff"/>`;
  const xTicks = niceTicks(xRange.min, xRange.max);
  const yTicks = niceTicks(yRange.min, yRange.max);
  for (const value of xTicks) {
    const x = px(value);
    html += `<line class="grid" x1="${x}" y1="${TOP}" x2="${x}" y2="${H - BOTTOM}"/>`;
    html += `<line class="axis" x1="${x}" y1="${H - BOTTOM}" x2="${x}" y2="${H - BOTTOM + 5}"/>`;
    if (tickLabels.x) html += `<text class="tick" x="${x}" y="${H - BOTTOM + 18}" text-anchor="middle">${xml(formatTick(value))}</text>`;
  }
  for (const value of yTicks) {
    const y = py(value);
    html += `<line class="grid" x1="${LEFT}" y1="${y}" x2="${W - RIGHT}" y2="${y}"/>`;
    html += `<line class="axis" x1="${LEFT - 5}" y1="${y}" x2="${LEFT}" y2="${y}"/>`;
    if (tickLabels.y) html += `<text class="tick" x="${LEFT - 8}" y="${y + 4}" text-anchor="end">${xml(formatTick(value))}</text>`;
  }
  html += `<line class="axis" x1="${LEFT}" y1="${H - BOTTOM}" x2="${W - RIGHT}" y2="${H - BOTTOM}"/><line class="axis" x1="${LEFT}" y1="${TOP}" x2="${LEFT}" y2="${H - BOTTOM}"/>`;
  if (showTitles) {
    html += `<text class="axis-label" x="${(LEFT + W - RIGHT) / 2}" y="${H - 12}" text-anchor="middle">${xml(axisLabels[xKey])}</text>`;
    html += `<text class="axis-label" transform="translate(16 ${(TOP + H - BOTTOM) / 2}) rotate(-90)" text-anchor="middle">${xml(axisLabels[yKey])}</text>`;
  }
  const bins = options.overviewRuns ? binPairs(options.overviewRuns, xKey, yKey, xRange, yRange) : [];
  const maxCount = Math.max(0, ...bins.map(bin => bin.count));
  for (const [index, bin] of bins.entries()) {
    const cw = (W - LEFT - RIGHT) / 20, ch = (H - TOP - BOTTOM) / 20;
    const shade = Math.log1p(bin.count) / Math.log1p(maxCount);
    const fill = countFill(shade);
    const tip = `AGGREGATE: ${bin.count} runs in this 2D bin. Click to filter source runs; not a single run or Pareto result.`;
    html += `<rect class="pair-density-bin" data-bin-index="${index}" data-count="${bin.count}" x="${LEFT + bin.col * cw}" y="${H - BOTTOM - (bin.row + 1) * ch}" width="${cw}" height="${ch}" fill="${fill}" tabindex="0" role="button" aria-label="${xml(tip)}"><title>${xml(tip)}</title></rect>`;
  }
  if (options.overviewRuns) html += `<text class="tick" x="${LEFT}" y="16">${bins.length ? `Bin counts: 0–${maxCount}` : "No runs in range"}</text>`;
  const jet = options.jetCloud;
  let jetCount = 0;
  if (jet?.runs?.length && jet.max > jet.min) {
    const ordered = [...jet.runs].sort((a, b) => a[jet.key] - b[jet.key]);
    for (const run of ordered) {
      const x = px(run[xKey]), y = py(run[yKey]);
      if (x < LEFT || x > W - RIGHT || y < TOP || y > H - BOTTOM) continue;
      const shade = (run[jet.key] - jet.min) / (jet.max - jet.min);
      const tip = `${jet.label}: ${run[jet.key]}`;
      html += `<circle class="jet-point" data-jet-id="${xml(run.run_id)}" cx="${x}" cy="${y}" r="4.2" fill="${jetColor(shade)}" fill-opacity="0.82" tabindex="0" role="button" aria-label="${xml(tip)}"><title>${xml(tip)}</title></circle>`;
      jetCount += 1;
    }
  }
  const plotted = (options.brushRuns ?? runs).map(run => ({ id: run.run_id, x: px(run[xKey]), y: py(run[yKey]) }))
    .filter(p => p.x >= LEFT && p.x <= W - RIGHT && p.y >= TOP && p.y <= H - BOTTOM);
  for (const run of runs) {
    const x = px(run[xKey]), y = py(run[yKey]);
    if (x < LEFT || x > W - RIGHT || y < TOP || y > H - BOTTOM) continue;
    const projected = projectedLabels?.get(run.run_id)?.nonDominated;
    const full = fullLabels?.get(run.run_id)?.nonDominated;
    if (full) html += `<circle cx="${x}" cy="${y}" r="7.5" fill="none" stroke="${MARK_RING_3D}" stroke-width="1.25" stroke-dasharray="3 2"/>`;
    if (selectedRunIds.includes(run.run_id)) html += `<circle cx="${x}" cy="${y}" r="9.5" fill="none" stroke="${MARK_RING_COMPARISON}" stroke-width="1.5"/>`;
    const { index, color } = encodeRun(run);
    const tip = tooltip(run, projected, full);
    const label = selectedRunIds.includes(run.run_id) ? `<text class="run-id-label" x="${x + 8}" y="${y - 8}">${xml(run.run_id)}</text>` : "";
    const stroke = projected ? MARK_STROKE_2D : color;
    html += `<g class="run-point" data-run-id="${xml(run.run_id)}" tabindex="0" role="button" aria-label="${xml(tip.replaceAll("\n", "; "))}"><circle cx="${x}" cy="${y}" r="8" fill="transparent"/>${scatterMarker(index, x, y, color, stroke)}<title>${xml(tip)}</title>${label}</g>`;
  }
  if (!runs.length && !bins.length && !jetCount) html += `<text class="empty" x="${W / 2}" y="${H / 2}" text-anchor="middle">${xml(options.emptyLabel ?? "No matching runs; enable configurations or use Show all")}</text>`;
  if (onBrush) html += `<rect class="brush" visibility="hidden" x="0" y="0" width="0" height="0"/>`;
  svg.innerHTML = html;
  svg.querySelectorAll("[data-jet-id]").forEach((element) => {
    element.addEventListener("click", (event) => { event.stopPropagation?.(); onSelect(element.dataset.jetId, event.shiftKey); });
    element.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(element.dataset.jetId, event.shiftKey); }
    });
  });
  svg.querySelectorAll("[data-run-id]").forEach((element) => {
    element.addEventListener("click", (event) => onSelect(element.dataset.runId, event.shiftKey));
    element.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(element.dataset.runId, event.shiftKey); }
    });
  });
  const wasDragged = onBrush ? attachBrush(svg, plotted, onBrush, options.onBackgroundClick) : () => false;
  if (!onBrush && options.onBackgroundClick) {
    svg.addEventListener("click", (event) => {
      if (event.target?.closest?.("[data-run-id]") || event.target?.closest?.("[data-bin-index]") || event.target?.closest?.("[data-jet-id]")) return;
      options.onBackgroundClick();
    });
  }
  if (options.overviewRuns) svg.querySelectorAll("[data-bin-index]").forEach(element => {
    const choose = () => options.onBin?.(bins[Number(element.dataset.binIndex)].runIds);
    element.addEventListener("click", (event) => { event.stopPropagation?.(); if (!wasDragged()) choose(); });
    element.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); choose(); } });
  });
}

const JET_STOPS = [[0, [0, 0, 139]], [0.15, [0, 0, 255]], [0.35, [0, 255, 255]], [0.5, [0, 255, 0]], [0.65, [255, 255, 0]], [0.85, [255, 0, 0]], [1, [128, 0, 0]]];

export function jetColor(shade) {
  const t = Math.max(0, Math.min(1, shade));
  let upper = JET_STOPS[JET_STOPS.length - 1];
  let lower = JET_STOPS[0];
  for (let index = 1; index < JET_STOPS.length; index += 1) {
    if (t <= JET_STOPS[index][0]) { upper = JET_STOPS[index]; lower = JET_STOPS[index - 1]; break; }
  }
  const span = upper[0] - lower[0] || 1;
  const mix = (t - lower[0]) / span;
  const rgb = lower[1].map((channel, offset) => Math.round(channel + (upper[1][offset] - channel) * mix));
  return `rgb(${rgb.join(",")})`;
}

function hslToRgb(h, s, l) {
  const hue = ((h % 360) + 360) % 360;
  const sat = s / 100;
  const light = l / 100;
  const chroma = (1 - Math.abs(2 * light - 1)) * sat;
  const x = chroma * (1 - Math.abs((hue / 60) % 2 - 1));
  const m = light - chroma / 2;
  const sector = Math.floor(hue / 60);
  const rgb = [[chroma, x, 0], [x, chroma, 0], [0, chroma, x], [0, x, chroma], [x, 0, chroma], [chroma, 0, x]][sector];
  return rgb.map((channel) => Math.round((channel + m) * 255));
}

export function countFill(shade) {
  const t = Math.max(0, Math.min(1, shade));
  const hue = t < 0.42 ? 50 - (t / 0.42) * 14 : 214 + ((t - 0.42) / 0.58) * 58;
  const sat = t < 0.42 ? 98 : 84;
  const light = t < 0.42 ? 56 - (t / 0.42) * 4 : 50 - ((t - 0.42) / 0.58) * 20;
  return `rgb(${hslToRgb(hue, sat, light).join(",")})`;
}

function attachBrush(svg, plotted, onBrush, onBackgroundClick) {
  let start = null;
  let lastDragged = false;
  let startedOnBin = false;
  const brush = svg.querySelector(".brush");
  const point = (event) => { const rect = svg.getBoundingClientRect(); return { x: (event.clientX - rect.left) * W / rect.width, y: (event.clientY - rect.top) * H / rect.height }; };
  svg.addEventListener("pointerdown", (event) => {
    if (event.target.closest("[data-run-id]")) return;
    lastDragged = false;
    startedOnBin = Boolean(event.target.closest("[data-bin-index]"));
    start = point(event);
    if (!startedOnBin) svg.setPointerCapture(event.pointerId);
  });
  svg.addEventListener("pointermove", (event) => {
    if (!start) return;
    const end = point(event);
    if (startedOnBin && (Math.abs(start.x - end.x) > 5 || Math.abs(start.y - end.y) > 5)) svg.setPointerCapture(event.pointerId);
    brush.setAttribute("x", Math.min(start.x, end.x));
    brush.setAttribute("y", Math.min(start.y, end.y));
    brush.setAttribute("width", Math.abs(start.x - end.x));
    brush.setAttribute("height", Math.abs(start.y - end.y));
    brush.setAttribute("visibility", "visible");
  });
  svg.addEventListener("pointerup", (event) => {
    if (!start) return;
    const end = point(event), x0 = Math.min(start.x, end.x), x1 = Math.max(start.x, end.x), y0 = Math.min(start.y, end.y), y1 = Math.max(start.y, end.y);
    const dragged = Math.abs(start.x - end.x) > 5 || Math.abs(start.y - end.y) > 5;
    lastDragged = dragged;
    start = null;
    brush.setAttribute("visibility", "hidden");
    if (dragged) onBrush(plotted.filter((p) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1).map((p) => p.id), event.shiftKey);
    else if (!startedOnBin) onBackgroundClick?.();
  });
  svg.addEventListener("pointercancel", () => { start = null; brush.setAttribute("visibility", "hidden"); });
  return () => lastDragged;
}
