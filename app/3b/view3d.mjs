import { POLICY_COLORS, POLICY_SHAPES, stableConfigIndex } from "../shared/encoding.mjs";

export const VIEW3D = {
  width: 720,
  height: 480,
  originX: 110,
  originY: 400,
  scaleX: 380,
  scaleY: 250,
  depth: 0.55,
  angle: Math.PI / 6,
};

export const OVERLAP_PX = 14;

const AXIS_LABELS = {
  makespan_s: "M (s) ↓",
  energy_j: "E (J) ↓",
  mean_latency_s: "L (s) ↓",
};

function element(tag, className) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  if (className) node.setAttribute("class", className);
  return node;
}

export function projectNormalized(m, e, l) {
  const { originX, originY, scaleX, scaleY, depth, angle } = VIEW3D;
  return {
    x: originX + scaleX * (m + depth * l * Math.cos(angle)),
    y: originY - scaleY * (e + depth * l * Math.sin(angle)),
  };
}

export function projectRun(run, ranges) {
  const norm = (key) => {
    const span = ranges[key].max - ranges[key].min;
    return span === 0 ? 0 : (run[key] - ranges[key].min) / span;
  };
  return projectNormalized(norm("makespan_s"), norm("energy_j"), norm("mean_latency_s"));
}

function visibleRuns(model, snapshot) {
  return model.runs.filter((run) =>
    run.instance_id === snapshot.current_instance_id &&
    run.status === "complete" &&
    snapshot.visible_policy_config_ids.includes(run.policy_config_id));
}

function formatRaw(value) {
  return Number.isFinite(value) ? String(value) : "—";
}

function distance(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

export function coincidentIds(runs, ranges, runId) {
  const placed = runs.map((run) => ({ run, point: projectRun(run, ranges) }));
  const target = placed.find((item) => item.run.run_id === runId);
  if (!target) return [];
  return placed
    .filter((item) => distance(item.point, target.point) <= OVERLAP_PX)
    .map((item) => item.run.run_id)
    .sort();
}

export function mountView3d(container, model, sharedState) {
  if (!container) throw new Error("3D container is required");
  const render = (snapshot) => {
    const { width, height } = VIEW3D;
    const svg = element("svg");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "固定斜投影的三维参考视图：M、E、L 均最小化，不能旋转。");
    const runs = visibleRuns(model, snapshot);
    const axes = [
      ["makespan_s", projectNormalized(1, 0, 0)],
      ["energy_j", projectNormalized(0, 1, 0)],
      ["mean_latency_s", projectNormalized(0, 0, 1)],
    ];
    const origin = projectNormalized(0, 0, 0);
    for (const [key, end] of axes) {
      const line = element("line", "view3d-axis");
      line.setAttribute("x1", origin.x);
      line.setAttribute("y1", origin.y);
      line.setAttribute("x2", end.x);
      line.setAttribute("y2", end.y);
      const label = element("text", "view3d-axis-label");
      label.setAttribute("x", end.x + (key === "energy_j" ? -8 : 8));
      label.setAttribute("y", end.y + (key === "energy_j" ? -6 : 16));
      label.setAttribute("text-anchor", key === "energy_j" ? "end" : "start");
      label.textContent = AXIS_LABELS[key];
      svg.append(line, label);
    }
    const placed = runs.map((run) => ({ run, point: projectRun(run, snapshot.axis_ranges) }));
    for (const { run, point } of placed) {
      const slot = stableConfigIndex(model.configs, run.policy_config_id);
      const color = POLICY_COLORS[slot % POLICY_COLORS.length];
      const selected = snapshot.selected_run_ids.includes(run.run_id);
      const full = model.labels.full.get(run.run_id)?.nonDominated;
      const cluster = coincidentIds(runs, snapshot.axis_ranges, run.run_id);
      const config = model.configs.find((item) => item.policy_config_id === run.policy_config_id);
      const group = element("g", selected ? "view3d-point selected" : "view3d-point");
      group.dataset.runId = run.run_id;
      group.dataset.selected = selected ? "true" : "false";
      group.dataset.x = String(point.x);
      group.dataset.y = String(point.y);
      group.dataset.coincident = cluster.join("|");
      group.dataset.fullNonDominated = full ? "true" : "false";
      group.setAttribute("tabindex", "0");
      group.setAttribute("role", "button");
      const title = element("title");
      const overlap = cluster.length > 1 ? `\n同一投影位置：${cluster.join("，")}` : "";
      title.textContent = `${config?.label ?? run.policy_config_id} | ${run.run_id}\n`
        + `M=${formatRaw(run.makespan_s)} s, E=${formatRaw(run.energy_j)} J, L=${formatRaw(run.mean_latency_s)} s`
        + `${full ? "\n三维：非支配" : "\n三维：被支配"}${overlap}`;
      if (full) {
        const halo = element("circle", "view3d-full");
        halo.setAttribute("cx", point.x);
        halo.setAttribute("cy", point.y);
        halo.setAttribute("r", "16");
        group.append(halo);
      }
      if (selected) {
        const ring = element("circle", "view3d-selected");
        ring.setAttribute("cx", point.x);
        ring.setAttribute("cy", point.y);
        ring.setAttribute("r", "18");
        group.append(ring);
      }
      const mark = element("circle", "view3d-mark");
      mark.setAttribute("cx", point.x);
      mark.setAttribute("cy", point.y);
      mark.setAttribute("r", "8");
      mark.setAttribute("fill", color);
      const glyph = element("text", "view3d-shape");
      glyph.setAttribute("x", point.x + 10);
      glyph.setAttribute("y", point.y - 10);
      glyph.textContent = POLICY_SHAPES[slot % POLICY_SHAPES.length];
      group.append(title, mark, glyph);
      const choose = (shift) => {
        const ids = shift ? [...sharedState.get().selected_run_ids, ...cluster] : cluster;
        sharedState.selectRuns(ids);
      };
      group.addEventListener("click", (event) => choose(event.shiftKey));
      group.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          choose(event.shiftKey);
        }
      });
      svg.append(group);
    }
    if (!runs.length) {
      const empty = element("text", "view3d-empty");
      empty.setAttribute("x", String(width / 2));
      empty.setAttribute("y", String(height / 2));
      empty.setAttribute("text-anchor", "middle");
      empty.textContent = "当前筛选下没有可见的完整运行";
      svg.append(empty);
    }
    container.replaceChildren(svg);
  };
  return sharedState.subscribe(render);
}
