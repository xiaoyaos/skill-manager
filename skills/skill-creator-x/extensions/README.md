# Extensions 目录说明

`skill-creator-x` 基于 Codex 内置技能全量继承并完成重命名，并通过本目录持续集成你的定制扩展。

目录约定：

- `pending/`: 待集成的扩展需求文档
- `applied/`: 已集成的扩展需求快照
- `registry.md`: 集成记录

推荐流程：

1. 先把新需求写成 markdown 文件放到 `pending/`（可基于 `pending/_TEMPLATE.md`）。
2. 运行 `scripts/integrate_extension.sh <需求文件路径> [source]`。
3. 检查 `SKILL.md` 末尾扩展块和 `registry.md` 记录。

完整操作手册见：

- `../README.md`
