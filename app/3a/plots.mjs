import { OBJECTIVES, PAIRS } from "./pareto.mjs";
import { drawPairScatter } from "../shared/pair_scatter.mjs";
import { POLICY_COLORS, stableConfigIndex } from "../shared/encoding.mjs";
import { text } from "../shared/copy.mjs";

const number = (value) => Number.isFinite(value) ? Number(value.toPrecision(7)).toString() : "—";
const fullNumber = (value) => Number.isFinite(value) ? String(value) : "—";

export function mountPairPlots(container, model, sharedState, options = {}) {
  if (!container) throw new Error("Pair-plot container is required");
  const copy = text(options.lang);
  const render = (snapshot) => {
    const visible = model.runs.filter((run) =>
      run.instance_id === snapshot.current_instance_id &&
      run.status === "complete" &&
      snapshot.visible_policy_config_ids.includes(run.policy_config_id));
    container.replaceChildren();
    for (const pair of PAIRS) {
      const [xKey, yKey] = pair;
      const card = document.createElement("article");
      card.className = "plot";
      const heading = document.createElement("h3");
      heading.textContent = `${copy.axes[xKey].short} – ${copy.axes[yKey].short}`;
      const subtitle = document.createElement("p");
      subtitle.textContent = model.referenceStatus === "complete"
        ? copy.completeSubtitle
        : model.referenceStatus === "fixture_only"
          ? copy.fixtureSubtitle
          : copy.incompleteSubtitle;
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      drawPairScatter(svg, {
        runs: visible,
        xKey,
        yKey,
        xRange: snapshot.axis_ranges[xKey],
        yRange: snapshot.axis_ranges[yKey],
        selectedRunIds: snapshot.selected_run_ids,
        projectedLabels: model.labels.pairs.get(pair.join("|")),
        fullLabels: model.labels.full,
        axisLabels: Object.fromEntries(OBJECTIVES.map((key) => [key, copy.axes[key].label])),
        encodeRun: (run) => {
          const index = stableConfigIndex(model.configs, run.policy_config_id);
          return { index, color: POLICY_COLORS[index % POLICY_COLORS.length] };
        },
        tooltip: (run, projected, full) => {
          const config = model.configs.find((item) => item.policy_config_id === run.policy_config_id);
          const name = copy.displayName(config?.label, run.policy_config_id);
          return `${name} | ${run.run_id}\nM=${fullNumber(run.makespan_s)} s, E=${fullNumber(run.energy_j)} J, L=${fullNumber(run.mean_latency_s)} s\n${copy.dominanceLine(projected, full, copy.status)}`;
        },
        onSelect: (id, shift) => sharedState.selectRuns(shift ? [...sharedState.get().selected_run_ids, id] : [id]),
        onBrush: (ids, shift) => sharedState.selectRuns(shift ? [...sharedState.get().selected_run_ids, ...ids] : ids),
        formatValue: number,
        emptyLabel: copy.emptyPlot,
      });
      card.append(heading, subtitle, svg);
      container.append(card);
    }
  };
  return sharedState.subscribe(render);
}

