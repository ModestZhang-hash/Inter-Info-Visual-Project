import { runLabel } from "../shared/labels.mjs";
import { comparisonRuns } from "../shared/state.mjs?v=workflow-1";
import { POLICY_COLORS, POLICY_SHAPES, stableConfigIndex } from "../shared/encoding.mjs?v=ink-1";
import { jetColor } from "../shared/pair_scatter.mjs?v=ink-9";
import { formatTick, niceStep, niceTicks } from "../shared/axis_ticks.mjs";

export const VIEW3D = {
  width: 720,
  height: 480,
};

export const OVERLAP_PX = 14;
export const DEFAULT_CAMERA = Object.freeze({ yaw: 0.65, pitch: 0.4, zoom: 1 });

export function constrainCamera(camera) {
  return { yaw: ((camera.yaw + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI,
    pitch: Math.max(-1.4, Math.min(1.4, camera.pitch)), zoom: Math.max(0.6, Math.min(1.6, camera.zoom)) };
}

const AXIS_LABELS = {
  makespan_s: "M (s) ↓",
  energy_j: "E (J) ↓",
  mean_latency_s: "L (s) ↓",
};
const AXIS_KEYS = ["makespan_s", "energy_j", "mean_latency_s"];

function scaleTicks(min, max) {
  if (!(max > min)) return [{ value: min, t: 0, end: true }];
  const step = niceStep(max - min, 3);
  const ticks = [{ value: min, t: 0, end: true }];
  for (const value of niceTicks(min, max, 3)) {
    if (value - min < step * 0.45 || max - value < step * 0.45) continue;
    ticks.push({ value, t: (value - min) / (max - min), end: false });
  }
  ticks.push({ value: max, t: 1, end: true });
  return ticks;
}

function formatReadout(value) {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 100) return value.toFixed(1);
  if (abs >= 10) return value.toFixed(2);
  return value.toFixed(3);
}

function unitNorm(value, range) {
  const span = range.max - range.min;
  if (!(span > 0)) return 0;
  return Math.min(1, Math.max(0, (value - range.min) / span));
}

// Closest face under an orthographic cursor. Larger depth is nearer the camera.
export function pointerOnBox(sx, sy, camera = DEFAULT_CAMERA) {
  const { yaw, pitch, zoom } = camera;
  const horizontal = (sx - VIEW3D.width / 2) / (260 * zoom);
  const vertical = (VIEW3D.height / 2 - sy) / (260 * zoom);
  const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
  const cosP = Math.cos(pitch), sinP = Math.sin(pitch);
  const hits = [];
  const consider = (x, y, z) => {
    if (Math.abs(x) > 0.501 || Math.abs(y) > 0.501 || Math.abs(z) > 0.501) return;
    hits.push({
      m: x + 0.5, e: y + 0.5, l: z + 0.5,
      depth: sinP * y + cosP * (-sinY * x + cosY * z),
    });
  };
  if (Math.abs(sinY) > 1e-3) {
    for (const x of [-0.5, 0.5]) {
      const z = (horizontal - cosY * x) / sinY;
      const depth = -sinY * x + cosY * z;
      const y = Math.abs(cosP) > 1e-3 ? (vertical + sinP * depth) / cosP : 0;
      consider(x, y, z);
    }
  }
  if (Math.abs(cosY) > 1e-3) {
    for (const z of [-0.5, 0.5]) {
      const x = (horizontal - sinY * z) / cosY;
      const depth = -sinY * x + cosY * z;
      const y = Math.abs(cosP) > 1e-3 ? (vertical + sinP * depth) / cosP : 0;
      consider(x, y, z);
    }
  }
  if (Math.abs(sinP) > 1e-3) {
    for (const y of [-0.5, 0.5]) {
      const depth = (cosP * y - vertical) / sinP;
      const x = cosY * horizontal - sinY * depth;
      const z = sinY * horizontal + cosY * depth;
      consider(x, y, z);
    }
  }
  hits.sort((a, b) => b.depth - a.depth);
  return hits[0] ?? null;
}

function element(tag, className) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  if (className) node.setAttribute("class", className);
  return node;
}

export function projectNormalized(m, e, l, camera = DEFAULT_CAMERA) {
  // Orthographic camera: rotate the normalized cube, never the stored metrics.
  const x = m - 0.5, y = e - 0.5, z = l - 0.5;
  const horizontal = Math.cos(camera.yaw) * x + Math.sin(camera.yaw) * z;
  const depth = -Math.sin(camera.yaw) * x + Math.cos(camera.yaw) * z;
  const vertical = Math.cos(camera.pitch) * y - Math.sin(camera.pitch) * depth;
  return {
    x: VIEW3D.width / 2 + 260 * camera.zoom * horizontal,
    y: VIEW3D.height / 2 - 260 * camera.zoom * vertical,
    depth: Math.sin(camera.pitch) * y + Math.cos(camera.pitch) * depth,
  };
}

export function projectRun(run, ranges, camera = DEFAULT_CAMERA) {
  const norm = (key) => {
    const span = ranges[key].max - ranges[key].min;
    return span === 0 ? 0 : (run[key] - ranges[key].min) / span;
  };
  return projectNormalized(norm("makespan_s"), norm("energy_j"), norm("mean_latency_s"), camera);
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

function appendJetScale(svg, range) {
  const grad = element("linearGradient");
  grad.setAttribute("id", "view3d-jet");
  grad.setAttribute("x1", "0");
  grad.setAttribute("y1", "1");
  grad.setAttribute("x2", "0");
  grad.setAttribute("y2", "0");
  for (const [offset, color] of [[0, jetColor(0)], [0.35, jetColor(0.35)], [0.5, jetColor(0.5)], [0.65, jetColor(0.65)], [1, jetColor(1)]]) {
    const stop = element("stop");
    stop.setAttribute("offset", String(offset));
    stop.setAttribute("stop-color", color);
    grad.append(stop);
  }
  const defs = element("defs");
  defs.append(grad);
  svg.append(defs);
  const bar = element("rect", "view3d-scale");
  bar.setAttribute("x", "674");
  bar.setAttribute("y", "48");
  bar.setAttribute("width", "14");
  bar.setAttribute("height", "180");
  bar.setAttribute("fill", "url(#view3d-jet)");
  svg.append(bar);
  const high = element("text", "view3d-tick");
  high.setAttribute("x", "668");
  high.setAttribute("y", "44");
  high.setAttribute("text-anchor", "end");
  high.textContent = Number(range.max.toPrecision(3));
  const low = element("text", "view3d-tick");
  low.setAttribute("x", "668");
  low.setAttribute("y", "240");
  low.setAttribute("text-anchor", "end");
  low.textContent = Number(range.min.toPrecision(3));
  const name = element("text", "view3d-axis-label");
  name.setAttribute("x", "681");
  name.setAttribute("y", "258");
  name.setAttribute("text-anchor", "middle");
  name.textContent = "E (J)";
  svg.append(high, low, name);
}

function distance(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

export function coincidentIds(runs, ranges, runId, camera = DEFAULT_CAMERA) {
  const placed = runs.map((run) => ({ run, point: projectRun(run, ranges, camera) }));
  const target = placed.find((item) => item.run.run_id === runId);
  if (!target) return [];
  return placed
    .filter((item) => distance(item.point, target.point) <= OVERLAP_PX)
    .map((item) => item.run.run_id)
    .sort();
}

export function mountView3d(container, model, sharedState) {
  if (!container) throw new Error("3D container is required");
  let camera = { ...DEFAULT_CAMERA }, snapshot = sharedState.get(), drag = null, suppressClick = false, disposed = false;
  let pointerTarget = null, pointerNode = null, placed = [], scene = null;
  const svg = element("svg");
  svg.setAttribute("viewBox", `0 0 ${VIEW3D.width} ${VIEW3D.height}`);
  svg.setAttribute("role", "group");
  svg.setAttribute("tabindex", "0");
  svg.setAttribute("aria-label", "Interactive 3D comparison. Drag to rotate; scroll to zoom. Move the pointer to read M, E and L. Arrow keys rotate, plus and minus zoom, Home resets. Click a point to toggle comparison.");
  const toolbar = document.createElement("div");
  toolbar.className = "view3d-toolbar";
  toolbar.setAttribute("role", "group");
  toolbar.setAttribute("aria-label", "3D camera controls");
  const readout = document.createElement("span");
  readout.className = "view3d-camera-status";
  const updateCamera = (patch) => {
    if (disposed) return;
    camera = constrainCamera({ ...camera, ...patch });
    render(sharedState.get());
  };
  for (const [label, action, change] of [
    ["Rotate left", "left", () => ({ yaw: camera.yaw - 0.2 })],
    ["Rotate right", "right", () => ({ yaw: camera.yaw + 0.2 })],
    ["Tilt up", "up", () => ({ pitch: camera.pitch + 0.15 })],
    ["Tilt down", "down", () => ({ pitch: camera.pitch - 0.15 })],
    ["Zoom in", "in", () => ({ zoom: camera.zoom + 0.1 })],
    ["Zoom out", "out", () => ({ zoom: camera.zoom - 0.1 })],
    ["Reset view", "reset", () => DEFAULT_CAMERA],
  ]) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.dataset.cameraAction = action;
    button.addEventListener("click", () => updateCamera(change()));
    toolbar.append(button);
  }
  toolbar.append(readout);
  container.replaceChildren(svg, toolbar);
  const render = (nextSnapshot) => {
    if (disposed) return;
    snapshot = nextSnapshot;
    const { width, height } = VIEW3D;
    svg.replaceChildren();
    pointerNode = null;
    svg.dataset.yaw = String(camera.yaw);
    svg.dataset.pitch = String(camera.pitch);
    svg.dataset.zoom = String(camera.zoom);
    readout.textContent = `Zoom ${Math.round(camera.zoom * 100)}% · Orthographic view`;
    const project = (m, e, l) => projectNormalized(m, e, l, camera);
    const drawLine = (start, end, className, parent = svg) => {
      const line = element("line", className);
      for (const [key, value] of Object.entries({ x1: start.x, y1: start.y, x2: end.x, y2: end.y })) line.setAttribute(key, value);
      parent.append(line);
    };
    const center = project(0.5, 0.5, 0.5);
    const ranges = snapshot.axis_ranges;
    const ticks = {
      makespan_s: scaleTicks(ranges.makespan_s.min, ranges.makespan_s.max),
      energy_j: scaleTicks(ranges.energy_j.min, ranges.energy_j.max),
      mean_latency_s: scaleTicks(ranges.mean_latency_s.min, ranges.mean_latency_s.max),
    };
    // Box edges, then split lines on the three far faces, aligned with the axis ticks.
    for (let axis = 0; axis < 3; axis++) for (const a of [0, 1]) for (const b of [0, 1]) {
      const start = [0, 0, 0], end = [0, 0, 0];
      start[(axis + 1) % 3] = end[(axis + 1) % 3] = a;
      start[(axis + 2) % 3] = end[(axis + 2) % 3] = b;
      end[axis] = 1;
      drawLine(project(...start), project(...end), "view3d-grid");
    }
    const far = (atZero, atOne) => project(...atZero).depth <= project(...atOne).depth ? 0 : 1;
    const face = {
      m: far([0, 0.5, 0.5], [1, 0.5, 0.5]),
      e: far([0.5, 0, 0.5], [0.5, 1, 0.5]),
      l: far([0.5, 0.5, 0], [0.5, 0.5, 1]),
    };
    const interior = (key) => ticks[key].filter((tick) => !tick.end);
    for (const tick of interior("mean_latency_s")) drawLine(project(face.m, 0, tick.t), project(face.m, 1, tick.t), "view3d-grid");
    for (const tick of interior("energy_j")) drawLine(project(face.m, tick.t, 0), project(face.m, tick.t, 1), "view3d-grid");
    for (const tick of interior("mean_latency_s")) drawLine(project(0, face.e, tick.t), project(1, face.e, tick.t), "view3d-grid");
    for (const tick of interior("makespan_s")) drawLine(project(tick.t, face.e, 0), project(tick.t, face.e, 1), "view3d-grid");
    for (const tick of interior("energy_j")) drawLine(project(0, tick.t, face.l), project(1, tick.t, face.l), "view3d-grid");
    for (const tick of interior("makespan_s")) drawLine(project(tick.t, 0, face.l), project(tick.t, 1, face.l), "view3d-grid");
    const compared = sharedState.filterRuns ? comparisonRuns(model, snapshot) : visibleRuns(model, snapshot);
    const population = sharedState.filterRuns ? visibleRuns(model, snapshot) : compared;
    const cloud = population.length > 10;
    const runs = cloud ? population : compared;
    const compactMarks = cloud && compared.length > 10;
    const colorKey = "energy_j";
    const colorSpan = snapshot.axis_ranges[colorKey].max - snapshot.axis_ranges[colorKey].min;
    let corner = [0, 0, 0], bestEdge = -Infinity;
    for (const m of [0, 1]) for (const l of [0, 1]) {
      const low = project(m, 0, l);
      const high = project(m, 1, l);
      const midX = (low.x + high.x) / 2;
      const lower = low.y >= high.y ? [m, 0, l] : [m, 1, l];
      const score = -midX * 3 + Math.max(low.y, high.y) * 0.4 + Math.max(low.depth, high.depth) * 40;
      if (score > bestEdge) { bestEdge = score; corner = lower; }
    }
    const axisPoint = (index, t) => {
      const coord = [...corner];
      coord[index] = t;
      return project(...coord);
    };
    const rightLimit = cloud ? 640 : VIEW3D.width - 28;
    const occupied = [];
    const axisSide = (index) => {
      const start = axisPoint(index, 0);
      const end = axisPoint(index, 1);
      const dx = end.x - start.x, dy = end.y - start.y;
      const len = Math.hypot(dx, dy) || 1;
      let px = -dy / len, py = dx / len;
      const mid = axisPoint(index, 0.5);
      if (px * (mid.x - center.x) + py * (mid.y - center.y) < 0) { px = -px; py = -py; }
      return { x: dx / len, y: dy / len, px, py };
    };
    const placeLabel = (point, dir, along, aside, text, className, gap = 22) => {
      let pos = { x: point.x + dir.x * along + dir.px * aside, y: point.y + dir.y * along + dir.py * aside };
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const clash = occupied.some((item) => Math.hypot(item.x - pos.x, item.y - pos.y) < gap);
        if (!clash) break;
        pos = { x: pos.x + dir.px * 16, y: pos.y + dir.py * 16 };
      }
      pos = {
        x: Math.max(28, Math.min(rightLimit, pos.x)),
        y: Math.max(14, Math.min(VIEW3D.height - 12, pos.y)),
      };
      occupied.push(pos);
      const movingX = along !== 0 ? dir.x * Math.sign(along) : dir.px;
      const movingY = along !== 0 ? dir.y * Math.sign(along) : dir.py;
      const label = element("text", className);
      label.setAttribute("x", pos.x);
      label.setAttribute("y", pos.y);
      label.setAttribute("text-anchor", Math.abs(movingX) >= Math.abs(movingY) ? (movingX > 0 ? "start" : "end") : "middle");
      label.setAttribute("dominant-baseline", "middle");
      label.textContent = text;
      svg.append(label);
    };
    AXIS_KEYS.forEach((key, index) => {
      const side = axisSide(index);
      drawLine(axisPoint(index, 0), axisPoint(index, 1), "view3d-axis");
      let previous = null;
      for (const tick of ticks[key]) {
        const at = axisPoint(index, tick.t);
        drawLine(at, { x: at.x + side.px * 6, y: at.y + side.py * 6 }, "view3d-tick-mark");
        const probe = { x: at.x + side.px * 14, y: at.y + side.py * 14 };
        if (!tick.end && previous && Math.hypot(probe.x - previous.x, probe.y - previous.y) < 28) continue;
        placeLabel(at, side, 0, 16, formatTick(tick.value), "view3d-tick");
        previous = probe;
      }
      placeLabel(axisPoint(index, 0.5), side, 0, 46, AXIS_LABELS[key], "view3d-axis-label", 42);
    });
    scene = { project, axisPoint, center, rightLimit, ranges };
    if (cloud) appendJetScale(svg, snapshot.axis_ranges[colorKey]);
    placed = runs.map((run) => ({ run, point: projectRun(run, snapshot.axis_ranges, camera) }))
      .sort((a, b) => a.point.depth - b.point.depth || a.run.run_id.localeCompare(b.run.run_id));
    for (const item of placed) {
      const { run, point } = item;
      const slot = stableConfigIndex(model.configs, run.policy_config_id);
      const selectedIds = new Set(snapshot.comparison_run_ids ?? snapshot.selected_run_ids ?? []);
      const selected = selectedIds.has(run.run_id);
      const full = model.labels.full.get(run.run_id)?.nonDominated;
      const cluster = coincidentIds(runs, snapshot.axis_ranges, run.run_id, camera);
      const compact = cloud && (compactMarks || !selected);
      item.compact = compact;
      const group = element("g", selected ? "view3d-point selected" : "view3d-point");
      if (!compact || selected) group.dataset.runId = run.run_id;
      else group.dataset.jetId = run.run_id;
      group.dataset.selected = selected ? "true" : "false";
      group.dataset.x = String(point.x);
      group.dataset.y = String(point.y);
      group.dataset.coincident = cluster.join("|");
      group.dataset.fullNonDominated = full ? "true" : "false";
      group.setAttribute("tabindex", "0");
      group.setAttribute("role", "button");
      const title = element("title");
      const overlap = cluster.length > 1 ? `\nOverlapping projected runs: ${cluster.join(", ")}` : "";
      title.textContent = `${runLabel(model, run)} | ${run.run_id}\n`
        + `M=${formatRaw(run.makespan_s)} s, E=${formatRaw(run.energy_j)} J, L=${formatRaw(run.mean_latency_s)} s`
        + `\n3D: ${full === undefined ? "Not calculated" : full ? "Non-dominated" : "Dominated"}${overlap}`;
      group.setAttribute("aria-label", title.textContent);
      if (compact) {
        const shade = colorSpan === 0 ? 0.5 : (run[colorKey] - snapshot.axis_ranges[colorKey].min) / colorSpan;
        const dot = element("circle", "view3d-dot");
        dot.setAttribute("cx", point.x);
        dot.setAttribute("cy", point.y);
        dot.setAttribute("r", "4.2");
        dot.setAttribute("fill", jetColor(shade));
        dot.setAttribute("fill-opacity", "0.86");
        group.append(title, dot);
      } else {
        const color = POLICY_COLORS[slot % POLICY_COLORS.length];
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
      }
      const choose = (shift) => {
        if (disposed) return;
        if (sharedState.filterRuns) { sharedState.toggleComparison(run.run_id); return; }
        const ids = shift ? [...sharedState.get().selected_run_ids, ...(compact ? [run.run_id] : cluster)] : (compact ? [run.run_id] : cluster);
        sharedState.selectRuns(ids);
      };
      group.addEventListener("click", (event) => { if (!suppressClick) choose(event.shiftKey); });
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
      empty.setAttribute("pointer-events", "none");
      empty.textContent = sharedState.filterRuns ? "Add runs from the results list or select a random sample to compare in 3D" : "No complete runs are visible under the current filters";
      svg.append(empty);
    }
    if (pointerTarget?.run) {
      const fresh = placed.find((item) => item.run.run_id === pointerTarget.run.run_id);
      pointerTarget = fresh ? { run: fresh.run, point: fresh.point, compact: fresh.compact } : null;
    }
    paintPointer();
  };
  function detachPointer() {
    if (!pointerNode) return;
    if (typeof pointerNode.remove === "function") pointerNode.remove();
    if (Array.isArray(svg.children)) {
      const index = svg.children.indexOf(pointerNode);
      if (index >= 0) svg.children.splice(index, 1);
    }
    pointerNode = null;
  }
  function paintPointer() {
    detachPointer();
    if (!pointerTarget || !scene) return;
    const { project, axisPoint, center, rightLimit, ranges } = scene;
    const run = pointerTarget.run;
    const m = run ? unitNorm(run.makespan_s, ranges.makespan_s) : pointerTarget.m;
    const e = run ? unitNorm(run.energy_j, ranges.energy_j) : pointerTarget.e;
    const l = run ? unitNorm(run.mean_latency_s, ranges.mean_latency_s) : pointerTarget.l;
    const group = element("g", "view3d-pointer");
    group.setAttribute("pointer-events", "none");
    const cross = (start, end) => drawPointerLine(group, start, end);
    cross(project(0, e, l), project(1, e, l));
    cross(project(m, 0, l), project(m, 1, l));
    cross(project(m, e, 0), project(m, e, 1));
    if (pointerTarget.point) {
      const ring = element("circle", "view3d-hover");
      ring.setAttribute("cx", pointerTarget.point.x);
      ring.setAttribute("cy", pointerTarget.point.y);
      ring.setAttribute("r", pointerTarget.compact ? "7" : "12");
      group.append(ring);
    }
    [m, e, l].forEach((coord, index) => {
      const key = AXIS_KEYS[index];
      const value = run ? run[key] : ranges[key].min + coord * (ranges[key].max - ranges[key].min);
      const at = axisPoint(index, coord);
      const dx = at.x - center.x, dy = at.y - center.y;
      const len = Math.hypot(dx, dy) || 1;
      const x = Math.max(28, Math.min(rightLimit, at.x + dx / len * 22));
      const y = Math.max(12, Math.min(VIEW3D.height - 12, at.y + dy / len * 22));
      const text = formatReadout(value);
      const width = Math.max(32, text.length * 6.8 + 12);
      const tag = element("rect", "view3d-pointer-tag");
      tag.setAttribute("x", x - width / 2);
      tag.setAttribute("y", y - 9);
      tag.setAttribute("width", width);
      tag.setAttribute("height", 18);
      tag.setAttribute("rx", 2);
      const label = element("text", "view3d-pointer-value");
      label.setAttribute("x", x);
      label.setAttribute("y", y);
      label.setAttribute("text-anchor", "middle");
      label.setAttribute("dominant-baseline", "middle");
      label.textContent = text;
      group.append(tag, label);
    });
    if (run && pointerTarget.point) {
      const title = runLabel(model, run);
      const lines = [
        title.length > 36 ? `${title.slice(0, 35)}…` : title,
        `M ${formatReadout(run.makespan_s)} s`,
        `E ${formatReadout(run.energy_j)} J`,
        `L ${formatReadout(run.mean_latency_s)} s`,
      ];
      const width = Math.min(250, Math.max(112, ...lines.map((line) => line.length * 6.5 + 18)));
      const point = pointerTarget.point;
      let x = point.x + 16;
      let y = point.y - 62;
      if (x + width > VIEW3D.width - 12) x = point.x - width - 16;
      if (y < 8) y = point.y + 16;
      const background = element("rect", "view3d-tip-bg");
      background.setAttribute("x", x);
      background.setAttribute("y", y);
      background.setAttribute("width", width);
      background.setAttribute("height", 18 * lines.length + 10);
      background.setAttribute("rx", 2);
      group.append(background);
      lines.forEach((line, index) => {
        const text = element("text", "view3d-tip-text");
        text.setAttribute("x", x + 8);
        text.setAttribute("y", y + 16 + index * 18);
        text.textContent = line;
        group.append(text);
      });
    }
    pointerNode = group;
    svg.append(group);
  }
  function drawPointerLine(group, start, end) {
    const line = element("line", "view3d-pointer-line");
    line.setAttribute("x1", start.x);
    line.setAttribute("y1", start.y);
    line.setAttribute("x2", end.x);
    line.setAttribute("y2", end.y);
    group.append(line);
  }
  function viewPoint(event) {
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: (event.clientX - rect.left) / rect.width * VIEW3D.width,
      y: (event.clientY - rect.top) / rect.height * VIEW3D.height,
    };
  }
  function trackPointer(event) {
    if (disposed || drag) return;
    const local = viewPoint(event);
    if (!local) return;
    let best = null, bestDistance = 16;
    for (const item of placed) {
      const gap = Math.hypot(item.point.x - local.x, item.point.y - local.y);
      if (gap < bestDistance) { best = item; bestDistance = gap; }
    }
    if (best) {
      if (pointerTarget?.run?.run_id === best.run.run_id) return;
      pointerTarget = { run: best.run, point: best.point, compact: best.compact };
    } else {
      const hit = pointerOnBox(local.x, local.y, camera);
      pointerTarget = hit ? { m: hit.m, e: hit.e, l: hit.l } : null;
    }
    paintPointer();
  }
  svg.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || disposed) return;
    suppressClick = false;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, camera: { ...camera } };
  });
  svg.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.id) {
      if (!drag) trackPointer(event);
      return;
    }
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (!suppressClick && Math.hypot(dx, dy) < 5) return;
    suppressClick = true;
    if (pointerTarget && !pointerTarget.run) pointerTarget = null;
    svg.setPointerCapture?.(event.pointerId);
    svg.classList.toggle("rotating", true);
    const bounds = svg.getBoundingClientRect();
    updateCamera({ yaw: drag.camera.yaw + dx / bounds.width * 5, pitch: drag.camera.pitch + dy / bounds.height * 3 });
  });
  svg.addEventListener("pointerleave", () => {
    if (drag) return;
    pointerTarget = null;
    paintPointer();
  });
  const endDrag = (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    if (svg.hasPointerCapture?.(event.pointerId)) svg.releasePointerCapture(event.pointerId);
    drag = null;
    svg.classList.toggle("rotating", false);
  };
  svg.addEventListener("pointerup", endDrag);
  svg.addEventListener("pointercancel", endDrag);
  svg.addEventListener("lostpointercapture", endDrag);
  svg.addEventListener("wheel", (event) => {
    event.preventDefault();
    updateCamera({ zoom: camera.zoom * Math.exp(-Math.sign(event.deltaY) * 0.08) });
  }, { passive: false });
  svg.addEventListener("keydown", (event) => {
    if (event.target !== svg) return;
    const updates = { ArrowLeft: { yaw: camera.yaw - 0.15 }, ArrowRight: { yaw: camera.yaw + 0.15 },
      ArrowUp: { pitch: camera.pitch + 0.1 }, ArrowDown: { pitch: camera.pitch - 0.1 },
      "+": { zoom: camera.zoom + 0.1 }, "=": { zoom: camera.zoom + 0.1 }, "-": { zoom: camera.zoom - 0.1 }, Home: DEFAULT_CAMERA };
    if (updates[event.key]) { event.preventDefault(); updateCamera(updates[event.key]); }
  });
  const unsubscribe = sharedState.subscribe(render);
  return () => { disposed = true; drag = null; unsubscribe(); };
}
