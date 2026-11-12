# Workbench interface

The canonical English interface is `app/3a/index.html`. Its presentation layer is
`app/3a/workbench.css`, loaded after the existing component styles. This refinement
uses Impeccable's Operate guidance for an academic analysis workbench with familiar
product controls. Impeccable is an authoring tool, not a runtime dependency.

## Layout and visual rules

- Keep dataset provenance and reference status above analysis. Manual fixtures,
  synthetic stress tests and the training slice must remain distinguishable.
- Put comparison actions, configuration visibility and optional axis bounds next
  to the linked views. Keep Matrix as the default and expand a cell for detail.
- Use neutral white surfaces, subdued green navigation and thin separators.
  Strategy colors and shapes belong to the existing data encodings; do not use
  theme changes to redefine them.
- Preserve separate projected 2D, full 3D and comparison markers. Keep all raw
  metric values, units, reference sets and deterministic witness explanations.
- Show concise instructions initially; keep precise semantics in native details
  disclosures. Long run IDs and task records remain available.
- Use visible keyboard focus, labeled inputs, reduced-motion support and tabular
  numerals. At narrow widths, controls stack; large plots and tables scroll within
  their containers instead of compressing the axes further.

## Integration boundaries

The layout preserves the IDs used by `app/3a/app.mjs`. The shared state,
click-to-toggle behavior, dataset loading, CSV export, numeric precision,
Pareto computation are unchanged. The 3D component now uses an orthographic camera
with drag rotation, wheel zoom, keyboard controls and reset. Camera state is local
to the component and persists across shared selection updates; loading another
dataset resets it. Camera changes never rewrite shared axis ranges or Pareto labels.

Presentation changes should go in the workbench stylesheet. Check the manual
fixture, 500-run fixture and training slice after changing layout. Check desktop
and narrow widths, Matrix expansion, linked comparisons, the run list and a
dominated run's evidence. Data under `examples`, `artifacts` and `configs` must not
be rewritten as part of visual styling.

## Verification for this refinement

- 27 JavaScript tests and 28 Python tests passed after the interactive 3D update.
- Impeccable's final detector returned no findings for the HTML and workbench CSS.
- Original data and configuration files were checked against pre-change SHA-256
  hashes and were unchanged.
- Browser checks covered responsive layout, the 500-run comparison view, shared
  comparison membership and dominance evidence. These are implementation checks,
  not evidence of improved user understanding or visualization effectiveness.

## Interactive 3D controls

Drag the plot to rotate (a five-pixel threshold separates a drag from a click).
Use the wheel or Zoom buttons to scale the view; Reset view restores the default
camera without clearing comparisons. Arrow keys rotate a focused plot, +/− zoom,
and Home resets. Camera controls do not trigger continuous or automatic animation.
The cube and ticks provide spatial context; each metric is normalized independently
to its axis range. Tick labels are rounded, while point tooltips and evidence retain
the original values. Points are depth-sorted and overlapping IDs are recomputed for
the current camera. Identical vectors still coincide from every angle and can be
inspected through the run list. On small screens the plot scrolls horizontally to
keep ticks readable. Zooming can move points outside the viewport; Reset view
restores the default framing. No external visualization library or CDN is required.

## Custom comparison size

Random sample size accepts a positive safe integer (default 10). Select random
runs replaces the comparison set with a sample without replacement from the
matching complete runs of the current instance. Requests larger than the pool
select every available run and report the actual count. Invalid input leaves
comparisons unchanged. Search and pagination still affect the list only.
There is no fixed comparison-count cap, including manual additions and Add all.
Matrix shows only comparison runs whenever the set is nonempty; Clear comparisons
or Show all restores the background. The same IDs remain linked across all views.
Larger sets can overlap and take longer to render; counts are not silently reduced.
