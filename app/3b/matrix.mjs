import { drawPairScatter } from "../shared/pair_scatter.mjs";
import { POLICY_COLORS, stableConfigIndex } from "../shared/encoding.mjs";
import { OBJECTIVES, PAIRS } from "../3a/pareto.mjs";
import { text } from "../shared/copy.mjs";

function pairFor(xKey, yKey) {
  const pair = PAIRS.find(([a, b]) => (a === xKey && b === yKey) || (a === yKey && b === xKey));
  if (!pair) throw new Error(`No canonical pair for ${xKey} and ${yKey}`);
  return pair;
}

function visibleRuns(model, snapshot) {
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

function diagonalCell(key, copy) {
  const cell = element("div", "matrix-diagonal");
  cell.dataset.role = "diagonal";
  cell.dataset.x = key;
  cell.dataset.y = key;
  const short = element("p", "diag-short");
  short.textContent = copy.axes[key].short;
  const label = element("p", "diag-label");
  label.textContent = copy.axes[key].label;
  cell.append(short, label);
  return cell;
}

function scatterCell(model, sharedState, snapshot, xKey, yKey, copy) {
  const pair = pairFor(xKey, yKey);
  const canonical = xKey === pair[0] && yKey === pair[1];
  const pairName = pair.map((key) => copy.axes[key].short).join("–");
  const cell = element("article", "matrix-cell");
  cell.dataset.role = "scatter";
  cell.dataset.x = xKey;
  cell.dataset.y = yKey;
  cell.dataset.pair = pair.join("|");
  cell.dataset.orientation = canonical ? "canonical" : "reverse";
  const caption = element("h3", "cell-caption");
  caption.textContent = `${copy.horizontal} ${copy.axes[xKey].short} · ${copy.vertical} ${copy.axes[yKey].short}`;
  const note = element("p", "cell-note");
  note.textContent = canonical ? copy.samePair(pairName) : copy.reversePair(pairName);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  cell.append(caption, note, svg);
  drawPairScatter(svg, {
    runs: visibleRuns(model, snapshot),
    xKey,
    yKey,
    xRange: snapshot.axis_ranges[xKey],
    yRange: snapshot.axis_ranges[yKey],
    selectedRunIds: snapshot.selected_run_ids,
    projectedLabels: model.labels.pairs.get(pair.join("|")),
    fullLabels: model.labels.full,
    axisLabels: Object.fromEntries(OBJECTIVES.map((key) => [key, copy.axes[key].label])),
    encodeRun: (run) => {
      const index = stableConfigIndex(model.configs, run.policy_config_id);
      return { index, color: POLICY_COLORS[index % POLICY_COLORS.length] };
    },
    tooltip: (run, projected, full) => {
      const config = model.configs.find((item) => item.policy_config_id === run.policy_config_id);
      return `${copy.displayName(config?.label, run.policy_config_id)} | ${run.run_id}\n`
        + `M=${run.makespan_s} s, E=${run.energy_j} J, L=${run.mean_latency_s} s\n`
        + copy.dominanceLine(projected, full, copy.status);
    },
    onSelect: (id, shift) => choose(sharedState, [id], shift),
    onBrush: (ids, shift) => choose(sharedState, ids, shift),
    formatValue: (value) => Number(value.toPrecision(7)).toString(),
    emptyLabel: copy.emptyPlot,
  });
  return cell;
}

export function mountMatrix(container, model, sharedState, options = {}) {
  if (!container) throw new Error("Matrix container is required");
  const copy = text(options.lang);
  const render = (snapshot) => {
    const grid = element("div", "matrix-grid");
    grid.setAttribute("role", "group");
    grid.setAttribute("aria-label", copy.matrixLabel);
    for (const yKey of OBJECTIVES) {
      for (const xKey of OBJECTIVES) {
        grid.append(xKey === yKey ? diagonalCell(xKey, copy) : scatterCell(model, sharedState, snapshot, xKey, yKey, copy));
      }
    }
    container.replaceChildren(grid);
  };
  return sharedState.subscribe(render);
}

