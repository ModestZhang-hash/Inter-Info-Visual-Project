import { configLabel } from "../shared/labels.mjs";
import { filteredRuns, comparisonRuns } from "../shared/state.mjs?v=splom-1";
import { drawPairScatter, scatterMarker, PAIR_LAYOUT } from "../shared/pair_scatter.mjs?v=ink-9";
import { formatTick, niceTicks } from "../shared/axis_ticks.mjs";
import { POLICY_COLORS, stableConfigIndex } from "../shared/encoding.mjs?v=ink-1";
import { OBJECTIVES, PAIRS } from "../3a/pareto.mjs";

const DENSITY_ABOVE = 10;
const OVERLAY_LIMIT = 10;
const AXIS_NAME = {
  makespan_s: "Makespan M (s)",
  energy_j: "Task-related energy E (J)",
  mean_latency_s: "Mean end-to-end latency L (s)",
};
const SHORT = { makespan_s: "M", energy_j: "E", mean_latency_s: "L" };
const HIST_LOW = [213, 224, 238];
const HIST_HIGH = [30, 77, 123];

function histFill(shade) {
  const t = Math.max(0, Math.min(1, shade));
  const rgb = HIST_LOW.map((channel, index) => Math.round(channel + (HIST_HIGH[index] - channel) * t));
  return `rgb(${rgb.join(",")})`;
}
const axisLabels = Object.fromEntries(OBJECTIVES.map((key) => [key, AXIS_NAME[key]]));

function pairFor(xKey, yKey) {
  const pair = PAIRS.find(([a, b]) => (a === xKey && b === yKey) || (a === yKey && b === xKey));
  if (!pair) throw new Error(`No canonical pair for ${xKey} and ${yKey}`);
  return pair;
}

function visibleRuns(model, snapshot) {
  if (snapshot.filtered_run_ids) return filteredRuns(model, snapshot);
  return model.runs.filter((run) =>
    run.instance_id === snapshot.current_instance_id &&
    run.status === "complete" &&
    snapshot.visible_policy_config_ids.includes(run.policy_config_id));
}

function choose(sharedState, ids, shift) {
  const current = shift ? sharedState.get().selected_run_ids : [];
  sharedState.selectRuns([...current, ...ids]);
}

function element(tag, className) {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function histogramCell(key, runs, range) {
  const cell = element("article", "matrix-diagonal");
  cell.dataset.role = "diagonal";
  cell.dataset.x = key;
  cell.dataset.y = key;
  const bins = 12;
  const counts = Array.from({ length: bins }, () => 0);
  const span = range.max - range.min;
  for (const run of runs) {
    const value = run[key];
    if (!Number.isFinite(value) || value < range.min || value > range.max || !(span > 0)) continue;
    const index = Math.min(bins - 1, Math.floor((value - range.min) / span * bins));
    counts[index] += 1;
  }
  const { width: W, height: H, left: LEFT, right: RIGHT, top: TOP, bottom: BOTTOM } = PAIR_LAYOUT;
  const plotW = W - LEFT - RIGHT;
  const plotH = H - TOP - BOTTOM;
  const maxCount = Math.max(1, ...counts);
  const yTicks = niceTicks(0, maxCount, 3);
  const yMax = Math.max(maxCount, ...yTicks, 1);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `${AXIS_NAME[key]} marginal distribution, ${runs.length} complete runs`);
  const px = (value) => LEFT + (value - range.min) / span * plotW;
  const py = (count) => H - BOTTOM - count / yMax * plotH;
  let html = `<rect class="plot-frame" x="${LEFT}" y="${TOP}" width="${plotW}" height="${plotH}" fill="#ffffff"/>`;
  html += `<text class="hist-name" x="${LEFT}" y="16">${SHORT[key]} · n=${runs.length}</text>`;
  counts.forEach((count, index) => {
    if (!count) return;
    const x = LEFT + index / bins * plotW;
    const y = py(count);
    const barW = plotW / bins - 1;
    const fill = histFill(Math.log1p(count) / Math.log1p(maxCount));
    html += `<rect class="hist-bar" x="${x + 0.5}" y="${y}" width="${Math.max(barW, 0)}" height="${H - BOTTOM - y}" style="fill:${fill}"></rect>`;
  });
  for (const value of niceTicks(range.min, range.max)) {
    const x = px(value);
    html += `<line class="axis" x1="${x}" y1="${H - BOTTOM}" x2="${x}" y2="${H - BOTTOM + 5}"/>`;
    if (key === OBJECTIVES[2]) html += `<text class="tick" x="${x}" y="${H - BOTTOM + 18}" text-anchor="middle">${formatTick(value)}</text>`;
  }
  for (const value of yTicks) {
    const y = py(value);
    html += `<line class="axis" x1="${LEFT - 5}" y1="${y}" x2="${LEFT}" y2="${y}"/>`;
    html += `<text class="tick" x="${LEFT - 8}" y="${y + 4}" text-anchor="end">${formatTick(value)}</text>`;
  }
  html += `<line class="axis" x1="${LEFT}" y1="${H - BOTTOM}" x2="${W - RIGHT}" y2="${H - BOTTOM}"/><line class="axis" x1="${LEFT}" y1="${TOP}" x2="${LEFT}" y2="${H - BOTTOM}"/>`;
  html += `<text class="axis-label" transform="translate(16 ${(TOP + H - BOTTOM) / 2}) rotate(-90)" text-anchor="middle">Count</text>`;
  svg.innerHTML = html;
  cell.append(svg);
  return cell;
}

function emptyCell(xKey, yKey) {
  const pair = pairFor(xKey, yKey);
  const cell = element("div", "matrix-empty");
  cell.dataset.role = "empty";
  cell.dataset.x = xKey;
  cell.dataset.y = yKey;
  cell.dataset.pair = pair.join("|");
  cell.dataset.orientation = "reverse";
  cell.setAttribute("aria-hidden", "true");
  return cell;
}

function scatterCell(model, sharedState, snapshot, xKey, yKey, { onExpand, focused = false } = {}) {
  const pair = pairFor(xKey, yKey);
  const cell = element("article", "matrix-cell");
  cell.dataset.role = "scatter";
  cell.dataset.x = xKey;
  cell.dataset.y = yKey;
  cell.dataset.pair = pair.join("|");
  cell.dataset.orientation = "canonical";
  const candidates = visibleRuns(model, snapshot);
  const comparing = sharedState.filterRuns ? comparisonRuns(model, snapshot) : [];
  const workflow = Boolean(sharedState.filterRuns);
  const dense = workflow && candidates.length > DENSITY_ABOVE;
  const pooled = dense ? comparing : [...new Map([...candidates, ...comparing].map((run) => [run.run_id, run])).values()];
  const tooMany = workflow && pooled.length > OVERLAY_LIMIT;
  const displayed = tooMany ? [] : pooled;
  const binRuns = tooMany ? (dense ? candidates : pooled) : dense ? candidates : undefined;
  const colorKey = OBJECTIVES.find((key) => key !== xKey && key !== yKey);
  const cloudValues = (binRuns ?? []).map((run) => run[colorKey]).filter(Number.isFinite);
  const jetMin = cloudValues.length ? Math.min(...cloudValues) : 0;
  const jetMax = cloudValues.length ? Math.max(...cloudValues) : 0;
  cell.dataset.density = binRuns ? "jet" : "points";
  cell.dataset.overlay = tooMany ? "counts" : "marks";
  if (focused) {
    const caption = element("h3", "cell-caption");
    caption.textContent = `${SHORT[xKey]}–${SHORT[yKey]}`;
    const note = element("p", "cell-note");
    note.textContent = binRuns
      ? `Each dot is one run. Color is ${AXIS_NAME[colorKey]}: blue is lower, red is higher.`
      : "One point, one complete run. Both axes are minimized.";
    cell.append(caption, note);
  } else if (onExpand) {
    const expand = element("button", "expand-cell");
    expand.type = "button";
    expand.textContent = "Expand";
    expand.setAttribute("aria-label", `Expand ${SHORT[xKey]}–${SHORT[yKey]}`);
    expand.addEventListener("click", () => onExpand(xKey, yKey));
    cell.append(expand);
  }
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  cell.append(svg);
  drawPairScatter(svg, {
    runs: displayed,
    brushRuns: displayed,
    overviewRuns: undefined,
    jetCloud: binRuns && jetMax > jetMin ? { runs: binRuns, key: colorKey, label: SHORT[colorKey], min: jetMin, max: jetMax } : undefined,
    xKey,
    yKey,
    xRange: snapshot.axis_ranges[xKey],
    yRange: snapshot.axis_ranges[yKey],
    selectedRunIds: snapshot.selected_run_ids,
    projectedLabels: model.labels.pairs.get(pair.join("|")),
    fullLabels: model.labels.full,
    axisLabels,
    showAxisTitles: focused,
    showTickLabels: { x: focused || yKey === OBJECTIVES[2], y: focused || xKey === OBJECTIVES[0] },
    encodeRun: (run) => {
      const index = stableConfigIndex(model.configs, run.policy_config_id);
      return { index, color: POLICY_COLORS[index % POLICY_COLORS.length] };
    },
    tooltip: (run, projected, full) => {
      const status = (value) => value === undefined ? "Not calculated" : value ? "Non-dominated" : "Dominated";
      return `${run.policy_config_id} | ${run.run_id}\n`
        + `M=${run.makespan_s} s, E=${run.energy_j} J, L=${run.mean_latency_s} s\n`
        + `2D: ${status(projected)}; 3D: ${status(full)}`;
    },
    onSelect: (id, shift) => workflow ? sharedState.toggleComparison(id) : choose(sharedState, [id], shift),
    onBrush: workflow ? undefined : (ids, shift) => choose(sharedState, ids, shift),
    onBackgroundClick: !focused && onExpand ? () => onExpand(xKey, yKey) : undefined,
    onBin: undefined,
    formatValue: formatTick,
    emptyLabel: "No matching runs in this range",
  });
  if (binRuns && jetMax > jetMin) {
    cell.dataset.scale = "jet";
    cell.append(colorScale(colorKey, jetMin, jetMax));
  }
  if (!focused && xKey === OBJECTIVES[0]) {
    const yName = element("p", "row-axis");
    yName.textContent = AXIS_NAME[yKey];
    cell.append(yName);
  }
  return cell;
}

function colorScale(key, min, max) {
  const scale = element("div", "jet-scale");
  const hi = element("span", "jet-tick");
  hi.textContent = formatTick(max);
  const bar = element("div", "jet-bar");
  bar.setAttribute("role", "img");
  bar.setAttribute("aria-label", `${SHORT[key]} color scale, blue ${formatTick(min)} to red ${formatTick(max)}`);
  const lo = element("span", "jet-tick");
  lo.textContent = formatTick(min);
  const name = element("span", "jet-name");
  name.textContent = SHORT[key];
  scale.append(hi, bar, lo, name);
  return scale;
}

function legend(model) {
  const row = element("div", "matrix-legend");
  row.setAttribute("aria-label", "Scatterplot matrix legend");
  for (const config of model.configs) {
    const index = stableConfigIndex(model.configs, config.policy_config_id);
    const item = element("span", "legend-item");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("width", "16");
    svg.setAttribute("height", "16");
    svg.setAttribute("aria-hidden", "true");
    const color = POLICY_COLORS[index % POLICY_COLORS.length];
    svg.innerHTML = scatterMarker(index, 8, 8, color, color);
    const name = element("span", "");
    name.textContent = configLabel(model, config);
    item.append(svg, name);
    row.append(item);
  }
  const status = element("span", "legend-status");
  status.innerHTML = `<i class="mark projected"></i> Dark outline: non-dominated on this pair <i class="mark full"></i> Dashed ring: non-dominated in M–E–L <i class="mark selected"></i> Solid ring: in comparison. On a large scatter, point color is the objective that is not on the axes: blue is lower, red is higher.`;
  row.append(status);
  return row;
}

export function renderFocusedPair(container, model, sharedState, xKey, yKey) {
  container.replaceChildren(scatterCell(model, sharedState, sharedState.get(), xKey, yKey, { focused: true }));
}

export function mountMatrix(container, model, sharedState, { onExpand } = {}) {
  if (!container) throw new Error("Matrix container is required");
  const render = (snapshot) => {
    const frame = element("div", "splom");
    frame.dataset.role = "splom";
    const heads = element("div", "matrix-colheads");
    for (const key of OBJECTIVES) {
      const head = element("div", "matrix-colhead");
      head.textContent = AXIS_NAME[key];
      heads.append(head);
    }
    const grid = element("div", "matrix-grid");
    grid.dataset.role = "grid";
    grid.setAttribute("role", "group");
    grid.setAttribute("aria-label", "Lower-triangle scatterplot matrix. All objectives are minimized.");
    for (const yKey of OBJECTIVES) {
      for (const xKey of OBJECTIVES) {
        const yIndex = OBJECTIVES.indexOf(yKey);
        const xIndex = OBJECTIVES.indexOf(xKey);
        if (xKey === yKey) grid.append(histogramCell(xKey, visibleRuns(model, snapshot), snapshot.axis_ranges[xKey]));
        else if (yIndex > xIndex) grid.append(scatterCell(model, sharedState, snapshot, xKey, yKey, { onExpand }));
        else grid.append(emptyCell(xKey, yKey));
      }
    }
    const note = element("p", "matrix-caption");
    const comparingCount = snapshot.comparison_run_ids?.length ?? snapshot.selected_run_ids.length;
    const dense = Boolean(sharedState.filterRuns) && visibleRuns(model, snapshot).length > DENSITY_ABOVE;
    note.textContent = dense && comparingCount > OVERLAY_LIMIT
      ? `${comparingCount} comparison runs stay in the list. Count bins stay on the matrix so the marks do not cover them. Select at most ${OVERLAY_LIMIT} runs to draw individual marks.`
      : "All three objectives are minimized. The same variable shares one range down a column and across a row.";
    frame.append(heads, grid, note, legend(model));
    container.replaceChildren(frame);
  };
  return sharedState.subscribe(render);
}
