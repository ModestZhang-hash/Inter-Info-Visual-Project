import { OBJECTIVES } from "./pareto.mjs";
import { defaultAxisRanges } from "./model.mjs";
import { detailsHTML } from "./details.mjs";
import { mountPairPlots } from "./plots.mjs";
import { POLICY_COLORS, POLICY_SHAPES, stableConfigIndex } from "../shared/encoding.mjs";
import { createSession } from "../shared/session.mjs";

const META = {
  makespan_s: { short: "M", label: "总完成时间 M (s) ↓" },
  energy_j: { short: "E", label: "任务相关能耗 E (J) ↓" },
  mean_latency_s: { short: "L", label: "平均端到端延迟 L (s) ↓" },
};
let model;
let state;
let unsubscribe;
let unsubscribePlots;

const $ = (id) => document.getElementById(id);
const number = (value) => Number.isFinite(value) ? Number(value.toPrecision(7)).toString() : "—";

function notice(message, error = false) {
  $("notice").textContent = message;
  $("notice").classList.toggle("error", error);
}

function loadBundle(bundle) {
  const next = createSession(bundle);
  if (unsubscribe) unsubscribe();
  if (unsubscribePlots) unsubscribePlots();
  model = next.model;
  state = next.state;
  renderControls();
  unsubscribePlots = mountPairPlots($("plots"), model, state);
  unsubscribe = state.subscribe(render);
  if (model.referenceStatus === "fixture_only") notice("手工演示数据：七种固定放置用于检查 3A 交互和支配计算，不是调度算法或正式实验结果。");
  else if (model.referenceStatus === "incomplete_candidates") notice("参照集合未齐：可查看运行点和事件记录，但不显示默认七候选 Pareto 标签。");
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
  $("details-content").innerHTML = detailsHTML(model, snapshot);
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
