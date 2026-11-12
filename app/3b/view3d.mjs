import { runLabel } from "../shared/labels.mjs";
import { comparisonRuns } from "../shared/state.mjs?v=workflow-1";
import { POLICY_COLORS, POLICY_SHAPES, stableConfigIndex } from "../shared/encoding.mjs";

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
  const svg = element("svg");
  svg.setAttribute("viewBox", `0 0 ${VIEW3D.width} ${VIEW3D.height}`);
  svg.setAttribute("role", "group");
  svg.setAttribute("tabindex", "0");
  svg.setAttribute("aria-label", "Interactive 3D comparison. Drag to rotate; scroll to zoom. Arrow keys rotate, plus and minus zoom, Home resets. Click a point to toggle comparison.");
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
    svg.dataset.yaw = String(camera.yaw);
    svg.dataset.pitch = String(camera.pitch);
    svg.dataset.zoom = String(camera.zoom);
    readout.textContent = `Zoom ${Math.round(camera.zoom * 100)}% · Orthographic view`;
    const project = (m, e, l) => projectNormalized(m, e, l, camera);
    const drawLine = (start, end, className) => {
      const line = element("line", className);
      for (const [key, value] of Object.entries({ x1: start.x, y1: start.y, x2: end.x, y2: end.y })) line.setAttribute(key, value);
      svg.append(line);
    };
    // A reference cube and floor grid keep the three dimensions legible while rotating.
    for (let axis = 0; axis < 3; axis++) for (const a of [0, 1]) for (const b of [0, 1]) {
      const start = [0, 0, 0], end = [0, 0, 0];
      start[(axis + 1) % 3] = end[(axis + 1) % 3] = a;
      start[(axis + 2) % 3] = end[(axis + 2) % 3] = b;
      end[axis] = 1;
      drawLine(project(...start), project(...end), "view3d-grid");
    }
    for (const value of [0.25, 0.5, 0.75]) {
      drawLine(project(value, 0, 0), project(value, 0, 1), "view3d-grid");
      drawLine(project(0, 0, value), project(1, 0, value), "view3d-grid");
    }
    const runs = sharedState.filterRuns ? comparisonRuns(model, snapshot) : visibleRuns(model, snapshot);
    const axes = [
      ["makespan_s", [1, 0, 0]],
      ["energy_j", [0, 1, 0]],
      ["mean_latency_s", [0, 0, 1]],
    ];
    const origin = project(0, 0, 0);
    for (const [key, vector] of axes) {
      const end = project(...vector);
      drawLine(origin, end, "view3d-axis");
      const label = element("text", "view3d-axis-label");
      label.setAttribute("x", end.x);
      label.setAttribute("y", end.y - 18);
      label.setAttribute("text-anchor", "middle");
      label.textContent = AXIS_LABELS[key];
      svg.append(label);
      for (const t of [0, 0.5, 1]) {
        const position = project(...vector.map(value => value * t));
        const tick = element("text", "view3d-tick");
        tick.setAttribute("x", position.x + 6);
        tick.setAttribute("y", position.y + 15 + (t === 0 ? axes.findIndex(([name]) => name === key) * 14 : 0));
        const value = snapshot.axis_ranges[key].min + t * (snapshot.axis_ranges[key].max - snapshot.axis_ranges[key].min);
        tick.textContent = `${t === 0 ? AXIS_LABELS[key][0] + " " : ""}${Number(value.toPrecision(4))}`;
        svg.append(tick);
      }
    }
    const placed = runs.map((run) => ({ run, point: projectRun(run, snapshot.axis_ranges, camera) }))
      .sort((a, b) => a.point.depth - b.point.depth || a.run.run_id.localeCompare(b.run.run_id));
    for (const { run, point } of placed) {
      const slot = stableConfigIndex(model.configs, run.policy_config_id);
      const color = POLICY_COLORS[slot % POLICY_COLORS.length];
      const selected = snapshot.selected_run_ids.includes(run.run_id);
      const full = model.labels.full.get(run.run_id)?.nonDominated;
      const cluster = coincidentIds(runs, snapshot.axis_ranges, run.run_id, camera);
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
      const overlap = cluster.length > 1 ? `\nOverlapping projected runs: ${cluster.join(", ")}` : "";
      title.textContent = `${runLabel(model, run)} | ${run.run_id}\n`
        + `M=${formatRaw(run.makespan_s)} s, E=${formatRaw(run.energy_j)} J, L=${formatRaw(run.mean_latency_s)} s`
        + `\n3D: ${full === undefined ? "Not calculated" : full ? "Non-dominated" : "Dominated"}${overlap}`;
      group.setAttribute("aria-label", title.textContent);
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
        if (disposed) return;
        if (sharedState.filterRuns) { sharedState.toggleComparison(run.run_id); return; }
        const ids = shift ? [...sharedState.get().selected_run_ids, ...cluster] : cluster;
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
      empty.textContent = sharedState.filterRuns ? "Add runs from the results list or select a random sample to compare in 3D" : "No complete runs are visible under the current filters";
      svg.append(empty);
    }
  };
  svg.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || disposed) return;
    suppressClick = false;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, camera: { ...camera } };
  });
  svg.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (!suppressClick && Math.hypot(dx, dy) < 5) return;
    suppressClick = true;
    svg.setPointerCapture?.(event.pointerId);
    svg.classList.toggle("rotating", true);
    const bounds = svg.getBoundingClientRect();
    updateCamera({ yaw: drag.camera.yaw + dx / bounds.width * 5, pitch: drag.camera.pitch + dy / bounds.height * 3 });
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
