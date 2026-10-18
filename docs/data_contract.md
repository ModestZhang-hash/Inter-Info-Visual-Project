# Topic 3 数据契约（双人审查草案）

状态：**草案，待成员 A、B 逐项审查**。本文件定义后续 P1–P3 使用的记录边界；`examples/contract/` 中的数据仅为手工算例，不是模拟器、pilot、训练或留出集结果。审查通过前，字段或规则的变更应在两人之间同步。

## 1. 文件、版本与标识

- 使用 UTF-8 JSON 保存 `ExperimentManifest`、`WorkloadInstance`、`RunRecord`；使用 UTF-8 JSONL 保存 `TaskEvent`，一行一条事件。`schema_version` 暂为 `1.0.0`，每个顶层文件或 JSONL 行均须带此字段。读取器遇到未知主版本、缺少必填字段、错误类型或非有限数值，应明确报错，不应静默补默认值。扩展或修改字段语义时提升契约版本并保留旧文件。
- `manifest_id` 指向不可变参数快照；`instance_id` 在项目归档中唯一，指向一份冻结任务序列及其清单；`run_id` 在项目归档中唯一，指向一个实例、一个策略配置、一个策略种子和一次执行。`task_id` 在同一实例内唯一。重新执行如需保留新结果，应创建新 `run_id`，不得覆写旧结果。
- ID 可由稳定输入生成，或由版本化清单显式映射。比较文件时按 ID 和内容校验，不能仅凭文件名推断相同实例。路径均相对清单文件所在目录解析；归档搬迁时不得改变 ID 或内容。正式生成数据建议另存内容摘要以辅助核查。
- 单位固定：时间为秒（`_s`），计算量为 cycles（`_cycles`），数据量为字节（`_bytes`），能耗为焦耳（`_j`），功率为瓦（`_w`），链路速率为 bit/s（`_bps`）。本项目 `1 MB = 1,000,000 bytes`、`1 Mb/s = 1,000,000 bit/s`、`1 byte = 8 bits`。所有原始数值不得用展示时的四舍五入值替换。
- `null` 是明确的“不适用/尚无值”，不能与 `0` 混用。字段必须存在；不存在的可选阶段用 JSON `null`。种子是非负整数，确定性且不用随机数的策略可填 `null`。同一归档中不允许同名 ID 指向不同内容。

## 2. `ExperimentManifest`

| 字段 | 类型与含义 |
| --- | --- |
| `schema_version`, `manifest_id` | 非空字符串；契约版本与不可变清单 ID |
| `phase` | `fixture`、`training`、`pilot`、`held_out` 之一；`fixture` 不计入实验 |
| `topology.gateway_node_id` | 本地共址节点 ID |
| `topology.nodes[]` | 每项含唯一 `node_id`、`kind`（`edge`/`cloud`）、正数 `compute_capacity_cycles_per_s`、非负 `active_compute_power_increment_w`；非本地节点还需正数 `link_rate_bps`、非负 `transfer_energy_j_per_mb`，本地节点两项为 `null` |
| `queue_rules` | 决策时点、计算及传输 FIFO、各节点单服务器、无抢占/改派、无未来到达信息、返回传输规则；实现须按已归档版本解释 |
| `workload_distribution` | 生成分布与参数；手工样例注明 `manual_fixture`，不伪称抽样 |
| `seed_splits` | 各阶段实例生成种子的列表；正式训练、pilot、留出集不得交叉，样例种子仅在 `fixture` 中 |
| `policy_configs[]` | 唯一 `policy_config_id`、策略族和参数；正式七配置在设计冻结清单中定稿，手工样例可用 `manual_fixture` |
| `software_versions` | 生成器、模拟器、指标计算器版本；未实现时写 `null`，不得编造版本 |
| `numeric_tolerance` | 独立重算与支配比较所用的绝对/相对容差，须在正式评价前冻结；正式支配逻辑须明确如何应用 |
| `raw_data_paths` | 实例、运行、事件日志的相对路径列表/映射；失败运行也应指向其可用日志 |

清单内容一经用于生成记录即保持不可变。参数、规则、种子分割或容差变化须产生新 `manifest_id`，并记录变更理由；不得修改旧运行所引用的清单。手工样例中的数值只是验证文件关系及算术的夹具参数。

## 3. `WorkloadInstance` 与任务

| 字段 | 类型与规则 |
| --- | --- |
| `schema_version`, `instance_id`, `manifest_id` | 必填非空字符串；清单必须能解析 |
| `phase`, `intensity_label` | 阶段与强度标签；样例分别用 `fixture`、`example`，不冒充低/中/高负载 |
| `environment_seed`, `task_generation_seed` | 非负整数；手工夹具用记录下来的任意固定整数，仅作标识，不表示曾调用生成器 |
| `tasks[]` | 非空、按 `(arrival_s, task_id)` 排序的完整冻结任务列表 |

每个任务必须有唯一非空 `task_id`、非负有限 `arrival_s`、正数 `compute_cycles`、非负整数 `upload_bytes` 与 `return_bytes`。`return_bytes` 不得隐含为上传量的百分比；必须把已生成的实际字节数存入实例。不同策略在同一 `instance_id` 上读取完全相同的任务内容，不得重新采样。清单拓扑和参数由 `manifest_id` 锁定。

## 4. `TaskEvent` 与运行时序

每条 JSONL 事件包含 `schema_version`、`run_id`、`instance_id`、`task_id`、`destination_id`、`status`、`upload_start_s`、`upload_end_s`、`compute_start_s`、`compute_end_s`、`return_start_s`、`return_end_s`、`completion_s`、`compute_energy_j`、`transfer_energy_j`。`status` 仅为 `complete` 或 `failed`；如为 `failed`，还须有非空 `failure_reason`，未发生阶段及不可确定的完成/能耗字段写 `null`。完整事件的 `failure_reason` 必须为 `null`。

- 每个 `(run_id, task_id)` 最多一条最终事件；完整运行须恰好覆盖实例的所有任务，不能有陌生任务或重复事件。`destination_id` 必须存在于所引清单。事件中的 `instance_id` 必须与运行及实例一致。
- 完整事件须满足 `arrival_s ≤ upload_start_s ≤ upload_end_s ≤ compute_start_s ≤ compute_end_s ≤ return_start_s ≤ return_end_s = completion_s`，但不适用的阶段跳过。到本地共址节点时，四个上传/返回时间字段均为 `null`，`completion_s = compute_end_s`，`transfer_energy_j = 0`。非本地节点必须有上传和返回阶段；零字节阶段可零时长，但仍记录开始/结束。
- 非本地任务在返回传输结束后才完成。完整事件的两项能耗必须为非负有限数。按清单，计算能耗 = 计算时长 × 节点任务活跃功率增量；非本地传输能耗 = `(upload_bytes + return_bytes) / 1,000,000 × transfer_energy_j_per_mb`。排队等待不计入任务活跃计算能耗，设备/网络持续空闲基线不计入 `E`。后续模拟器还须检查资源 FIFO 与链路时长；本夹具只覆盖基本阶段和引用关系。

## 5. `RunRecord` 与指标

| 字段 | 类型与规则 |
| --- | --- |
| `schema_version`, `run_id`, `instance_id`, `manifest_id`, `policy_config_id` | 必填非空字符串；必须与实例、清单和配置相互引用一致 |
| `policy_seed` | 非负整数或 `null`；随机策略必须提供整数 |
| `simulator_version` | 实际执行的模拟器版本；手工记录用 `null` |
| `dqn_checkpoint_id` | 仅 DQN 运行使用非空 ID；其余为 `null` |
| `record_origin` | `simulation` 或 `manual_fixture`；正式实验仅接受前者 |
| `status`, `failure_reason` | `complete` 或 `failed`；完整运行原因 `null`，失败运行原因必为非空文本 |
| `task_count` | 实例任务数，正整数；不等于已完成事件数时运行不能标为完整 |
| `makespan_s`, `energy_j`, `mean_latency_s` | 完整运行均为非负有限数；失败运行三项均为 `null`，不得绘制为 Pareto 点 |
| `event_log_path` | 事件 JSONL 相对清单目录的路径 |

从归档事件和实例任务独立重算：

\[
M=\max_i c_i-\min_i a_i,\qquad
L=\frac{1}{N}\sum_i(c_i-a_i),\qquad
E=\sum_i(E_{\mathrm{compute},i}+E_{\mathrm{transfer},i}).
\]

这里 `c_i = completion_s`、`a_i = arrival_s`。比较运行记录与独立重算值时使用清单中的数值容差。任何缺事件、未完成事件、重复 ID 或不一致均须拒绝 `complete` 状态并保留可追踪失败记录。`E` 的名称始终是**建模的任务相关计算加传输能耗**，不是总部署用电。

## 6. 策略、Pareto 与共享界面接口

- 策略接口：`choose(task, observable_state) -> destination_id`。`observable_state` 只能包含当前及过去已到达任务、当前计算与传输队列和据此计算的预测值，不得包含未来到达。模拟器接口：`run_instance(frozen_instance, fixed_policy, manifest) -> event_log + run_record`；失败也返回记录与原因。
- 一个默认 Pareto 参照集合只包含**一个** `instance_id` 的预声明七种策略配置各一个完整运行。缺失或失败候选在清单中可见，但没有目标向量或支配标签。三维和 `M–E`、`M–L`、`E–L` 投影分别计算：所有比较目标都不大且至少一个严格较小才算支配；完全相同的向量互不支配。正式实现用冻结的未舍入值和容差规则。结果至少可由 `(instance_id, reference_run_ids, compared_objectives, run_id, status, witness_run_ids)` 表示；witness 必须来自同一参照集合，且逐维符合支配定义。样例只有一条运行，不提供有研究意义的 Pareto 标签。
- A、B 共同维护的界面状态至少包含 `current_instance_id`、`selected_run_ids`、`visible_policy_config_ids`、每个目标的 `axis_ranges`（`makespan_s`、`energy_j`、`mean_latency_s` 各有数值 `min`/`max`，单位由字段名确定）、`pareto_reference_run_ids` 与 `pareto_reference_status`。后者暂取 `complete`、`incomplete_candidates` 或 `fixture_only`，当状态不是 `complete` 时不展示默认七候选前沿。所有视图通过相同 `run_id` 读取同一 `RunRecord` 与任务事件。切换实例后删除不属于新实例的选择；筛选只改可见性，不改默认完整实例参照集合或已算出的支配标签；筛选也不得悄然重设轴域。没有七候选完整集合时，应显示“参照集合未齐”，不假造默认前沿。

## 7. 手工样例的预期结果

`examples/contract/` 的一份清单、一份两任务实例、一条完整运行、两条最终任务事件和一份界面状态共同展示 ID 与路径的连接。`task-001` 在本地 `edge-0` 计算 `2×10⁹ / 2×10⁹ = 1 s`，计算能耗 `1×5 = 5 J`，传输时间字段为 `null`。`task-002` 在 `edge-1` 上传 `750,000×8 / 30,000,000 = 0.2 s`，计算 `0.9×10⁹ / 3×10⁹ = 0.3 s`，返回 `75,000×8 / 30,000,000 = 0.02 s`；计算能耗 `0.3×6 = 1.8 J`，传输能耗 `(750,000+75,000)/1,000,000×0.2 = 0.165 J`。因此 `M=1.02 s`、`E=6.965 J`、`L=[(1-0)+(1.02-0.5)]/2=0.76 s`。这条手工运行不属于七种正式候选，也不提供 Pareto 结论。

## 8. 双人审查清单

- [ ] A、B 确认字段、单位、ID 作用域、文件路径与版本规则足以独立读取样例。
- [ ] A、B 确认本地 `null` 传输、非本地返回、失败记录及指标边界与各自视图需要一致。
- [ ] A、B 确认同实例七候选参照、二维/三维标签、witness 和筛选语义。
- [ ] A、B 确认共享选择、可见配置和坐标域的状态接口；后续如需补字段，先同步修改契约及样例。
- [ ] 后续类型/读取器实现需实际拒绝重复 ID、缺字段、无效单位或引用、失败运行的伪造指标；本草案不声称这些代码已经实现。

审查记录：待两名成员填写决定、修改意见及最终契约版本。
