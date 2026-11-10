import { OBJECTIVES, PAIRS } from "./pareto.mjs";
import { text } from "../shared/copy.mjs";

const META = {
  makespan_s: { short: "M", label: "总完成时间 M (s) ↓" },
  energy_j: { short: "E", label: "任务相关能耗 E (J) ↓" },
  mean_latency_s: { short: "L", label: "平均端到端延迟 L (s) ↓" },
};

const safe = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const fullNumber = (value) => Number.isFinite(value) ? String(value) : "—";
const statusText = (entry) => entry ? entry.nonDominated ? "非支配" : "被支配" : "未计算";

function runName(model, run, copy) {
  const label = model.configs.find((item) => item.policy_config_id === run.policy_config_id)?.label;
  return copy ? copy.displayName(label, run.policy_config_id) : (label || run.policy_config_id);
}

function witness(model, classification, copy) {
  const entry = classification.witnesses[0];
  const candidate = model.runs.find((run) => run.run_id === entry.witnessRunId);
  if (!copy) {
    const relationName = { strict_improvement: "严格更优", equal: "相等", equivalent_within_tolerance: "容差内等价" };
    const dimensions = entry.comparedObjectives.map((key) => `${META[key].short}：${relationName[entry.relations[key]]}`).join("；");
    const target = OBJECTIVES.map((key) => `${META[key].short}=${fullNumber(entry.targetMetrics[key])}`).join("，");
    const source = OBJECTIVES.map((key) => `${META[key].short}=${fullNumber(entry.witnessMetrics[key])}`).join("，");
    const others = classification.witnessRunIds.length > 1 ? `；其他有效 witness：${classification.witnessRunIds.slice(1).map(safe).join("、")}` : "";
    return `<div class="witness">按 run_id 字典序选择的支配证据：<strong>${safe(entry.witnessRunId)}</strong>（${safe(runName(model, candidate))}）。比较维度 ${safe(entry.comparedObjectives.map((key) => META[key].short).join("–"))}：${safe(dimensions)}。<br>当前运行：${safe(target)}<br>证据运行：${safe(source)}${others}</div>`;
  }
  const dimensions = entry.comparedObjectives.map((key) => `${copy.axes[key].short}: ${copy.relations[entry.relations[key]]}`).join("; ");
  const target = OBJECTIVES.map((key) => `${copy.axes[key].short}=${fullNumber(entry.targetMetrics[key])}`).join(", ");
  const source = OBJECTIVES.map((key) => `${copy.axes[key].short}=${fullNumber(entry.witnessMetrics[key])}`).join(", ");
  const others = classification.witnessRunIds.length > 1 ? `; other valid witnesses: ${classification.witnessRunIds.slice(1).map(safe).join(", ")}` : "";
  return `<div class="witness">Dominance witness chosen by run_id order: <strong>${safe(entry.witnessRunId)}</strong> (${safe(runName(model, candidate, copy))}). Compared objectives ${safe(entry.comparedObjectives.map((key) => copy.axes[key].short).join("–"))}: ${safe(dimensions)}.<br>Current run: ${safe(target)}<br>Witness run: ${safe(source)}${others}</div>`;
}

function detailCard(model, run, copy) {
  const events = model.events.filter((event) => event.run_id === run.run_id);
  const rows = PAIRS.map((pair) => {
    const result = model.labels.pairs.get(pair.join("|"))?.get(run.run_id);
    const name = pair.map((key) => (copy ? copy.axes[key].short : META[key].short)).join("–");
    return `<li><strong>${name}: </strong>${copy ? copy.status(result?.nonDominated) : statusText(result)}${result?.witnesses.length ? witness(model, result, copy) : ""}</li>`;
  }).join("");
  const full = model.labels.full.get(run.run_id);
  if (!copy) {
    const zhRows = PAIRS.map((pair) => {
      const result = model.labels.pairs.get(pair.join("|"))?.get(run.run_id);
      const name = pair.map((key) => META[key].short).join("–");
      return `<li><strong>${name}：</strong>${statusText(result)}${result?.witnesses.length ? witness(model, result) : ""}</li>`;
    }).join("");
    const taskRows = events.map((event) => `<tr><td>${safe(event.task_id)}</td><td>${safe(event.destination_id)}</td><td>${fullNumber(event.upload_start_s)} → ${fullNumber(event.upload_end_s)}</td><td>${fullNumber(event.compute_start_s)} → ${fullNumber(event.compute_end_s)}</td><td>${fullNumber(event.return_start_s)} → ${fullNumber(event.return_end_s)}</td><td>${fullNumber(event.completion_s)}</td><td>${fullNumber(event.compute_energy_j)} + ${fullNumber(event.transfer_energy_j)}</td></tr>`).join("");
    return `<article class="detail-card"><h3>${safe(runName(model, run))} <span class="muted">${safe(run.run_id)}</span></h3>
    <div class="metrics"><span>M <strong>${fullNumber(run.makespan_s)} s</strong></span><span>E <strong>${fullNumber(run.energy_j)} J</strong></span><span>L <strong>${fullNumber(run.mean_latency_s)} s</strong></span></div>
    <p class="muted">实例 ${safe(run.instance_id)} · 配置 ${safe(run.policy_config_id)} · ${safe(run.record_origin)}</p>
    <p class="${model.referenceStatus === "complete" ? "" : "warning"}">${model.referenceStatus === "complete" ? "参照集合：同一实例的七个完整候选；筛选不改变标签。" : model.referenceStatus === "fixture_only" ? "手工示例的支配计算，不是正式实验前沿。" : "参照集合未齐，无正式支配标签。"}</p>
    <ul class="status-list">${zhRows}<li><strong>三维 M–E–L：</strong>${statusText(full)}${full?.witnesses.length ? witness(model, full) : ""}</li></ul>
    <div class="table-wrap"><table><thead><tr><th>任务</th><th>节点</th><th>上传 s</th><th>计算 s</th><th>返回 s</th><th>完成 s</th><th>能耗 J（计算 + 传输）</th></tr></thead><tbody>${taskRows}</tbody></table></div></article>`;
  }
  const taskRows = events.map((event) => `<tr><td>${safe(event.task_id)}</td><td>${safe(event.destination_id)}</td><td>${fullNumber(event.upload_start_s)} → ${fullNumber(event.upload_end_s)}</td><td>${fullNumber(event.compute_start_s)} → ${fullNumber(event.compute_end_s)}</td><td>${fullNumber(event.return_start_s)} → ${fullNumber(event.return_end_s)}</td><td>${fullNumber(event.completion_s)}</td><td>${fullNumber(event.compute_energy_j)} + ${fullNumber(event.transfer_energy_j)}</td></tr>`).join("");
  const provenance = model.referenceStatus === "complete"
    ? "Reference set: seven complete candidates on one instance. Filtering does not change labels."
    : model.referenceStatus === "fixture_only"
      ? "Hand-placed dominance calculation, not an experimental front."
      : "Reference set incomplete; no official dominance labels.";
  return `<article class="detail-card"><h3>${safe(runName(model, run, copy))} <span class="muted">${safe(run.run_id)}</span></h3>
    <div class="metrics"><span>M <strong>${fullNumber(run.makespan_s)} s</strong></span><span>E <strong>${fullNumber(run.energy_j)} J</strong></span><span>L <strong>${fullNumber(run.mean_latency_s)} s</strong></span></div>
    <p class="muted">Instance ${safe(run.instance_id)} · configuration ${safe(run.policy_config_id)} · ${safe(run.record_origin)}</p>
    <p class="${model.referenceStatus === "complete" ? "" : "warning"}">${provenance}</p>
    <ul class="status-list">${rows}<li><strong>3D M–E–L: </strong>${copy.status(full?.nonDominated)}${full?.witnesses.length ? witness(model, full, copy) : ""}</li></ul>
    <div class="table-wrap"><table><thead><tr><th>Task</th><th>Node</th><th>Upload s</th><th>Compute s</th><th>Return s</th><th>Completion s</th><th>Energy J (compute + transfer)</th></tr></thead><tbody>${taskRows}</tbody></table></div></article>`;
}

export function detailsHTML(model, snapshot, lang = "zh") {
  const copy = lang === "en" ? text("en") : null;
  const selected = snapshot.selected_run_ids.map((id) => model.runs.find((run) => run.run_id === id)).filter(Boolean);
  if (!selected.length) {
    return copy
      ? `<p class="muted">Select a run to see stored objective values, projected and full-space status, the dominance witness, and task events. Numbers drawn on the charts are display rounding only.</p>`
      : `<p class="muted">选择图中的运行点后，这里会显示完整目标值、各投影与三维状态、支配证据和任务事件。图中的数值只作显示舍入。</p>`;
  }
  return `<div class="details-grid">${selected.map((run) => detailCard(model, run, copy)).join("")}</div>`;
}
