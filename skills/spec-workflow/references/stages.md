# 阶段步骤、隔离 worktree 与恢复

每个阶段结束前先做出口自检，通过后才进入下一阶段。

## 前置检查

1. 判断需求是否完整；存在关键缺口时停止并建议先使用 `$task-forge`。
2. 确认存在 `AGENTS.md` 初始化标记和 `.workflow` 忽略规则；缺失时只提示执行 `$spec-workflow init`。
3. 确认当前目录属于 Git 仓库，并确定主仓库根目录。
4. 生成唯一 task-id，初始化 `.workflow/tasks/<task-id>/`，将 `status` 写为 `planning`。

普通任务不得修改 `AGENTS.md` 或 `.gitignore`。

## 阶段一：计划（主会话）

1. 只读阅读相关源码、类型、配置、测试和项目约束，禁止臆测接口。
2. 明确目标、改动与非目标、实施步骤、AC 和每条 AC 的验证方式。
3. 选择 base ref，优先级为：
   - 用户明确指定的 ref；
   - `origin/HEAD` 指向的默认分支；
   - 当前 `HEAD` 所在 ref。
4. 按 contracts.md 写出 plan.md，确定分支 `feat/<task-id>`。
5. 出口自检：
   - 每条 AC 是否可验证且覆盖目标？
   - 范围是否最小，非目标是否明确？
   - base ref、分支名和验证命令是否已确定？
6. 将 `status` 写为 `awaiting-plan-approval`，展示摘要并等待用户明确确认。

用户可以“执行、开始、按计划做、可以”等语义确认；否定或含糊回复保持等待。plan.md 或范围发生实质变化后必须重新确认。

## 阶段二：实现（隔离 worktree + implementer）

计划确认后：

1. 使用 `create_worktree` 以 plan 中的 base ref 创建隔离工作目录，并等待创建完成。
2. 在返回的 worktree 中创建或切换到 `feat/<task-id>`；新任务若同名分支已存在，停止并升级。
3. 将主仓库、worktree、分支、base、创建时间写入 task.json。
4. 将 `status` 写为 `implementing`。
5. 派发 `spawn_agent(agent_type="implementer", ...)`，明确要求：
   - 只在该 worktree 工作；
   - 读取 plan.md，按本轮边界修改；
   - 运行受影响模块的测试/构建/类型检查；
   - 按仓库规范做原子提交；
   - 不提交 `.workflow/`，不改 plan，不切换 base。
6. 等待 implementer 结束。主会话随后核对：
   - `git status --porcelain` 是否干净或只剩计划内改动；
   - `git diff --name-only <base>...<branch>` 是否落在计划范围；
   - 实际运行 plan 中的验证命令；
   - 提交是否包含 `.workflow/` 或无关文件。
7. 任一出口检查失败时不得直接进入验收：记录失败原因并派 implementer 修复；达到循环阈值则升级。
8. 通过后将 `status` 写为 `reviewing`。

创建 worktree 失败时置 `escalated`，说明失败原因；不得回退到主工作区执行。

## 阶段三：验收（reviewer）

1. 派发 `spawn_agent(agent_type="reviewer", ...)`，传入 plan、worktree、分支、base、本轮边界和实际验证结果。
2. reviewer 只读检查：
   - 逐条核对 AC；
   - 用 `git diff <base>...<branch>` 查看完整改动；
   - 检查每条结论是否有文件行或命令结果证据；
   - 标记 blocker/major/minor、是否回归和未覆盖项。
3. 主会话将 reviewer 结果原样整理进 acceptance.md，并在 rounds.md 追加本轮记录。
4. 按 decision-rules.md 判定：
   - 全部 AC 通过 → `awaiting-merge-approval`；
   - 可继续修复 → `implementing`；
   - 触发升级 → `escalated`。
5. 出口自检：
   - AC 是否逐条有结论？
   - 问题是否带文件证据和严重度？
   - 回归与未覆盖项是否明确？

reviewer 不得写入 acceptance.md、rounds.md 或 status；这些文件只由主会话维护。

## 合并与清理（用户确认后）

1. 在 `awaiting-merge-approval` 停留，向用户展示 AC 结果、验证命令、分支和待合并 base。
2. 只有用户明确确认合并后才继续。
3. 检查主工作区 `git status --porcelain` 为空；不干净时置 `escalated`，禁止自动 stash、reset 或 checkout。
4. 在主工作区执行 `git merge <branch>`，遵循仓库现有 merge 配置。
5. 合并后在主工作区重跑 plan 中的完整验证。冲突或验证失败时保留现场并升级。
6. 合并与验证成功后，移除任务 worktree 并删除已合并分支。
7. 清理成功后写 `status=done`；清理失败时置 `escalated`，明确说明代码已合并但清理未完成，并给出人工处理路径。

## resume 恢复

`$spec-workflow resume [task-id]` 按 status 恢复：

- 未指定 task-id：只有一个活跃任务时自动选择；多个活跃任务时列出并等待选择。
- `planning`：继续探索和计划。
- `awaiting-plan-approval`：重新展示 plan 摘要并等待确认。
- `implementing`：读取 task.json，确认 worktree 和分支存在；派 implementer 继续当前修复轮。
- `reviewing`：读取 task.json 和本轮 implementer 结果；核对验证证据后派 reviewer。
- `awaiting-merge-approval`：重新展示验收结果并等待合并确认。
- `escalated`：展示卡点、轮次证据和建议，未经用户指示不得继续。
- `done`：只报告完成状态。

旧任务没有 task.json 时遵守 contracts.md 的兼容规则，不猜测缺失的 worktree 或分支。

## 串行约束

- 同一任务同一时刻只允许一个子代理运行。
- 派下一个角色前必须等上一个结束。
- 严禁并行派发 implementer 与 reviewer。
