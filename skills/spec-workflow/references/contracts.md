# 交接契约与文件模板

## 交接契约

| 交接 | 载体 | 约定 |
| --- | --- | --- |
| 计划 → 实现 | `plan.md` + `task.json` | implementer 必须读取；worktree、分支与 base 取自 task.json |
| 计划 → 验收 | `plan.md` | reviewer 提取 `## 验收标准` 逐条核对 |
| 实现 → 验收 | worktree 分支 + base | reviewer 用 `git diff <base>...<branch>` 查看完整改动 |
| 轮次证据 | `rounds.md` | 每轮未通过 AC、严重度、回归与结论 |
| 全流程状态 | `status` | 主会话是唯一写入者 |

主仓库 `.workflow/` 是过程产物，不得被 implementer 提交。新任务的状态文件和元数据始终保存在主仓库，而不是任务 worktree。

## 目录布局

```text
.workflow/tasks/<task-id>/
├── task.json        # 新任务必需；旧任务可缺失
├── plan.md          # 计划、AC 与验证方式
├── acceptance.md    # 最新一轮验收证据与问题清单
├── rounds.md        # 轮次记录
└── status           # 单行当前状态
```

## task.json

新任务在隔离 worktree 创建成功后写入，创建后不再修改：

```json
{
  "version": 1,
  "taskId": "20261027-160000-example",
  "repoRoot": "/absolute/path/to/repository",
  "worktreePath": "/absolute/path/to/worktree",
  "branch": "feat/20261027-160000-example",
  "baseRef": "origin/main",
  "createdAt": "2026-10-27T16:00:00+08:00"
}
```

- `repoRoot`：主仓库绝对路径。
- `worktreePath`：隔离工作目录绝对路径。
- `branch`：实现分支。
- `baseRef`：计划阶段确定的比较基准。
- 旧任务没有 task.json 时按“旧任务兼容”处理，不伪造缺失信息。

## 状态取值

新任务只使用以下状态：

```text
planning
awaiting-plan-approval
implementing
reviewing
awaiting-merge-approval
escalated
done
```

状态流转：

```text
planning
→ awaiting-plan-approval
→ implementing
→ reviewing
→ implementing | awaiting-merge-approval | escalated
→ done
```

## 旧任务兼容

只读识别旧状态，不自动重写：

| 旧值 | 规范含义 |
| --- | --- |
| `plan` / `planning` | `planning` |
| `awaiting-plan-approval` | 不变 |
| `implement` / `implementing` | `implementing` |
| `review` / `reviewing` | `reviewing` |
| `awaiting-merge-approval` | 不变 |
| `escalated` | 不变 |
| `completed` / `done` | `done` |

status 有多行时取最后一个可识别值。遇到未知值立即停止并要求用户确认，不得猜测。

旧任务没有 task.json 时：

- `planning`、`awaiting-plan-approval`、`awaiting-merge-approval` 可读取原 plan 和状态继续。
- `implementing`、`reviewing` 必须先向用户确认现有分支与工作目录；确认前不得派子代理。
- `done` 只报告已完成，不重新进入实现。
- 不批量迁移、不补写 task.json、不修改历史 rounds.md。

## plan.md 模板

```markdown
# 计划：<任务标题>

## 目标
<一句话说明要达成什么>

## 背景与约束
<现状、依赖、限制>

## 范围
- 改动：<文件/模块>
- 不改动：<明确排除项>

## 实施步骤
1. <步骤>
2. <步骤>

## 验收标准
- [ ] AC1：<可验证的标准>
  - 验证：<命令、测试或可观察证据>
- [ ] AC2：<可验证的标准>
  - 验证：<命令、测试或可观察证据>

## 分支
feat/<task-id>（base: <ref>）
```

AC 必须逐条编号、可验证且覆盖用户目标。禁止用“能正常工作”之类不可判定描述。

## acceptance.md 模板

```markdown
# 验收结论：<任务标题>（第 <n> 轮）

## 结论
通过 / 不通过

## 验收标准核对
- [x] AC1：通过 —— <证据>
  - 验证：<实际执行的命令与结果>
- [ ] AC2：未通过 —— <原因>
  - 验证：<实际执行结果或未覆盖原因>

## 问题清单
| # | 问题描述 | 涉及文件 | 严重程度 | 根因/建议方向 |
| --- | --- | --- | --- | --- |
| 1 | <描述> | <path:line> | blocker/major/minor | <根因或方向> |

## 回归检查
<已通过 AC 是否因本轮改动回归；无回归也要明确写出>

## 未覆盖项
<未验证或无法验证的部分>
```

## rounds.md 模板

```markdown
# 轮次记录：<任务标题>

| 轮次 | 未通过 AC | blocker | major | minor | 回归 | 结论 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | AC2, AC4 | 0 | 1 | 1 | 否 | 回实现 |
| 2 | 无 | 0 | 0 | 0 | 否 | 通过 |
```

非行为性 minor 在当前轮复核时，以“第 n 轮复核”写入 acceptance.md 备注；不新增轮次。任何代码、测试或行为变化必须开启新轮。
