# 扩展需求：EXT-0001（首批定制）

## 背景

当前 `skill-creator-x` 已完成从 Codex 内置技能的全量继承与重命名，需要建立稳定的后续扩展机制，确保新增要求能够持续集成且可追溯。

## 本次扩展要求

1. 维持与上游基线的核心流程兼容，不删除原有核心流程。
2. 后续每次新增需求必须通过 `integrate_extension.sh` 进入 `SKILL.md`，禁止手工无记录追加。
3. 每次集成必须同时产生：
   - `extensions/applied/` 快照
   - `extensions/registry.md` 记录
4. 扩展描述优先使用中文，并保留必要英文术语。
5. 当扩展涉及脚本行为变化时，需要补充验证命令及预期输出说明。

## 验收标准

1. `SKILL.md` 新增一段带 `EXT-<timestamp>` 标识的扩展块。
2. `extensions/applied/` 有对应快照文件。
3. `extensions/registry.md` 有对应 append 记录。
