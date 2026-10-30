import { drawPairScatter } from "../shared/pair_scatter.mjs";
import { POLICY_COLORS, stableConfigIndex } from "../shared/encoding.mjs";
import { OBJECTIVES, PAIRS } from "../3a/pareto.mjs";

const META = {
  makespan_s: { short: "M", label: "总完成时间 M (s) ↓" },
  energy_j: { short: "E", label: "任务相关能耗 E (J) ↓" },
  mean_latency_s: { short: "L", label: "平均端到端延迟 L (s) ↓" },
};

const axisLabels = Object.fromEntries(OBJECTIVES.map((key) => [key, META[key].label]));

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

function diagonalCell(key) {
  const cell = element("div", "matrix-diagonal");
  cell.dataset.role = "diagonal";
  cell.dataset.x = key;
  cell.dataset.y = key;
  const short = element("p", "diag-short");
  short.textContent = META[key].short;
  const label = element("p", "diag-label");
  label.textContent = META[key].label;
  cell.append(short, label);
  return cell;
}

function scatterCell(model, sharedState, snapshot, xKey, yKey) {
  const pair = pairFor(xKey, yKey);
  const canonical = xKey === pair[0] && yKey === pair[1];
  const pairName = pair.map((key) => META[key].short).join("–");
  const cell = element("article", "matrix-cell");
  cell.dataset.role = "scatter";
  cell.dataset.x = xKey;
  cell.dataset.y = yKey;
  cell.dataset.pair = pair.join("|");
  cell.dataset.orientation = canonical ? "canonical" : "reverse";
  const caption = element("h3", "cell-caption");
  caption.textContent = `横轴 ${META[xKey].short} · 纵轴 ${META[yKey].short}`;
  const note = element("p", "cell-note");
  note.textContent = canonical
    ? `与 3A 的 ${pairName} 使用同一组二维标签`
    : `反向轴 · 与 ${pairName} 使用同一组二维标签`;
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
    axisLabels,
    encodeRun: (run) => {
      const index = stableConfigIndex(model.configs, run.policy_config_id);
      return { index, color: POLICY_COLORS[index % POLICY_COLORS.length] };
    },
    tooltip: (run, projected, full) => {
      const status = (value) => value === undefined ? "未计算" : value ? "非支配" : "被支配";
      const config = model.configs.find((item) => item.policy_config_id === run.policy_config_id);
      return `${config?.label ?? run.policy_config_id} | ${run.run_id}\n`
        + `M=${run.makespan_s} s, E=${run.energy_j} J, L=${run.mean_latency_s} s\n`
        + `二维：${status(projected)}；三维：${status(full)}`;
    },
    onSelect: (id, shift) => choose(sharedState, [id], shift),
    onBrush: (ids, shift) => choose(sharedState, ids, shift),
    formatValue: (value) => Number(value.toPrecision(7)).toString(),
  });
  return cell;
}

export function mountMatrix(container, model, sharedState) {
  if (!container) throw new Error("Matrix container is required");
  const render = (snapshot) => {
    const grid = element("div", "matrix-grid");
    grid.setAttribute("role", "group");
    grid.setAttribute("aria-label", "散点图矩阵");
    for (const yKey of OBJECTIVES) {
      for (const xKey of OBJECTIVES) {
        grid.append(xKey === yKey ? diagonalCell(xKey) : scatterCell(model, sharedState, snapshot, xKey, yKey));
      }
    }
    container.replaceChildren(grid);
  };
  return sharedState.subscribe(render);
}
