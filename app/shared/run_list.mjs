import { filteredRuns, comparisonRuns, COMPARISON_LIMIT } from "./state.mjs?v=workflow-1";
import { runLabel } from "./labels.mjs";

export const PAGE_SIZE = 20;
export function randomComparisonIds(ids, random = Math.random) {
  const pool = [...new Set(ids)];
  const count = Math.min(COMPARISON_LIMIT, pool.length);
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
  const { searchInput, scopeInput, prevButton, nextButton, pageSummary, basket, message, compareMatchesButton, randomCompareButton } = controls;
  let page = 0, lastFilter = "";
  searchInput.value = ""; scopeInput.value = "matches";
  const render = snapshot => {
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
    if (!snapshot.comparison_run_ids.length) basket.append(node("span", "No comparisons yet. Add individual runs below (maximum 10)."));
    compareMatchesButton.textContent = `Add all ${snapshot.filtered_run_ids.length} matching runs (limit ${COMPARISON_LIMIT})`;
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
  if (randomCompareButton) listeners.push([randomCompareButton, "click", () => {
    const ids = state.get().filtered_run_ids;
    if (ids.length) state.compareRuns(randomComparisonIds(ids));
  }]);
  listeners.forEach(([el, event, handler]) => el.addEventListener(event, handler));
  const unsubscribe = state.subscribe(render);
  return () => { unsubscribe(); listeners.forEach(([el, event, handler]) => el.removeEventListener(event, handler)); };
}
