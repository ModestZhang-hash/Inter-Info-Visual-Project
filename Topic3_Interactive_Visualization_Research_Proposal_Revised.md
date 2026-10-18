# Interactive Visualization of Makespan–Energy–Latency Trade-offs in Edge–Cloud Scheduling

**Research proposal — CPS 5745 Interactive Information Visualization**  
**Instructor:** Hamza Djigal  
**Project team:** Two students  
**Project topic:** Topic 3 — Visualizing the Makespan–Energy–Latency Trade-off

## Abstract

Edge–cloud schedulers can trade overall workload completion time, task-related energy, and individual task latency against one another. This project proposes an interactive visualization for comparing complete scheduling runs on matched, simulated task streams. Three pairwise scatterplots will distinguish dominance in a two-objective projection from dominance in the full three-objective space. A linked scatterplot matrix, parallel-coordinates view, and compact 3D reference view will let a reader follow the same run across encodings and inspect the task records behind its metrics. A controlled discrete-event simulator will generate comparable outcomes for six prespecified heuristic configurations and one bounded, fixed deep Q-network (DQN) policy. Independent calculations will check metrics and Pareto labels; scripted cases will check linked interactions and the analytical questions the prototype can answer. The project studies visualization design and reproducible comparison, not a new scheduling algorithm. It recruits no external participants and will make no claims about improved human comprehension or the perceptual superiority of an encoding.

## 1. Research problem and scope

### 1.1 Motivation

Placing a task on a fast remote node may shorten computation but add transfer delay and energy. A local placement can avoid transfer while adding queueing or extending the time until the final task completes. Makespan, energy, and latency therefore describe related but distinct consequences of a scheduling decision. Separate single-metric charts make it difficult to see which complete runs represent trade-offs, which are dominated, and which task and event records produced a plotted point.

The course's Topic 3 asks how to display this three-objective space and whether learned policies find better points on an observed Pareto front than heuristics. We address these questions through an inspectable visualization and a controlled comparison. The scheduler implementations supply data for the visual study; developing a new scheduler or reinforcement-learning method is outside the contribution.

### 1.2 Unit of comparison and permitted claims

One comparison set contains the results of all seven prespecified scheduler configurations applied to **one frozen workload instance**: the same task stream, topology, queue rules, environment parameters, and metric definitions. A run is one completed application of one configuration to that instance. A point's objective vector is linked to its run ID and archived task-event records. Different instances, including instances at the same workload intensity, are separate Pareto comparison sets.

Here a *front* means the observed non-dominated set among the tested candidates for a fixed instance. It is not a globally optimal frontier. The project can support claims about calculation correctness, reproducible scripted analyses, and the behavior of these specific policies under the simulated conditions. Without external participants or a deployment study, it cannot establish usability superiority, improved human understanding, operational energy savings, or a general result about learned policies.

## 2. Research questions and evaluation criteria

### RQ1 — Pairwise representation

How can pairwise scatterplots display makespan–energy, makespan–latency, and energy–latency trade-offs, distinguish projected two-objective dominance from full three-objective dominance, and reveal a valid dominance witness?

Each point will show a stable run ID and objective values. The three plots will mark projected non-dominated membership while a separate indicator reports full-space status. A selected dominated run will expose a run that satisfies the relevant dominance rule on the stated reference set. Independently calculated labels and witnesses are the correctness criterion. Such checks do not establish that viewers interpret the marks as intended.

### RQ2 — Coordinated three-objective analysis

How can a linked scatterplot matrix, parallel coordinates, and a compact 3D reference view support inspection of the same runs while keeping selection, filtering, axes, and dominance reference sets consistent?

The same immutable run IDs will underlie all views and exports. Scripted interface checks will compare selected IDs, tooltips, units, visible counts, and records after filters or instance changes. The three encodings will be compared through documented analytical capabilities and limitations on the same data and cases; no participant-based ranking of the encodings is proposed.

### RQ3 — Scheduler comparison

Across matched, previously unseen simulated workloads, where does one fixed DQN policy lie relative to the six prespecified heuristic configurations in the observed makespan–energy–latency space, and how do paired objective differences vary across workload intensities?

RQ3 is exploratory. We will report unfavorable or weak learned-policy outcomes as well as favorable ones. No directional reward-setting hypotheses are needed because there is only one learned model. Cross-instance summaries use independent task streams as the experimental units, not the tasks nested inside each stream.

| Question | Evidence | Supported conclusion |
| --- | --- | --- |
| RQ1 | Independent two- and three-objective calculations, including disagreements between their classifications; verified witness IDs | Correct representation of the stated dominance rules for the tested records |
| RQ2 | Scripted linked-selection, filtering, value, axis, and export checks on archived runs | The prototype supports the specified inspection tasks consistently |
| RQ3 | Seven matched outcomes per held-out instance; within-instance dominance and paired differences across independent streams | Descriptive conclusions about the tested DQN and heuristic configurations in this simulator |

## 3. Related work and specific gap

The Topic 3 brief names Sedlmair, Meyer, and Munzner's *Design Study Methodology* [1] and Muelder and colleagues' *Visual Analysis of Cloud Computing Performance* [2] as the two seed papers. Sedlmair, Meyer, and Munzner describe design study methodology involving a real domain problem, domain experts, iterative design, and validation [1]. This no-participant course project uses explicit data and task abstraction but does not present itself as a completed field design study. Munzner's nested model separates domain and task characterization, data and task abstraction, visual encoding and interaction, and algorithm implementation [3]. This separation helps us state precisely which levels our computational and interface checks address.

Muelder and colleagues examine cloud performance interactively through behavioral lines [2]. Their temporal cloud-performance diagnosis differs from comparing alternative edge–cloud scheduling outcomes on one fixed workload. PAVED is cited in the earlier proposal as related work on Pareto-front visualization for engineering design [4]; its methods and evaluation evidence will be checked against the paper in the related-work review. We do not claim to invent Pareto visualization, scatterplot matrices, parallel coordinates, or 3D projections. The bounded contribution is an edge–cloud comparison in which projected and full-space dominance are separately labeled, candidate scheduler outcomes are matched by instance, and each view resolves to the same run and task records. The Week 7 related-work draft will verify citation details and expand the search from the two seed papers toward the course's approximate 16–20-paper reading target. Every paper ultimately cited must have a documented path of at most two citation hops from a seed paper. This proposal does not claim that its present four references constitute the complete review or that their citation paths have already been checked.

## 4. Proposed contribution and team responsibilities

The primary contribution is a linked visual analysis workflow with explicit Pareto semantics and auditable records. The accompanying simulation and analysis protocol exists to provide fair, reproducible input and to verify what the views show. It is not an algorithmic contribution.

| Course component | Primary owner | Deliverable and separately documentable work |
| --- | --- | --- |
| 3A — pairwise views | Member A | Three pairwise scatterplots, projected non-dominated marks, distinct full-space status, and a linked dominance-witness explanation; calculation and view checks |
| 3B — coordinated views | Member B | Scatterplot matrix, parallel coordinates, and a compact same-data 3D reference view; linked identity, filter, axis, and value checks |
| 3C — scheduler comparison | Both members | Shared simulator and policy interface, matched runs, quantitative comparison, independent metric and dominance checks, and reproducible analysis cases |

The course brief labels 3A, 3B, and 3C as team roles; the allocation above adapts these components to this project's two members. The members will agree on their internal allocation and jointly deliver 3C. Each will document distinct view designs, view-specific check cases and results, and a separately identifiable methods-and-results contribution. Shared scheduler records allow same-data visual comparison but do not replace that individual evidence. The compact 3D view is part of the **baseline 3B scope**, not a contingent extension. Deeper 3D design may be considered after the core project works, if time permits. The proposal will explain what each encoding makes inspectable and where it is limited, without claiming a human-subject comparison.

## 5. Data, simulator, and policy methods

### 5.1 Study units, identifiers, and records

A workload instance is an arrival-ordered stream of independent tasks with a fixed topology, queue rules, environment parameters, and seed. Each task has a unique immutable task ID. Each run has a unique immutable run ID that resolves to an instance ID, policy configuration ID, policy seed, simulator version, and DQN checkpoint ID where applicable. Stored task-event records will include arrival, required cycles, upload and return sizes, assigned node, upload/compute/return start and end times, completion, queue delays, and separate computation and transfer energy. Run records will include completion status, parameters, the workload-stream identifier, and the three objective values. Joins and exported records will preserve these IDs.

Training, pilot, and held-out evaluation will use disjoint instance seeds. All seven candidates in a comparison set replay the same frozen task stream. The random policy's own seed is logged, and no policy can observe future arrivals.

### 5.2 Bounded discrete-event simulator

The proposed topology has three heterogeneous edge nodes and one cloud node; one edge node is colocated with the gateway. An arriving task is assigned to one destination, without preemption or reassignment. Nonlocal tasks upload before computation and complete only after any modeled return transfer. Compute and transfer queues operate first-in, first-out. Each destination's modeled transfer channel and single-server compute queue have declared capacities. The model excludes task dependencies, node failures, background traffic, and shared-bandwidth contention across destinations. These exclusions limit external validity.

The **provisional pilot** uses 80 tasks per stream; edge compute capacities of about 2, 3, and 4 gigacycles/s; cloud capacity of about 8 gigacycles/s; task requirements sampled uniformly over 0.5–2.0 gigacycles; uploads over 0.5–2.0 MB; and returned data of 10% of uploaded data. The colocated edge has no modeled transfer. Nonlocal edge links provisionally use 30 Mb/s, and the cloud link 10 Mb/s. Low, medium, and high conditions use exponential interarrival times with initial offered-load targets of approximately 0.35, 0.70, and 1.05 relative to aggregate edge capacity. These numbers are assumptions for a pilot, not measured facts about a real system. Pilot evidence may justify changes that improve queueing and visible trade-offs; all final values will be recorded and frozen by Week 10 before held-out outcomes are inspected.

A public trace may calibrate a clearly mapped feature such as arrival spacing or task-size distribution, provided units, provenance, and license are suitable. The study remains fully executable with synthetic workloads. Published results from unrelated scheduling experiments cannot replace matched simulator runs.

### 5.3 Prespecified scheduler configurations

Every configuration chooses among the same four feasible destinations from information available at the arrival decision. Deterministic score ties use a fixed node order unless a policy explicitly uses a logged random seed. The six heuristic configurations and one learned policy are:

| Configuration | Decision rule |
| --- | --- |
| Random | Uniform feasible-destination choice with a recorded policy seed |
| Latency-first | Minimize projected end-to-end completion time under current queues |
| Energy-first | Minimize projected incremental computation-plus-transfer energy |
| Balanced, equal weights | Minimize a normalized projected score for makespan increase, task energy, and task latency, weighted (1/3, 1/3, 1/3) |
| Balanced, makespan emphasis | Use the same score with weights (0.6, 0.2, 0.2) |
| Balanced, energy emphasis | Use the same score with weights (0.2, 0.6, 0.2) |
| One compact DQN | Choose one of the same four destinations from current normalized task and per-node state features using a frozen checkpoint and greedy inference |

The three balanced settings are predeclared configurations of one heuristic family, not three newly developed algorithms. Their normalization scales are derived only from training or pilot data and frozen before held-out evaluation. Each policy uses the same simulator state and metric definitions; the DQN receives normalized task attributes and current per-node queue, transfer, projected completion-time, and energy features. The exact feature encoding and tie rules will be recorded in the fixed design.

### 5.4 Bounded DQN training and evaluation

The learned comparator is one DQN, provisionally with two hidden layers of 64 units. A directly compatible public pretrained checkpoint has not been verified for this simulator's state and action definitions; weights from a different environment cannot serve as a valid comparator. Licensed public source code may inform implementation after its assumptions and interface are reviewed. Training uses one recorded seed and at most 500 complete 80-task episodes, or 40,000 placement decisions. This is a feasibility ceiling, not a target for tuning until the policy wins. There will be no architecture sweep, reward-weight comparison, extensive hyperparameter search, or retraining in response to held-out results. A checkpoint-selection rule and feasible training budget will be fixed before final evaluation; held-out inference is greedy and does not update the model.

The complete-run training target is

$$
R=-\frac{1}{3}\left(\frac{M}{s_M}+\frac{E}{s_E}+\frac{L}{s_L}\right),
$$

where $s_M,s_E,s_L>0$ are scales estimated only from training or pilot data and then frozen. The provisional finite-episode discount is $\gamma=1$, so a correctly constructed reward ledger can sum to the complete-run objective. Before final training, logged reward components and delayed task completions will be checked against an independent calculation of $R$. The checkpoint, training seed, number of complete episodes, and final selection rule will be archived. If the bounded pilot cannot produce valid assignments, the failure will be documented and discussed with the instructor before narrowing the learned-policy part of RQ3. A valid but weak DQN result remains reportable.

## 6. Objectives and Pareto semantics

### 6.1 Primary metrics and energy boundary

All three primary objectives are minimized and calculated only after every task in a fixed-size instance finishes. For task $i$, let $a_i$ be arrival time and $c_i$ be completion after computation and any modeled return transfer. For $N$ tasks:

$$
M=\max_i(c_i)-\min_i(a_i),\qquad
L=\frac{1}{N}\sum_{i=1}^{N}(c_i-a_i),\qquad
E=\sum_{i=1}^{N}\left(E_{\mathrm{compute},i}+E_{\mathrm{transfer},i}\right).
$$

Makespan $M$ and mean end-to-end task latency $L$ are measured in seconds; modeled task-related energy $E$ is measured in joules. Computation energy uses an assumed task-active power increment over idle for the task's compute duration. Transfer energy charges modeled upload and return traffic on nonlocal hops using declared link-energy assumptions. The continuously consumed idle baseline of devices and networks is excluded. Computation and transfer terms are logged separately so totals can be rebuilt. Thus $E$ must be described as **modeled task-related computation-plus-transfer energy**, not total deployment electricity. All power and link-energy constants will be documented as simulation assumptions.

Incomplete or timed-out runs have an explicit failure record and do not receive a numeric three-objective point; counts will be reported by policy. The 95th percentile of task latency and scheduler decision time may be reported as secondary diagnostics, never as extra Pareto objectives.

### 6.2 Dominance and reference sets

For minimization vectors $x$ and $y$ in the *same fixed-instance candidate set*, $x$ dominates $y$ if it is no larger on every objective being compared and strictly smaller on at least one. Exact ties do not dominate each other. A projected test uses only the two displayed objectives; the full-space test uses all three. Labels are calculated from stored, unrounded values under a documented numerical comparison tolerance selected before final runs. Plot rounding does not alter the labels.

The default reference set is the seven prespecified candidate runs for the selected instance. Scheduler filters and brushes change visibility, not this reference set or its dominance labels. If any visible-subset recomputation is later offered, it must be separately labeled. Changing the instance loads a new comparison set. No front mixes task streams or workload levels. A candidate can be **dominated in a two-objective projection yet non-dominated in three objectives**, because the third objective can reverse the relation; with the same candidates and minimization rule, the reverse classification cannot occur.

## 7. Visualization and interaction design

### 7.1 Pairwise views (3A)

The three scatterplots display makespan–energy, makespan–latency, and energy–latency. One point represents one complete run. Axis labels show units and the minimization direction. Stable color and shape mappings distinguish configurations and policy families, supported by a text legend rather than color alone. Each pairwise view marks its projected non-dominated points, while a separate indicator shows full three-objective status. A selected dominated point opens the relevant objective values and a deterministic valid witness run ID; if several runs dominate it, the others remain inspectable. The explanation names the dimensions and reference set used for that witness.

### 7.2 Coordinated views (3B)

A scatterplot matrix, parallel-coordinates view, and compact 3D reference view display the same selected instance and run IDs. They reuse the recorded values, units, policy encodings, and selection state. The 3D view is a baseline, same-data reference for examining the joint space and participates in linked point selection. A documented comparison will identify how each encoding handles pairwise trade-offs, joint three-objective patterns, run identification, and occlusion in the project's scripted cases. It will not claim a measured perceptual ranking.

Selections and brushes highlight the same run in all views and resolve to its task-event records. Filters report visible counts and do not silently recalculate the default front. Axis ranges and normalization behavior are explicit; a filter will not silently rescale an axis. Changing workload instance updates all views and clears any selection whose run ID is absent. Tooltips and exports use the same stored record and preserve full numeric values even when labels are visually rounded.

## 8. Experimental design and evaluation

### 8.1 Provisional matched evaluation matrix

The proposed held-out matrix is three workload-intensity levels × 12 independent task streams per level × seven fixed scheduler configurations. This yields **36 within-instance comparison sets** and **252 complete-run outcomes before failures**. A separate pilot will measure runtime, completion rates, queueing, and whether the conditions expose useful trade-offs. If necessary, the number of streams or provisional parameters will be changed with a stated reason and frozen by Week 10, before final outcomes are inspected. Pilot and training streams are disjoint from held-out streams.

Each of the seven configurations runs on the same frozen task stream within an instance. Primary reporting includes $M$, $E$, and $L$ for every valid complete run, the full-space non-dominated status, and any dominance witness. Instance-level fronts remain separate even when their summaries are shown side by side.

### 8.2 Paired descriptive analysis

For each instance and each heuristic configuration, we compute signed **DQN minus heuristic** differences in $M$, $E$, and $L$. By workload intensity and heuristic configuration, we report the median paired difference and interquartile range. If 95% bootstrap intervals for medians are displayed, the resampling unit will be the complete instance ID, not individual tasks. The policy-by-objective comparisons are descriptive and exploratory. We also count the number of instances in which each of the seven candidates is observed non-dominated and report unfavorable results and failures. These counts do not justify a family-wide claim about all learned or heuristic schedulers.

Hypervolume, distance to an ideal point, extensive sensitivity analysis, multiple DQN checkpoints, and training-cost comparison are outside the core deliverable. Decision time and 95th-percentile latency are diagnostics only.

### 8.3 Independent calculation checks

A separate metric calculation will rebuild $M$, $L$, computation energy, and transfer energy from archived task-event logs and compare them with run records. Fixtures will cover a local task, upload plus return transfer, queueing, unequal node speeds, late final completion, incomplete runs, and duplicate IDs. An incomplete run or ambiguous ID must produce an explicit error or failure record rather than a plotted objective vector.

A separate Pareto implementation will enumerate candidate pairs to calculate both projected and full-space dominance. Hand-checked fixtures will cover strict dominance, exact ties, equality on one axis, and a case that is dominated in 2D but non-dominated in 3D. Rendered labels and displayed witness IDs must agree with independent results on the fixtures and final comparison sets.

### 8.4 Linked-interface checks and analysis cases

Interface checks will verify run IDs, selected and exported records, tooltip values, axes, units, filtered counts, and the stated dominance reference set across all views. Scripted analysis cases will use prespecified selection rules and independently computed expected answers:

| Case | Question and auditable result |
| --- | --- |
| Energy under a latency ceiling | For a fixed instance and a threshold set from pilot/training data, identify the eligible run with minimum energy or explicitly report that none qualifies. |
| DQN versus every heuristic | For one fixed instance, show the DQN-minus-heuristic differences in all three objectives for each of the six heuristic configurations, full-space status, and any valid dominance witness. |
| Projected versus full-space dominance | Select a prespecified case whose two classifications differ and explain the third-objective value responsible. |
| Workload-intensity comparison | Compare level-specific paired summaries and within-instance fronts without pooling distinct task streams into one front. |

Case-selection rules, thresholds, and candidate instance IDs will be fixed before inspecting held-out scheduler outcomes. If a planned held-out case has no qualifying run, that outcome will be reported rather than replaced by a favorable example. These checks establish computation and interaction correctness, not external usability or perceptual superiority.

### 8.5 Reproducibility and ethics

The project archive will include the simulator version, parameter manifest, frozen seed lists and workload streams, policy definitions, one DQN checkpoint and its training record, task-event logs, analysis scripts, and visualization exports. Re-execution of a fixed configuration should reproduce objective vectors and dominance labels within the declared tolerance. The Topic 3 brief identifies a light ethics-review category. The Week 6 ethics form will describe our no-participant, no-external-expert design; its actual classification remains subject to the instructor and institution.

## 9. Course schedule and decision gates

| Week | Deliverable or decision |
| --- | --- |
| 6 | Written proposal and ethics form |
| 7 | Related-work draft with verified citations and relevance |
| 8 | Prototype and data pipeline v1; shared run/task schema and policy interface |
| 9 | Pilot complete: queueing, energy accounting, runtime, reward ledger, and visualization cases checked |
| 10 | Hard design freeze: simulator parameters, policy definitions, DQN training budget and checkpoint rule, instance seeds, evaluation size, Pareto semantics, and analysis-case rules; the course brief states that a team missing this gate loses its experimental condition |
| 11 | Held-out data collection complete, with failure counts and archived event logs |
| 12 | Full paper draft v1, including analysis and validation evidence |
| 13 | Two peer reviews written; incorporate received feedback where feasible |
| 14 | Final paper |
| 15 | Presentation of 3A, 3B, and shared 3C outcomes |

## 10. Expected outcomes and limitations

We expect a working linked visualization that makes two- and three-objective dominance explicit and lets readers trace candidate points to complete run and task records. We also expect a reproducible, matched dataset and a descriptive account of where the one fixed DQN lies relative to the prespecified heuristic configurations. A negative or weak DQN comparison remains a valid result if the policy generates valid runs and the analysis is reported consistently.

External validity is limited by the small topology, synthetic independent tasks, FIFO queues, fixed routing and bandwidth, and assumed computation and transfer energy parameters. Optional public-trace calibration would validate only the feature actually mapped from that trace, not the whole simulator. Our energy metric excludes idle-baseline electricity. Training one DQN with one seed cannot characterize learned scheduling methods generally. A small number of independent streams may leave paired estimates imprecise. Computational and scripted interface validation cannot establish how external users interpret the views.

The project has two members, and their division of 3A, 3B, and shared 3C is an internal team decision. The compact, same-data 3D reference view is included in the baseline 3B deliverable; more elaborate 3D features are optional enhancements after the core requirements are met. The final report will state these scope choices and the limits of its evidence plainly.

## References

[1] M. Sedlmair, M. Meyer, and T. Munzner, “Design study methodology: Reflections from the trenches and the stacks,” *IEEE Transactions on Visualization and Computer Graphics*, vol. 18, no. 12, pp. 2431–2440, 2012. doi: 10.1109/TVCG.2012.213.

[2] C. Muelder, B. Zhu, W. Chen, H. Zhang, and K.-L. Ma, “Visual analysis of cloud computing performance using behavioral lines,” *IEEE Transactions on Visualization and Computer Graphics*, vol. 22, no. 6, pp. 1694–1704, 2016. doi: 10.1109/TVCG.2016.2534558.

[3] T. Munzner, “A nested model for visualization design and validation,” *IEEE Transactions on Visualization and Computer Graphics*, vol. 15, no. 6, pp. 921–928, 2009. doi: 10.1109/TVCG.2009.111.

[4] L. Cibulski, H. Mitterhofer, T. May, and J. Kohlhammer, “PAVED: Pareto front visualization for engineering design,” *Computer Graphics Forum*, vol. 39, no. 3, pp. 405–416, 2020. doi: 10.1111/cgf.13990.
