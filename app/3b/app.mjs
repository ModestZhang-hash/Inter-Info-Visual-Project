import { OBJECTIVES, PAIRS } from "../3a/pareto.mjs";
import { defaultAxisRanges, readBundle } from "../3a/model.mjs";
import { createViewState } from "../shared/state.mjs";
import { POLICY_COLORS, POLICY_SHAPES, stableConfigIndex } from "../shared/encoding.mjs";
import { mountMatrix } from "./matrix.mjs";
import { mountParallel } from "./parallel.mjs";
import { mountView3d } from "./view3d.mjs";

const META = {
  makespan_s: { short: "M", label: "总完成时间 M (s) ↓" },
  energy_j: { short: "E", label: "任务相关能耗 E (J) ↓" },
  mean_latency_s: { short: "L", label: "平均端到端延迟 L (s) ↓" },
};

let model;
let state;
let unsubscribePage;
let unsubscribeMatrix;
let unsubscribeParallel;
let unsubscribeView3d;

const $ = (id) => document.getElementById(id);
const safe = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const fullNumber = (value) => Number.isFinite(value) ? String(value) : "—";
const displayNumber = (value) => Number.isFinite(value) ? Number(value.toPrecision(7)).toString() : "—";
const configFor = (run) => model.configs.find((item) => item.policy_config_id === run.policy_config_id);
const runName = (run) => configFor(run)?.label || run.policy_config_id;

function notice(message, error = false) {
  $("notice").textContent = message;
  $("notice").classList.toggle("error", error);
}

function provenanceText(status) {
  if (status === "fixture_only") return "fixture_only · 手工演示数据 · 这些点不是调度算法结果，也不是正式七候选前沿。";
  if (status === "incomplete_candidates") return "参照集合未齐 · 可查看运行点，不显示默认七候选 Pareto 标签。";
  return "同实例七候选完整 · 支配标签来自未舍入值和清单容差；筛选不改变参照集合。";
}

function showStatusNotice() {
  if (!model) return;
  if (model.referenceStatus === "fixture_only") {
    notice("fixture_only：手工演示数据，用于检查矩阵、平行坐标和固定 3D 投影的交互与支配计算，不是调度算法结果，也不是正式七候选前沿。");
  } else if (model.referenceStatus === "incomplete_candidates") {
    notice("参照集合未齐：可查看运行点，但不显示默认七候选 Pareto 标签。");
  } else {
    notice("七个完整候选来自同一冻结实例；支配标签以未舍入值和清单容差计算，筛选不改变参照集合。");
  }
}

function loadBundle(bundle) {
  const next = readBundle(bundle);
  const axisRanges = defaultAxisRanges(next.runs);
  if (unsubscribePage) unsubscribePage();
  if (unsubscribeMatrix) unsubscribeMatrix();
  if (unsubscribeParallel) unsubscribeParallel();
  if (unsubscribeView3d) unsubscribeView3d();
  model = next;
  state = createViewState({
    schema_version: "1.0.0",
    current_instance_id: next.instance.instance_id,
    selected_run_ids: [],
    visible_policy_config_ids: next.configs.map((item) => item.policy_config_id),
    axis_ranges: axisRanges,
    pareto_reference_run_ids: next.referenceStatus === "complete" ? next.referenceRuns.map((run) => run.run_id) : [],
    pareto_reference_status: next.referenceStatus,
  });
  renderControls();
  unsubscribeMatrix = mountMatrix($("matrix"), model, state);
  unsubscribeParallel = mountParallel($("parallel"), model, state);
  unsubscribeView3d = mountView3d($("view3d"), model, state);
  unsubscribePage = state.subscribe(renderChrome);
  showStatusNotice();
}

function renderControls() {
  const filters = $("policy-filters");
  filters.replaceChildren();
  model.configs.forEach((config) => {
    const index = stableConfigIndex(model.configs, config.policy_config_id);
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = true;
    input.dataset.configId = config.policy_config_id;
    input.addEventListener("change", () => {
      const ids = [...filters.querySelectorAll("input:checked")].map((item) => item.dataset.configId);
      state.setVisibleConfigs(ids);
    });
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = POLICY_COLORS[index % POLICY_COLORS.length];
    const name = document.createElement("span");
    name.textContent = `${POLICY_SHAPES[index % POLICY_SHAPES.length]} ${config.label || config.policy_config_id}`;
    label.append(input, swatch, name);
    filters.append(label);
  });
  const axes = $("axis-controls");
  axes.replaceChildren();
  for (const key of OBJECTIVES) {
    const wrapper = document.createElement("label");
    wrapper.textContent = META[key].label;
    const row = document.createElement("div");
    row.className = "axis-row";
    for (const side of ["min", "max"]) {
      const input = document.createElement("input");
      input.type = "number";
      input.step = "any";
      input.dataset.axis = key;
      input.dataset.side = side;
      input.setAttribute("aria-label", `${META[key].label} ${side}`);
      input.addEventListener("change", () => {
        const current = state.get().axis_ranges[key];
        const candidate = { ...current, [side]: Number(input.value) };
        if (!Number.isFinite(candidate.min) || !Number.isFinite(candidate.max) || candidate.min >= candidate.max) {
          notice("坐标范围无效：最小值必须小于最大值。", true);
          renderChrome(state.get());
          return;
        }
        state.setAxisRange(key, candidate);
        showStatusNotice();
      });
      row.append(input);
    }
    wrapper.append(row);
    axes.append(wrapper);
  }
}

function renderChrome(snapshot) {
  $("instance-id").textContent = snapshot.current_instance_id;
  $("reference-status").textContent = {
    complete: "同实例七候选 · 完整",
    incomplete_candidates: "参照集合未齐",
    fixture_only: "手工演示 · fixture_only · 非正式前沿",
  }[snapshot.pareto_reference_status];
  $("provenance").textContent = provenanceText(snapshot.pareto_reference_status);
  $("reference-ids").textContent = snapshot.pareto_reference_run_ids.length ? snapshot.pareto_reference_run_ids.join("，") : "无";
  const completeRuns = model.runs.filter((run) => run.status === "complete");
  const visible = completeRuns.filter((run) => snapshot.visible_policy_config_ids.includes(run.policy_config_id));
  $("run-count").textContent = `${visible.length} / ${completeRuns.length}`;
  $("selection-count").textContent = String(snapshot.selected_run_ids.length);
  $("selection-ids").textContent = snapshot.selected_run_ids.length ? snapshot.selected_run_ids.join("，") : "无";
  for (const input of $("policy-filters").querySelectorAll("input")) {
    input.checked = snapshot.visible_policy_config_ids.includes(input.dataset.configId);
  }
  for (const input of $("axis-controls").querySelectorAll("input")) {
    input.value = displayNumber(snapshot.axis_ranges[input.dataset.axis][input.dataset.side]);
  }
  renderDetails(snapshot);
}

function statusText(entry) {
  return entry ? entry.nonDominated ? "非支配" : "被支配" : "未计算";
}

function renderDetails(snapshot) {
  const box = $("details-content");
  const selected = snapshot.selected_run_ids.map((id) => model.runs.find((run) => run.run_id === id)).filter(Boolean);
  if (!selected.length) {
    box.innerHTML = `<p class="muted">在矩阵、平行坐标或 3D 视图中选择运行后，这里显示未舍入的 M/E/L、各投影与三维状态，以及支配证据的 run_id。</p>`;
    return;
  }
  box.innerHTML = `<div class="details-grid">${selected.map((run) => detailCard(run)).join("")}</div>`;
}

function witness(classification) {
  const entry = classification.witnesses[0];
  const relationName = { strict_improvement: "严格更优", equal: "相等", equivalent_within_tolerance: "容差内等价" };
  const dimensions = entry.comparedObjectives.map((key) => `${META[key].short}：${relationName[entry.relations[key]]}`).join("；");
  const others = classification.witnessRunIds.length > 1 ? `；其他有效 witness：${classification.witnessRunIds.slice(1).map(safe).join("、")}` : "";
  return `<div class="witness">支配证据 run_id：<strong>${safe(entry.witnessRunId)}</strong>。${safe(dimensions)}${others}</div>`;
}

function detailCard(run) {
  const rows = PAIRS.map((pair) => {
    const result = model.labels.pairs.get(pair.join("|"))?.get(run.run_id);
    const name = pair.map((key) => META[key].short).join("–");
    return `<li><strong>${name}：</strong>${statusText(result)}${result?.witnesses.length ? witness(result) : ""}</li>`;
  }).join("");
  const full = model.labels.full.get(run.run_id);
  return `<article class="detail-card"><h3>${safe(runName(run))} <span class="muted">${safe(run.run_id)}</span></h3>
    <div class="metrics"><span>M <strong>${fullNumber(run.makespan_s)} s</strong></span><span>E <strong>${fullNumber(run.energy_j)} J</strong></span><span>L <strong>${fullNumber(run.mean_latency_s)} s</strong></span></div>
    <p class="muted">配置 ${safe(run.policy_config_id)} · ${safe(run.record_origin)}</p>
    <p class="${model.referenceStatus === "complete" ? "" : "warning"}">${provenanceText(model.referenceStatus)}</p>
    <ul class="status-list">${rows}<li><strong>三维 M–E–L：</strong>${statusText(full)}${full?.witnesses.length ? witness(full) : ""}</li></ul></article>`;
}

$("bundle-file").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try { loadBundle(JSON.parse(await file.text())); }
  catch (error) { notice(`导入失败：${error.message}`, true); }
  event.target.value = "";
});
$("select-all").addEventListener("click", () => state?.setVisibleConfigs(model.configs.map((item) => item.policy_config_id)));
$("clear-selection").addEventListener("click", () => state?.selectRuns([]));
$("reset-axes").addEventListener("click", () => {
  if (!state) return;
  for (const [key, range] of Object.entries(defaultAxisRanges(model.runs))) state.setAxisRange(key, range);
  showStatusNotice();
});

try {
  const response = await fetch("../../examples/3a-demo/bundle.json");
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  loadBundle(await response.json());
} catch (error) {
  notice(`无法载入演示数据：${error.message}。请从项目根目录启动本地 HTTP 服务。`, true);
}
