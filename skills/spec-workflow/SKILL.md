---
name: spec-workflow
description: 仅在需求已经明确时，按“计划 → 实现 → 验收”三阶段编排 Codex 子代理完成开发任务。用于用户显式调用 $spec-workflow，或需求目标、范围、验收标准与约束均已清楚且需要完整交付时。存在关键需求缺口时先使用 $task-forge，不在 spec-workflow 内边澄清边实现。
---

# Spec Workflow（主会话编排）

主会话（orchestrator）是用户唯一界面，负责探索、计划、调度子代理和最终合并；implementer 只负责实现，reviewer 只读验收。一个任务内 implementer 与 reviewer 严格串行，禁止同时运行。

## 调用入口

- `$spec-workflow init`：仅在当前项目执行显式初始化，完成后停下。
- `$spec-workflow <需求>`：创建并执行完整任务。
- `$spec-workflow resume [task-id]`：根据任务状态恢复；未指定 task-id 且只有一个活跃任务时自动选择，否则列出任务并要求选择。
- 隐式触发仅适用于需求已经完整的开发任务；信息不足时不得自动创建任务。

## 触发门槛

开始前检查目标、范围、验收标准、关键约束和操作权限是否足够明确。

- 存在会改变实现范围或验收结果的关键缺口时，停止流程，说明缺口，并建议先使用 `$task-forge`。
- 用户补齐信息后可继续，不要求重复走 $task-forge。
- 单行修改、纯问答、只需要计划或只需要 review 的任务不使用本流程。
- `spec-workflow` 不替代 $task-forge 的需求澄清，也不重复 $task-forge 已完成的最终确认。

## 初始化约束

`init` 是唯一允许修改项目 `AGENTS.md` 与 `.gitignore` 的入口，并必须按 `references/project-init.md` 幂等执行。

普通任务和 resume 开始时只检查，不修改项目配置：

1. `AGENTS.md` 同时存在 `<!-- spec-workflow:begin -->` 与 `<!-- spec-workflow:end -->`。
2. `.gitignore` 已忽略 `.workflow/` 或 `.workflow`。

任一条件不满足时，停止并提示用户先执行 `$spec-workflow init`。不得静默追加配置。

## 状态目录

状态保存在主仓库 `.workflow/tasks/<task-id>/`，不得放入实现分支提交：

```text
.workflow/tasks/<task-id>/
├── task.json        # 新任务的仓库、worktree、分支与 base 元数据
├── plan.md          # 目标、范围、实施步骤、AC、验证方式
├── acceptance.md    # 最新一轮验收证据与问题清单
├── rounds.md        # 轮次、未通过 AC、严重度、回归与结论
└── status           # 当前状态
```

task-id 为 `<YYYYMMDD-HHmmss>-<ASCII slug>`；标题无法生成 ASCII slug 时使用 `task`，冲突时追加 `-2`、`-3`。模板与兼容规则见 `references/contracts.md`。

## 状态机

```text
planning
→ awaiting-plan-approval
→ implementing
→ reviewing
→ implementing | awaiting-merge-approval | escalated
→ done
```

- 新任务的规范状态写入单行 `status`。
- `planning`、`implementing`、`reviewing` 和 `awaiting-merge-approval` 可通过 `resume` 恢复。
- `done` 只表示合并、验证与清理均已完成；未合并不得标记 done。
- 旧任务状态按 contracts.md 的映射只读兼容，不自动改写历史文件。

## 三阶段

- **计划**：只读探索源码、类型与配置 → 完成任务门槛判断 → 产出 plan.md → 出口自检 → `awaiting-plan-approval`。
- **实现**：用户明确确认计划后创建隔离 worktree 与 `feat/<task-id>` 分支 → 派 implementer → 主会话验证改动与测试 → `reviewing`。
- **验收**：派 reviewer 只读核对全部 AC → 主会话写入 acceptance.md 与 rounds.md → 通过则等待合并确认，未通过则按规则修复或升级。

完整步骤与出口自检见 `references/stages.md`。

## 子代理派发

- 必须使用 `spawn_agent(agent_type="implementer"|"reviewer", ...)`；角色名必须准确。
- 每次只派一个，使用 `wait_agent` 等待其结束后再进入下一步。
- 所有子代理必须收到 state 路径、worktree 路径、分支、base、plan 路径与本轮边界。
- 修复轮必须附带完整问题清单与未通过 AC，不得只传摘要。
- reviewer 不得修改文件、切换分支、提交代码或写入状态；验收结果由主会话落盘。

## 计划与合并确认

- 计划确认按语义判断：用户明确表示“执行、开始、按计划做、可以”等即视为同意；否定或含糊回复继续等待。
- 验收全部 AC 通过后只能进入 `awaiting-merge-approval`，不得自动合并。
- 用户明确确认合并后，主会话在主工作区干净的前提下执行本地合并并重跑验证；不自动 push、创建 PR 或发布。
- 合并、验证、worktree 移除与分支删除完成后置 `done`；任何一步失败均保留现场并升级。

## 循环控制

- 每轮记录未通过 AC 编号、blocker/major/minor 数和是否发生回归。
- 只有“无新增 blocker、已通过 AC 无回归、未通过 AC 数严格下降”才算有进展。
- blocker 一轮未解决、同一 AC 的同一根因连续两轮、发生回归、无进展或达到 3 轮即置 `escalated`。
- 非行为性 minor（文案、格式、无行为变化的命名）可由主会话修复并在当前轮复核；涉及代码、测试或行为的 minor 必须交回 implementer 并开启新轮。

详见 `references/decision-rules.md`。

## 参考

- `references/stages.md`：阶段步骤、隔离 worktree、合并和恢复
- `references/contracts.md`：状态、文件格式、任务元数据与旧任务兼容
- `references/decision-rules.md`：进展判定、循环与升级
- `references/project-init.md`：显式初始化与幂等规则
