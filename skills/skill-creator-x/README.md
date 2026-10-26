# skill-creator-x 项目说明（中文）

本文档用于说明 `skill-creator-x` 的定位、目录结构与扩展集成规范。

## 1. 项目定位

`skill-creator-x` 是基于 Codex 内置技能全量继承并完成重命名的版本，并通过 `extensions` 机制持续集成你的定制要求。

核心目标：

1. 保持上游能力完整可用。
2. 本地扩展全量可追溯。
3. 扩展变更流程标准化、可重复执行。

## 2. 目录说明

```text
skill-creator-x/
├── SKILL.md                     # 主技能定义（含扩展追加区）
├── scripts/
│   ├── init_skill.py
│   ├── generate_openai_yaml.py
│   ├── quick_validate.py
│   ├── integrate_extension.sh   # 扩展集成脚本
│   └── extension_workflow.sh    # 交互式扩展工作流脚本（支持断点恢复）
├── extensions/
│   ├── pending/                 # 待集成需求
│   ├── applied/                 # 已集成需求快照
│   ├── registry.md              # 变更记录
│   └── README.md                # 扩展目录说明
└── ...
```

## 3. 扩展集成闭环

1. 在 `extensions/pending/` 新增需求文件。
2. 执行 `scripts/integrate_extension.sh`。
3. 自动生成 `extensions/applied/` 快照。
4. 自动写入 `extensions/registry.md` 记录。
5. 自动追加到 `SKILL.md` 的 `Local Extensions` 区块。

## 4. 后续扩展标准流程（SOP）

### 步骤 1：编写扩展需求

在 `extensions/pending/` 新建 markdown 文件，建议命名：

```text
YYYY-MM-DD-ext-XXXX-short-title.md
```

可参考模板：

```text
extensions/pending/_TEMPLATE.md
```

### 步骤 2：执行扩展集成

在项目根目录执行：

```bash
bash scripts/integrate_extension.sh extensions/pending/<需求文件名>.md <source>
```

示例：

```bash
bash scripts/integrate_extension.sh \
  extensions/pending/2026-04-01-ext-0002-xxx.md \
  chat
```

### 步骤 3：校验集成结果

必须检查以下 3 项：

1. `extensions/applied/` 出现对应快照文件。
2. `extensions/registry.md` 出现 append 记录。
3. `SKILL.md` 末尾出现新的 `EXT-<timestamp>` 扩展块。

建议命令：

```bash
find extensions/applied -maxdepth 1 -type f | sort
tail -n 30 extensions/registry.md
tail -n 80 SKILL.md
```

### 步骤 4：扩展验证（按需）

若扩展涉及脚本或流程改造，至少执行：

1. `python3 scripts/quick_validate.py .` 对当前 skill 做结构检查（或等效校验）。
2. 运行新增/修改脚本的 `--help` 或最小示例，确认可执行。

### 步骤 5：状态维护

1. `pending` 中已集成文件可保留（作为输入档案）或移动归档。
2. `applied` 作为不可变快照，不要手改。
3. `registry.md` 只能追加，不回写历史记录。

## 5. 交互式扩展工作流（推荐）

如需按步骤完成全流程并支持中断恢复，使用：

```bash
bash scripts/extension_workflow.sh
```

启动后进入主菜单，支持：

1. 新增扩展
2. 扩展列表查询
3. 删除指定扩展

说明：
1. 扩展列表查询仅展示扩展序号、编号与标题。
2. 删除指定扩展支持输入序号或编号（如 `1`、`0002`、`ext-0002`）。
3. 每次进入选择界面前会自动清屏，减少历史输出干扰。

选择“新增扩展”后，脚本会引导你完成：

1. 创建本次扩展任务信息（日期、编号、标题、source）。
2. 初始化并编辑 `extensions/pending/` 需求文件。
3. 执行 `integrate_extension.sh` 集成。
4. 自动检查 `applied/`、`registry.md`、`SKILL.md` 三项必查结果。
5. 按需执行验证（含 `quick_validate` 与自定义验证命令）。
6. 完成并清理本次缓存状态。

编辑文件时，脚本会强制二选一：

1. 进入 IDE 编辑（支持 `code`/`cursor`/`open`）。
2. 在当前 shell 使用 `vim`/`vi` 编辑。

若目标文件不存在且存在模板（如 `extensions/pending/_TEMPLATE.md`），会先按模板初始化再进入编辑流程。

恢复机制：

1. 中途退出时，进度会写入：
   - `.workflow-cache/extension-workflow.state`
2. 再次启动会检测未完成工作，并强制二选一：
   - 不保留并进入新工作
   - 继续未完成工作（从退出时步骤恢复）

查看帮助：

```bash
bash scripts/extension_workflow.sh --help
```

## 6. 操作规范

1. 禁止手工直接修改 `SKILL.md` 扩展区而不走脚本。
2. 每个扩展必须包含：背景、要求、验收标准。
3. 每次集成必须带来源 `source`（如 `chat`、`issue-123`、`doc`）。
4. 若扩展与上游基线冲突，优先以增量块方式说明，不删除上游主流程。

## 7. 常见问题

1. 提示“需求文件不存在”：检查传入路径是否正确。
2. 没有生成 `applied` 快照：检查脚本是否执行成功、目录权限是否正常。
3. `SKILL.md` 未追加：确认脚本执行时未中断。
4. 需要回退：通过 git 回退本次变更，不要手动删改单条历史。

## 8. 快速命令清单

```bash
# 1) 新建需求文件（示例）
cp extensions/pending/_TEMPLATE.md extensions/pending/2026-04-01-ext-0002-demo.md

# 2) 集成需求
bash scripts/integrate_extension.sh extensions/pending/2026-04-01-ext-0002-demo.md chat

# 3) 检查结果
tail -n 20 extensions/registry.md
tail -n 60 SKILL.md
```

交互式方式（一条命令）：

```bash
bash scripts/extension_workflow.sh
```
