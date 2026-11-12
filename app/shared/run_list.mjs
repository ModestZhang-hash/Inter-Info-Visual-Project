import { filteredRuns, comparisonRuns } from "./state.mjs?v=unlimited-1";
import { runLabel } from "./labels.mjs";

export const PAGE_SIZE = 20;
export function randomComparisonIds(ids, requestedCount = 10, random = Math.random) {
  if (!Number.isSafeInteger(requestedCount) || requestedCount < 1) throw new RangeError("Enter a positive whole number.");
  const pool = [...new Set(ids)];
  const count = Math.min(requestedCount, pool.length);
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(random() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

export function listPage(model, snapshot, query = "", scope = "matches", page = 0) {
  const term = query.trim().toLowerCase();
  const source = scope === "comparisons" ? comparisonRuns(model, snapshot) : filteredRuns(model, snapshot);
  const rows = source.filter(run => `${run.run_id} ${run.policy_config_id} ${runLabel(model, run)}`.toLowerCase().includes(term))
    .sort((a, b) => a.run_id < b.run_id ? -1 : a.run_id > b.run_id ? 1 : 0);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const index = Math.max(0, Math.min(page, pages - 1));
  return { rows: rows.slice(index * PAGE_SIZE, (index + 1) * PAGE_SIZE), total: rows.length, page: index, pages };
}

function node(tag, text) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  return el;
}
function button(label, action) {
  const el = node("button", label); el.type = "button"; el.addEventListener("click", action); return el;
}

export function mountRunList(container, model, state, controls) {
  const { searchInput, scopeInput, prevButton, nextButton, pageSummary, basket, message, compareMatchesButton, randomCompareButton, randomCountInput, randomFeedback } = controls;
  let page = 0, lastFilter = "";
  if (randomCountInput && !randomCountInput.value) randomCountInput.value = "10";
  if (randomFeedback) randomFeedback.textContent = "";
  searchInput.value = ""; scopeInput.value = "matches";
  const render = snapshot => {
    if (randomFeedback) randomFeedback.textContent = "";
    const key = snapshot.filtered_run_ids.join("|");
    if (key !== lastFilter) { page = 0; lastFilter = key; }
    const result = listPage(model, snapshot, searchInput.value, scopeInput.value, page);
    page = result.page;
    pageSummary.textContent = `${result.total} results · Page ${page + 1} / ${result.pages} · ${PAGE_SIZE} rows per page`;
    prevButton.disabled = page === 0; nextButton.disabled = page + 1 === result.pages;
    message.textContent = snapshot.comparison_error;
    basket.replaceChildren();
    const matching = new Set(snapshot.filtered_run_ids);
    for (const id of snapshot.comparison_run_ids) {
      const item = node("span"); item.className = "comparison-chip";
      const remove = button("×", () => state.removeComparison(id));
      remove.setAttribute("aria-label", `Remove ${id}`);
      item.append(button(`${id}${matching.has(id) ? "" : " (outside filter)"}`, () => state.inspectRun(id)), remove);
      basket.append(item);
    }
    if (!snapshot.comparison_run_ids.length) basket.append(node("span", "No comparisons yet. Add runs below or select a random sample."));
    compareMatchesButton.textContent = `Add all ${snapshot.filtered_run_ids.length} matching runs`;
    if (randomCompareButton) randomCompareButton.disabled = snapshot.filtered_run_ids.length === 0;
    const table = node("table"), head = node("thead"), header = node("tr"), body = node("tbody");
    for (const label of ["Run ID", "Configuration", "M (s) ↓", "E (J) ↓", "L (s) ↓", "Full 3D Pareto", "Actions"]) header.append(node("th", label));
    head.append(header);
    for (const run of result.rows) {
      const row = node("tr"); row.dataset.runId = run.run_id;
      row.dataset.inspected = String(snapshot.inspected_run_id === run.run_id);
      const full = model.labels.full.get(run.run_id);
      for (const value of [run.run_id, runLabel(model, run), run.makespan_s, run.energy_j, run.mean_latency_s, full ? full.nonDominated ? "Non-dominated" : "Dominated" : "Not calculated"]) {
        const cell = node("td", typeof value === "number" ? Number(value.toPrecision(7)).toString() : String(value));
        cell.setAttribute("title", String(value)); row.append(cell);
      }
      const actions = node("td");
      actions.append(button("View evidence", () => state.inspectRun(run.run_id)));
      const comparing = snapshot.comparison_run_ids.includes(run.run_id);
      const compare = button(comparing ? "Remove from comparison" : "Add to comparison", () => comparing ? state.removeComparison(run.run_id) : state.addComparisons([run.run_id]));
      compare.dataset.action = "compare";
      actions.append(compare); row.append(actions); body.append(row);
    }
    table.append(head, body); container.replaceChildren(table);
    if (!result.total) container.append(node("p", "No matching rows. Clear the search or reset exploration filters."));
  };
  const listeners = [
    [searchInput, "input", () => { page = 0; render(state.get()); }],
    [scopeInput, "change", () => { page = 0; render(state.get()); }],
    [prevButton, "click", () => { page--; render(state.get()); }],
    [nextButton, "click", () => { page++; render(state.get()); }],
    [compareMatchesButton, "click", () => state.addComparisons(state.get().filtered_run_ids)],
  ];
  const selectRandom = () => {
    const ids = state.get().filtered_run_ids;
    const requested = randomCountInput ? Number(randomCountInput.value) : 10;
    const invalid = !Number.isSafeInteger(requested) || requested < 1;
    randomCountInput?.setAttribute("aria-invalid", String(invalid));
    if (invalid) {
      if (randomFeedback) randomFeedback.textContent = "Enter a positive whole number. Comparisons were not changed.";
      return;
    }
    if (!ids.length) {
      if (randomFeedback) randomFeedback.textContent = "No matching runs are available.";
      return;
    }
    const selected = randomComparisonIds(ids, requested);
    state.compareRuns(selected);
    if (randomFeedback) randomFeedback.textContent = requested > ids.length
      ? `Requested ${requested}; selected all ${selected.length} available runs.`
      : `Selected ${selected.length} random runs from ${ids.length} available runs.`;
  };
  if (randomCompareButton) listeners.push([randomCompareButton, "click", selectRandom]);
  if (randomCountInput) {
    listeners.push([randomCountInput, "keydown", event => { if (event.key === "Enter") { event.preventDefault(); selectRandom(); } }]);
    listeners.push([randomCountInput, "input", () => { randomCountInput.setAttribute("aria-invalid", "false"); if (randomFeedback) randomFeedback.textContent = ""; }]);
  }
  listeners.forEach(([el, event, handler]) => el.addEventListener(event, handler));
  const unsubscribe = state.subscribe(render);
  return () => { unsubscribe(); listeners.forEach(([el, event, handler]) => el.removeEventListener(event, handler)); };
}
