/** Display-only labels; archived records and metric values stay unchanged. */
export function configLabel(model, config) {
  if (model.manifest?.manifest_id === "3a-manual-demo-001" && /^fixture-[a-g]$/.test(config.policy_config_id)) {
    return `Manual placement ${config.policy_config_id.slice(-1).toUpperCase()}`;
  }
  return config.label || config.policy_config_id;
}

export function runLabel(model, run) {
  const config = model.configs.find(item => item.policy_config_id === run.policy_config_id);
  return config ? configLabel(model, config) : run.policy_config_id;
}
