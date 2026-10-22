export function createViewState(initial) {
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
