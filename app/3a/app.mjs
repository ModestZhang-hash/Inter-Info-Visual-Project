import { OBJECTIVES, PAIRS } from "./pareto.mjs";
import { defaultAxisRanges, readBundle } from "./model.mjs";
import { createViewState } from "../shared/state.mjs";
import { drawPairScatter } from "../shared/pair_scatter.mjs";
import { POLICY_COLORS, POLICY_SHAPES, stableConfigIndex } from "../shared/encoding.mjs";

const META = {
  makespan_s: { short: "M", label: "总完成时间 M (s) ↓" },
  energy_j: { short: "E", label: "任务相关能耗 E (J) ↓" },
  mean_latency_s: { short: "L", label: "平均端到端延迟 L (s) ↓" },
};
let model;
let state;
let unsubscribe;

const $ = (id) => document.getElementById(id);
const safe = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const number = (value) => Number.isFinite(value) ? Number(value.toPrecision(7)).toString() : "—";
const fullNumber = (value) => Number.isFinite(value) ? String(value) : "—";
const configFor = (run) => model.configs.find((item) => item.policy_config_id === run.policy_config_id);
const configIndex = (run) => stableConfigIndex(model.configs, run.policy_config_id);
const runName = (run) => configFor(run)?.label || run.policy_config_id;

function notice(message, error = false) {
  $("notice").textContent = message;
  $("notice").classList.toggle("error", error);
}

function loadBundle(bundle) {
  const next = readBundle(bundle);
  const axisRanges = defaultAxisRanges(next.runs);
  if (unsubscribe) unsubscribe();
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
  unsubscribe = state.subscribe(render);
  if (next.referenceStatus === "fixture_only") notice("手工演示数据：七种固定放置用于检查 3A 交互和支配计算，不是调度算法或正式实验结果。");
  else if (next.referenceStatus === "incomplete_candidates") notice("参照集合未齐：可查看运行点和事件记录，但不显示默认七候选 Pareto 标签。");
  else notice("七个完整候选来自同一冻结实例；支配标签以未舍入值和清单容差计算，筛选不改变参照集合。");
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
          render(state.get());
          return;
        }
        state.setAxisRange(key, candidate);
      });
      row.append(input);
    }
    wrapper.append(row);
    axes.append(wrapper);
  }
}

function render(snapshot) {
  $("instance-id").textContent = snapshot.current_instance_id;
  $("reference-status").textContent = {
    complete: "同实例七候选 · 完整",
    incomplete_candidates: "参照集合未齐",
    fixture_only: "手工演示 · 非正式前沿",
  }[snapshot.pareto_reference_status];
  const completeRuns = model.runs.filter((run) => run.status === "complete");
  const visible = completeRuns.filter((run) => snapshot.visible_policy_config_ids.includes(run.policy_config_id));
  $("run-count").textContent = `${visible.length} / ${completeRuns.length}`;
  $("selection-count").textContent = String(snapshot.selected_run_ids.length);
  for (const input of $("policy-filters").querySelectorAll("input")) input.checked = snapshot.visible_policy_config_ids.includes(input.dataset.configId);
  for (const input of $("axis-controls").querySelectorAll("input")) input.value = number(snapshot.axis_ranges[input.dataset.axis][input.dataset.side]);
  renderPlots(snapshot, visible);
  renderDetails(snapshot);
}

function renderPlots(snapshot, visible) {
  const container = $("plots");
  container.replaceChildren();
  for (const pair of PAIRS) {
    const [xKey, yKey] = pair;
    const card = document.createElement("article");
    card.className = "plot";
    const heading = document.createElement("h3");
    heading.textContent = `${META[xKey].short} – ${META[yKey].short}`;
    const subtitle = document.createElement("p");
    subtitle.textContent = model.referenceStatus === "complete" ? "深色描边：此二维投影非支配；金色虚线圈：完整三维非支配" : model.referenceStatus === "fixture_only" ? "手工数据的支配关系演示；不代表正式实验前沿" : "参照集合未齐，支配状态暂不显示";
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    drawPairScatter(svg, {
      runs: visible,
      xKey, yKey,
      xRange: snapshot.axis_ranges[xKey],
      yRange: snapshot.axis_ranges[yKey],
      selectedRunIds: snapshot.selected_run_ids,
      projectedLabels: model.labels.pairs.get(pair.join("|")),
      fullLabels: model.labels.full,
      axisLabels: Object.fromEntries(OBJECTIVES.map((key) => [key, META[key].label])),
      encodeRun: (run) => ({ index: configIndex(run), color: POLICY_COLORS[configIndex(run) % POLICY_COLORS.length] }),
      tooltip: (run, projected, full) => `${runName(run)} | ${run.run_id}\nM=${fullNumber(run.makespan_s)} s, E=${fullNumber(run.energy_j)} J, L=${fullNumber(run.mean_latency_s)} s\n二维: ${projected === undefined ? "未计算" : projected ? "非支配" : "被支配"}; 三维: ${full === undefined ? "未计算" : full ? "非支配" : "被支配"}`,
      onSelect: (id, shift) => state.selectRuns(shift ? [...state.get().selected_run_ids, id] : [id]),
      onBrush: (ids, shift) => state.selectRuns(shift ? [...state.get().selected_run_ids, ...ids] : ids),
      formatValue: number,
    });
    card.append(heading, subtitle, svg);
    container.append(card);
  }
}

function statusText(entry) { return entry ? entry.nonDominated ? "非支配" : "被支配" : "未计算"; }

function renderDetails(snapshot) {
  const box = $("details-content");
  const selected = snapshot.selected_run_ids.map((id) => model.runs.find((run) => run.run_id === id)).filter(Boolean);
  if (!selected.length) { box.innerHTML = `<p class="muted">选择图中的运行点后，这里会显示完整目标值、各投影与三维状态、支配证据和任务事件。图中的数值只作显示舍入。</p>`; return; }
  box.innerHTML = `<div class="details-grid">${selected.map((run) => detailCard(run)).join("")}</div>`;
}

function detailCard(run) {
  const events = model.events.filter((event) => event.run_id === run.run_id);
  const rows = PAIRS.map((pair) => {
    const result = model.labels.pairs.get(pair.join("|"))?.get(run.run_id);
    const name = pair.map((key) => META[key].short).join("–");
    return `<li><strong>${name}：</strong>${statusText(result)}${result?.witnesses.length ? witness(result) : ""}</li>`;
  }).join("");
  const full = model.labels.full.get(run.run_id);
  const taskRows = events.map((event) => `<tr><td>${safe(event.task_id)}</td><td>${safe(event.destination_id)}</td><td>${fullNumber(event.upload_start_s)} → ${fullNumber(event.upload_end_s)}</td><td>${fullNumber(event.compute_start_s)} → ${fullNumber(event.compute_end_s)}</td><td>${fullNumber(event.return_start_s)} → ${fullNumber(event.return_end_s)}</td><td>${fullNumber(event.completion_s)}</td><td>${fullNumber(event.compute_energy_j)} + ${fullNumber(event.transfer_energy_j)}</td></tr>`).join("");
  return `<article class="detail-card"><h3>${safe(runName(run))} <span class="muted">${safe(run.run_id)}</span></h3>
    <div class="metrics"><span>M <strong>${fullNumber(run.makespan_s)} s</strong></span><span>E <strong>${fullNumber(run.energy_j)} J</strong></span><span>L <strong>${fullNumber(run.mean_latency_s)} s</strong></span></div>
    <p class="muted">实例 ${safe(run.instance_id)} · 配置 ${safe(run.policy_config_id)} · ${safe(run.record_origin)}</p>
    <p class="${model.referenceStatus === "complete" ? "" : "warning"}">${model.referenceStatus === "complete" ? "参照集合：同一实例的七个完整候选；筛选不改变标签。" : model.referenceStatus === "fixture_only" ? "手工示例的支配计算，不是正式实验前沿。" : "参照集合未齐，无正式支配标签。"}</p>
    <ul class="status-list">${rows}<li><strong>三维 M–E–L：</strong>${statusText(full)}${full?.witnesses.length ? witness(full) : ""}</li></ul>
    <div class="table-wrap"><table><thead><tr><th>任务</th><th>节点</th><th>上传 s</th><th>计算 s</th><th>返回 s</th><th>完成 s</th><th>能耗 J（计算 + 传输）</th></tr></thead><tbody>${taskRows}</tbody></table></div></article>`;
}

function witness(classification) {
  const entry = classification.witnesses[0];
  const candidate = model.runs.find((run) => run.run_id === entry.witnessRunId);
  const relationName = { strict_improvement: "严格更优", equal: "相等", equivalent_within_tolerance: "容差内等价" };
  const dimensions = entry.comparedObjectives.map((key) => `${META[key].short}：${relationName[entry.relations[key]]}`).join("；");
  const target = OBJECTIVES.map((key) => `${META[key].short}=${fullNumber(entry.targetMetrics[key])}`).join("，");
  const source = OBJECTIVES.map((key) => `${META[key].short}=${fullNumber(entry.witnessMetrics[key])}`).join("，");
  const others = classification.witnessRunIds.length > 1 ? `；其他有效 witness：${classification.witnessRunIds.slice(1).map(safe).join("、")}` : "";
  return `<div class="witness">按 run_id 字典序选择的支配证据：<strong>${safe(entry.witnessRunId)}</strong>（${safe(runName(candidate))}）。比较维度 ${safe(entry.comparedObjectives.map((key) => META[key].short).join("–"))}：${safe(dimensions)}。<br>当前运行：${safe(target)}<br>证据运行：${safe(source)}${others}</div>`;
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
$("reset-axes").addEventListener("click", () => { if (state) for (const [key, range] of Object.entries(defaultAxisRanges(model.runs))) state.setAxisRange(key, range); });
$("export-csv").addEventListener("click", () => {
  if (!model || !state) return;
  const selected = new Set(state.get().selected_run_ids);
  const rows = model.runs.filter((run) => selected.has(run.run_id));
  if (!rows.length) { notice("先选择至少一个运行再导出。", true); return; }
  const columns = ["instance_id", "run_id", "policy_config_id", "status", ...OBJECTIVES];
  const csv = [columns.join(","), ...rows.map((run) => columns.map((key) => `"${String(run[key] ?? "").replaceAll('"', '""')}"`).join(","))].join("\r\n") + "\r\n";
  const url = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `topic3a-${model.instance.instance_id}-selected.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

try {
  const response = await fetch("../../examples/3a-demo/bundle.json");
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  loadBundle(await response.json());
} catch (error) {
  notice(`无法载入演示数据：${error.message}。请从项目根目录启动本地 HTTP 服务。`, true);
}
