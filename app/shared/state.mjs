export function createViewState(initial, options = {}) {
  if (options.runs) return createExplorationState(initial, options.runs);
  let current = structuredClone(initial);
  const listeners = new Set();
  const publish = () => listeners.forEach((listener) => listener(get()));
  const get = () => structuredClone(current);
  const update = (patch) => {
    current = { ...current, ...structuredClone(patch) };
    publish();
  };
  return {
    get,
    subscribe(listener) {
      listeners.add(listener);
      listener(get());
      return () => listeners.delete(listener);
    },
    selectRuns(ids) {
      update({ selected_run_ids: [...new Set(ids)] });
    },
    setVisibleConfigs(ids) {
      update({ visible_policy_config_ids: [...new Set(ids)] });
    },
    setAxisRange(objective, range) {
      update({ axis_ranges: { ...current.axis_ranges, [objective]: { ...range } } });
    },
    changeInstance(instanceId, runIds, configIds, axisRanges, referenceIds, referenceStatus) {
      const allowed = new Set(runIds);
      update({
        current_instance_id: instanceId,
        selected_run_ids: current.selected_run_ids.filter((id) => allowed.has(id)),
        visible_policy_config_ids: [...configIds],
        axis_ranges: structuredClone(axisRanges),
        pareto_reference_run_ids: [...referenceIds],
        pareto_reference_status: referenceStatus,
      });
    },
  };
}

export const COMPARISON_LIMIT = 10;

// Bound datasets enable the overview/filter/compare workflow. The legacy
// selected_run_ids field is a synchronized alias for the comparison set.
function createExplorationState(initial, records) {
  let runs = records;
  let current = { ...structuredClone(initial), run_filters: {}, filtered_run_ids: [],
    comparison_run_ids: [], selected_run_ids: [], inspected_run_id: null, comparison_error: "" };
  const listeners = new Set();
  const eligible = () => runs.filter(run => run.instance_id === current.current_instance_id && run.status === "complete");
  const validIds = ids => {
    const allowed = new Set(eligible().map(run => run.run_id));
    return [...new Set(ids)].filter(id => allowed.has(id));
  };
  const refresh = () => {
    const constraints = Object.values(current.run_filters).map(ids => new Set(ids));
    current.filtered_run_ids = eligible().filter(run => current.visible_policy_config_ids.includes(run.policy_config_id)
      && constraints.every(ids => ids.has(run.run_id))).map(run => run.run_id);
  };
  const get = () => structuredClone(current);
  const publish = () => { refresh(); listeners.forEach(listener => listener(get())); };
  const compare = ids => {
    const next = validIds(ids);
    if (next.length > COMPARISON_LIMIT) {
      current.comparison_error = `Cannot compare ${next.length} runs. The limit is ${COMPARISON_LIMIT}. Narrow the results or remove runs first. Nothing was added.`;
      publish();
      return false;
    }
    current.comparison_run_ids = next;
    current.selected_run_ids = [...next];
    current.comparison_error = "";
    if (!current.inspected_run_id && next.length) current.inspected_run_id = next[0];
    publish();
    return true;
  };
  refresh();
  return {
    get,
    subscribe(listener) { listeners.add(listener); listener(get()); return () => listeners.delete(listener); },
    selectRuns: compare,
    compareRuns: compare,
    toggleComparison(id) {
      if (!validIds([id]).length) return false;
      current.inspected_run_id = id;
      return compare(current.comparison_run_ids.includes(id)
        ? current.comparison_run_ids.filter(item => item !== id)
        : [...current.comparison_run_ids, id]);
    },
    showAllRuns(axisRanges) {
      current.visible_policy_config_ids = [...new Set(eligible().map(run => run.policy_config_id))];
      current.run_filters = {};
      current.axis_ranges = structuredClone(axisRanges);
      current.comparison_run_ids = [];
      current.selected_run_ids = [];
      current.comparison_error = "";
      publish();
    },
    addComparisons(ids) { return compare([...current.comparison_run_ids, ...ids]); },
    removeComparison(id) { return compare(current.comparison_run_ids.filter(item => item !== id)); },
    inspectRun(id) { current.inspected_run_id = validIds([id])[0] ?? null; publish(); },
    filterRuns(ids, { source = "matrix", append = false } = {}) {
      current.run_filters[source] = validIds(append ? [...(current.run_filters[source] ?? []), ...ids] : ids);
      current.comparison_error = "";
      publish();
    },
    clearFilters(source) {
      if (source) delete current.run_filters[source]; else current.run_filters = {};
      publish();
    },
    setVisibleConfigs(ids) { current.visible_policy_config_ids = [...new Set(ids)]; delete current.run_filters.parallel; publish(); },
    setAxisRange(key, range) { current.axis_ranges = { ...current.axis_ranges, [key]: { ...range } }; delete current.run_filters.parallel; publish(); },
    changeInstance(instanceId, runIds, configIds, axisRanges, referenceIds, referenceStatus, nextRuns = []) {
      runs = nextRuns;
      current = { ...current, current_instance_id: instanceId, run_filters: {}, comparison_run_ids: [], selected_run_ids: [],
        inspected_run_id: null, comparison_error: "", visible_policy_config_ids: [...configIds], axis_ranges: structuredClone(axisRanges),
        pareto_reference_run_ids: [...referenceIds], pareto_reference_status: referenceStatus };
      publish();
    },
  };
}

export function filteredRuns(model, snapshot, excludeSource = null) {
  const constraints = Object.entries(snapshot.run_filters ?? {}).filter(([source]) => source !== excludeSource).map(([, ids]) => new Set(ids));
  return model.runs.filter(run => run.status === "complete" && run.instance_id === snapshot.current_instance_id
    && snapshot.visible_policy_config_ids.includes(run.policy_config_id) && constraints.every(ids => ids.has(run.run_id)));
}

export function comparisonRuns(model, snapshot) {
  const ids = new Set(snapshot.comparison_run_ids ?? snapshot.selected_run_ids);
  return model.runs.filter(run => run.instance_id === snapshot.current_instance_id && run.status === "complete" && ids.has(run.run_id));
}
