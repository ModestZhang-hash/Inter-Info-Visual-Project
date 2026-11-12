# 从冻结清单重建留出集结果

重建使用仓库里的冻结实例、`configs/freeze/design_freeze_v1.json` 和 checkpoint `artifacts/workloads/provisional/p8d_training/provisional-dqn-seed8-episode500-weights.json`。不要重新训练，不要更换 checkpoint，也不要读取结果后再改尺度或奖励。

数值容差是绝对值和相对值都为 `1e-9`。能耗只计任务的计算增量功率和传输能量，不计设备或网络的持续空闲基线。DQN 推理为贪心，不更新权重。

在仓库根目录执行。下面的 Python 是本机已用于验收的解释器；其他能导入 `src/topic3` 的 Python 3 也可以，但应把版本记进验收记录。

```bat
set PYTHONPATH=src
"C:\Users\Joe\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" scripts\run_p10_held_out.py
"C:\Users\Joe\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" scripts\run_p11_analysis.py
"C:\Users\Joe\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" scripts\run_p12_acceptance.py
"C:\Users\Joe\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" -m unittest tests.test_p10 tests.test_p11 tests.test_p12
```

产物位置：

- 252 次运行、事件日志和失败表：`artifacts/workloads/provisional/p10_held_out/`
- 配对差、非支配次数和四类案例：`artifacts/workloads/provisional/p11_analysis/summary.json`
- 指标、前沿标签和事件重放是否一致：`artifacts/workloads/provisional/p12_acceptance/rebuild.json`

页面从仓库根目录启动本地 HTTP 服务后打开。留出实例 `provisional-held_out-low-3000` 的地址是 `app/3a/index.html?bundle=p11-held-out-low-3000`。

失败记录以 `p10_held_out/failures.json` 为准。当前 `failure_count` 为 0。尚未预先登记的单实例 DQN 对照案例保持 `instance_not_preregistered`，不事后补选实例。
