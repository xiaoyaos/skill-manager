# 项目显式初始化

只有用户执行 `$spec-workflow init` 时才修改项目配置。普通任务、隐式触发和 resume 都不得自动追加或覆盖文件。

初始化做两件幂等的事：

1. 在项目根 `AGENTS.md` 中维护 spec-workflow 标记片段；文件不存在时创建。
2. 在项目根 `.gitignore` 中确保存在 `.workflow/` 规则；文件不存在时创建。

## 幂等规则

- `AGENTS.md` 同时存在 begin/end 标记：完整跳过，不重复追加。
- 只存在 begin、缺少 end：视为文件损坏，停止并报告行号，不自动改写。
- end 存在但 begin 缺失：同样停止并报告，不猜测修复范围。
- `.gitignore` 已有 `.workflow/` 或 `.workflow` 行时跳过，不重复追加。
- 追加前确保前一文件以换行结尾；保留全部既有内容。

`.gitignore` 追加内容：

```gitignore
# spec-workflow: 工作流状态目录
.workflow/
```

## AGENTS.md 片段

```markdown
<!-- spec-workflow:begin -->
# Spec Workflow 编排约定

当用户请求涉及“规划 + 实现 + 验收”的完整开发任务时，优先使用 `$spec-workflow`；若目标、范围、验收标准、关键约束或权限仍存在实质缺口，先使用 `$task-forge` 完成澄清。

- 主会话按“计划 → 实现 → 验收”推进，用户只面对主会话。
- implementer 与 reviewer 必须串行；implementer 负责编码，reviewer 只读验收。
- 计划需用户明确确认后才进入实现；验收通过后需用户明确确认才合并。
- 新任务使用隔离 worktree，状态写入 `.workflow/tasks/<task-id>/`，不得提交。
- 无进展、回归、blocker 未解决或达到最大轮次时升级给用户。

详见 `~/.agents/skills/spec-workflow/SKILL.md`。
<!-- spec-workflow:end -->
```

## 普通任务前置检查

开始新任务或恢复任务前检查：

- `AGENTS.md` 同时包含 begin/end 标记；
- `.gitignore` 忽略 `.workflow/` 或 `.workflow`。

任一条件不满足时停止，并提示用户先执行：

```text
$spec-workflow init
```

普通任务不得以“方便继续”为由自动补写这两个文件。
