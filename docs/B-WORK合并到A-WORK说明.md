# 请将 B-WORK 的 P4、P5 合并进 A-WORK

仓库：`https://github.com/ModestZhang-hash/Inter-Info-Visual-Project.git`

请在 `A-WORK` 上合并 `origin/B-WORK` 的 `2569396`。不要合并到 `main`，不要强制推送，也不要改写 `app/3a/` 现在的统一比较界面。

这次合并不会用 `B-WORK` 覆盖 `A-WORK` 已有的前端。自共同祖先 `2b2bfc7` 以来，两边改过的文件没有重叠：

- `A-WORK` 改的是 `app/`、`README.md`、`docs/integration.md` 等页面和说明，包括统一比较界面、最多 10 条比较、500 点测试数据，以及当前页面不使用框选。
- `B-WORK` 在 `2b2bfc7` 之后只增加策略、模拟器、尺度、测试和 P4、P5 运行记录，没有修改 `app/`。

Git 对只在一边改过的文件会保留那一边的结果。因此 `app/3a/` 会原样留下。说明里的冲突规则只是预防；这些页面文件预计不会冲突。不要强制推送，也不要在冲突时整份改用 `B-WORK` 的 `app/`。

当前两端：

- `origin/A-WORK`：`40de4bc`（Merge B-WORK pipeline and training slice while preserving unified comparison UI）
- `origin/B-WORK`：`2569396`（Add the six-heuristic Pareto reference without a seven-candidate front）
- 共同祖先：`2b2bfc7`

`40de4bc` 已经包含 `B-WORK` 到 P3 为止的内容。这次只需要补上其后的 P4 和 P5。

## 1. 自共同入口以来，B-WORK 完成的内容

共同入口提交是 `2b816ea`（Add a shared English entry linking the 3A and 3B views）。它把 3A 成对图、矩阵、平行坐标和固定 3D 放进同一个页面，共用一次加载和一份状态。

`A-WORK` 已经包含、这次不必再处理的提交：

| 提交 | 内容 |
| --- | --- |
| `705e7d7` | 提案和行动计划：冻结任务流由生成器写出，模拟器只重放该文件 |
| `7f980b1` | 英文共同入口的浏览器联合验收记录。正式七候选运行仍未完成 |
| `397eac0` | P1：暂定任务流生成器。42 条实例；训练、pilot、留出集种子不相交。分布和样本量未冻结 |
| `156b65c` | P2：离散事件模拟器，以及 Random（种子 11）和 Latency-first。84 份运行日志。能耗系数仍是契约样例中的暂定数 |
| `2b2bfc7` | P3：独立计算 \(M\)、\(E\)、\(L\)，不调用模拟器汇总函数。训练实例 `provisional-training-low-1000` 的两个点可用 `?bundle=p3-training-low` 打开，参照集合未齐 |

这次需要新合并的提交：

| 提交 | 内容 |
| --- | --- |
| `b5f94e7` | P4：补齐六种启发式。新增 Energy-first，以及 `balanced-equal`、`balanced-makespan`、`balanced-energy`。三种 Balanced 同属 `balanced` 族，权重为 `(1/3,1/3,1/3)`、`(3/5,1/5,1/5)`、`(1/5,3/5,1/5)`，后两组即 `0.6/0.2/0.2` 和 `0.2/0.6/0.2`。尺度只由 12 条训练和 pilot 运行算出，`held_out_used` 为 false，状态为 `provisional_not_frozen`。六种配置都在 `provisional-training-low-1000` 上有可追溯运行记录 |
| `2569396` | P5：对上述六次运行做二维投影和三维支配分类，并有独立枚举核对。`official_seven_candidate_front` 为 false，缺 `dqn-fixed`。筛选不得改写该参照集合 |

P4 和 P5 相对 `2b2bfc7` 共 23 个文件，都在 `src/topic3/`、`scripts/`、`tests/`、`configs/provisional/balanced_scales.json` 和 `artifacts/workloads/provisional/p4_one_instance/`、`p5_six_heuristic/`。没有修改 `app/`。

双方已确认：当前统一页面不保留框选。单击和最多 10 条的比较集合是现用选择方式。请合并时不要把框选加回 `app/3a/`。

## 2. 成员 B 继续往下做之前需要的条件

B 下一步要在统一页面上核对 P6/P7，而不是在 `B-WORK` 的旧 `app/index.html` 上重做一遍。核对需要同时具备：

- `A-WORK` 现有的 `app/3a/` 统一比较界面、最多 10 条比较、500 点测试数据，以及框选不作为现用操作
- `b5f94e7` 的六种启发式和 `2569396` 的六运行支配记录

P5 里已经有一条真实分歧，供页面核对，但不能标成正式前沿：在 `provisional-training-low-1000` 上，`balanced-makespan` 和 Latency-first 在 M–E 投影上被支配，三维仍非支配。Random 在三维上被支配。缺 DQN，所以参照状态保持 `incomplete_candidates`。

P8 的受限 DQN 仍由双方在训练和 pilot 上做，不依赖这次页面合并，也不使用留出集训练或选择 checkpoint。

## 3. 合并时如何保留 A-WORK 的页面

在干净的 `A-WORK` 上执行。开始前 `git log -1 --oneline` 应为 `40de4bc`。

```bat
git fetch origin
git switch A-WORK
git merge origin/B-WORK -m "Merge B-WORK P4 and P5 into the unified A-WORK page"
```

若无冲突，直接进入第 4 节。

若有冲突：

- `app/`、`docs/integration.md`、`README.md` 以当前 `A-WORK` 为准，保留统一比较界面、10 条上限、无框选和 500 点测试数据
- `src/topic3/`、`scripts/build_p4_heuristics.py`、`scripts/build_p5_reference.py`、`tests/test_heuristics.py`、`tests/reference_pareto.py`、`tests/test_pareto_reference.py`、`configs/provisional/balanced_scales.json`，以及 `artifacts/workloads/provisional/p4_one_instance/` 和 `p5_six_heuristic/` 保留 `B-WORK` 的版本
- 不要重新生成 500 点数据，不要重跑模拟，不要训练 DQN，不要把六次运行写成正式七候选前沿

冲突处理完后：

```bat
git add -A
git status
git commit
```

确认工作区干净后：

```bat
git push origin A-WORK
```

只推 `A-WORK`。不要推 `main`，不要使用 `--force`。

## 4. 请返回的结果

请把下面几项发回：

1. 合并后的 `A-WORK` 提交号，以及 `git log -6 --oneline`。其中应能看到 `40de4bc`、`2569396` 和 `b5f94e7`。
2. `git status -sb`。期望是与 `origin/A-WORK` 一致，工作区干净。
3. 若有冲突，列出冲突文件，以及每个文件保留了哪一边。
4. 确认这些路径仍在，且页面文件没有被旧入口覆盖：
   - `app/3a/` 仍是统一比较页面
   - `configs/provisional/balanced_scales.json` 中 `held_out_used` 为 false，`status` 为 `provisional_not_frozen`
   - `artifacts/workloads/provisional/p5_six_heuristic/provisional-training-low-1000.json` 中 `official_seven_candidate_front` 为 false，`missing_policy_config_ids` 含 `dqn-fixed`
5. 测试命令和通过数量：

```bat
node --test --test-concurrency=1 tests/3a.test.mjs tests/3a_startup.test.mjs tests/3b.test.mjs tests/entry.test.mjs
python -m unittest discover -s tests -p "test_*.py"
```

成员 B 收到上述结果后，再决定是否把合并后的 `A-WORK` 同步回本地 `B-WORK`。在那之前，B 不会自行向 `A-WORK` 推送。
