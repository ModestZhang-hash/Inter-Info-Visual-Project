import { defaultAxisRanges, readBundle } from "../3a/model.mjs";
import { createViewState } from "./state.mjs";

export function createSession(bundle) {
  const model = readBundle(bundle);
  const state = createViewState({
    schema_version: "1.0.0",
    current_instance_id: model.instance.instance_id,
    selected_run_ids: [],
    visible_policy_config_ids: model.configs.map((item) => item.policy_config_id),
    axis_ranges: defaultAxisRanges(model.runs),
    pareto_reference_run_ids: model.referenceStatus === "complete" ? model.referenceRuns.map((run) => run.run_id) : [],
    pareto_reference_status: model.referenceStatus,
  });
  return { model, state };
}
