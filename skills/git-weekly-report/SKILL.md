---
name: git-weekly-report
description: 从本地多仓库 Git 提交生成中文周报 Excel。用于用户说“写周报 / 上周周报 / 工作周报 / weekly report / Git 提交汇总”时，自动扫描工作区仓库、按作者和周归并提交，生成单周模板（大类 / 名称 / 目标 / 进展 / 完成状态 / 偏差说明），并校验覆盖率和 A4 横向单页打印。仅处理本地已 clone 的 Git 仓库，不替代人工确认。
---

# Git Weekly Report

把本地 Git 提交转成一份可汇报、可打印的中文周报。核心原则：**提交是证据，周报是叙事，Excel 只是排版**。

## 何时使用

- 用户要写“上周周报”“本周周报”“工作周报”“weekly report”。
- 用户给了一个日期范围，要求按项目汇总自己的 Git 提交。
- 用户要沿用固定模板：`大类 / 名称（只列关键） / 目标 / 进展 / 完成状态 / 偏差说明`。

不适用：

- 需要统计团队所有人的提交（本 skill 默认只统计配置中的作者邮箱）。
- 需要从 GitHub / GitLab API 拉取远端提交（本 skill 只读本地仓库）。
- 需要生成多周详细周报（当前只做单周模板；多周模式后续扩展）。

## 前置条件

- Python 3.10+
- `openpyxl`（推荐用 `uv run --with openpyxl`）
- Git
- 本地已 clone 目标仓库

## 目录约定

本 skill 的脚本都在 `scripts/` 下。下文用 `$SKILL_DIR` 表示本 `SKILL.md` 所在目录：

```bash
SKILL_DIR="${SKILL_DIR:-$HOME/.agents/skills/git-weekly-report}"
```

## 本地配置

真实配置放在本机，不提交到 Git：

```text
~/.config/git-weekly-report/
├── config.json          # workspace、作者邮箱、输出目录
└── project-map.json     # 仓库 -> 项目映射
```

首次使用：

```bash
mkdir -p ~/.config/git-weekly-report
test -f ~/.config/git-weekly-report/config.json || \
  cp "$SKILL_DIR/references/config.example.json" ~/.config/git-weekly-report/config.json
test -f ~/.config/git-weekly-report/project-map.json || \
  cp "$SKILL_DIR/references/project-map.example.json" ~/.config/git-weekly-report/project-map.json
```

然后让用户确认：

1. `workspace` 是否是多仓库的父目录。
2. `authors` 是否包含用户所有提交邮箱（工作邮箱、个人邮箱、机器默认邮箱）。
3. `project-map.json` 中的仓库路径是否相对 `workspace`，项目名和标准目标是否符合用户口径。

`config.json` 示例：

```json
{
  "workspace": "/Users/you/work",
  "authors": ["you@example.com"],
  "output_dir": "/Users/you/work",
  "scan_depth": 5,
  "report": {
    "sheet_name": "上周周报"
  }
}
```

`output_dir` 用于 `render_report.py` 未传 `--output` 时的默认输出目录；`report.sheet_name` 可覆盖默认 sheet 名。

`project-map.json` 示例：

```json
{
  "projects": {
    "Example Platform": {
      "repos": ["platform", "packages/platform-gateway"],
      "goal": "完成平台接入与鉴权能力。",
      "strategic": true
    }
  },
  "ignored_repos": []
}
```

## 工作流

### 1. 确定周期

默认是上一个 ISO 周（周一至周日）。也可以显式指定：

```bash
# 指定日期
uv run --with openpyxl python "$SKILL_DIR/scripts/extract_commits.py" \
  --start 2026-10-19 --end 2026-10-25 \
  --output /tmp/git-weekly-report/commits.json

# 指定 ISO 周
uv run --with openpyxl python "$SKILL_DIR/scripts/extract_commits.py" \
  --week W43 --year 2026 \
  --output /tmp/git-weekly-report/commits.json
```

运行后先看输出的 `period` 是否符合用户说的“上周”。如果不符合，先和用户确认，不要直接生成。

### 2. 提取提交

```bash
uv run --with openpyxl python "$SKILL_DIR/scripts/extract_commits.py" \
  --output /tmp/git-weekly-report/commits.json
```

脚本会：

- 扫描 `workspace` 下的 `.git`，跳过 `node_modules`、`dist`、`build` 等目录。
- 只保留 `authors` 中邮箱的提交。
- 排除 merge commit。
- 按 author date 归入 ISO 周。
- 按“仓库 + 日期 + 归一化标题”去重。
- 输出 `commits.json`，包含 `commits`、`unmapped`、`stats`。

### 3. 处理未归类仓库

如果 `unmapped` 不为空，先不要生成周报。把仓库名、提交数、样例提交列给用户，让用户选择：

- 归入已有项目：把仓库加到该项目的 `repos`。
- 新建项目：补 `goal` 和 `strategic`。
- 忽略：加入 `ignored_repos`。

更新 `~/.config/git-weekly-report/project-map.json` 后重新运行提取。确认 `unmapped` 为空，或用户明确同意忽略。

### 4. 生成 report.json

读取 `commits.json`，按项目归并提交，写出 `report.json`。不要直接把 commit 列表塞进 Excel。

`report.json` 结构：

```json
{
  "period": "2026/10/19-2026/10/25",
  "week": "W43",
  "sections": [
    {
      "label": "重点项目",
      "items": [
        {
          "name": "示例平台接入与鉴权",
          "goal": "完成平台应用接入、租户白名单与网关鉴权能力。",
          "progress": "实现应用类别透传与租户列表返回；修复应用无角色时的处理；调整请求限制。",
          "status": "完成",
          "deviation": "无",
          "evidence": {
            "projects": ["Example Platform"],
            "repos": ["platform", "packages/platform-gateway"],
            "commit_count": 6,
            "sample_commits": [
              "内部微服务豁免租户白名单并返回应用类别",
              "鉴权主体新增应用类别与租户列表"
            ]
          }
        }
      ]
    },
    {
      "label": "日常工作",
      "items": [
        {
          "name": "示例工具链构建配置维护",
          "goal": "保障测试环境与构建产物稳定。",
          "progress": "调整测试环境消息队列地址；构建阶段关闭静态资源监听，避免产物截断。",
          "status": "完成",
          "deviation": "无",
          "evidence": {
            "projects": ["Example Tooling"],
            "repos": ["tools/example"],
            "commit_count": 2,
            "sample_commits": [
              "调整测试环境消息队列地址",
              "构建阶段关闭静态资源监听"
            ]
          }
        }
      ]
    }
  ]
}
```

### 5. 选择重点项目和日常工作

**重点项目**（建议 3-5 个）：

- 战略性、功能级、跨多天或多仓库。
- 对用户可见，或涉及架构、协议、核心链路。
- 一个项目提交很多时，按主题拆成 2-3 个重点项目，而不是逐条列提交。

**日常工作**（建议 2-4 个）：

- 小修复、文档、配置、构建、环境维护。
- 单条或少量提交，但确实占用了工作时间。
- 不要为了凑数把重点项目拆成日常。

总数建议不超过 8 条，保证 A4 横向单页。

### 6. 写目标、进展、状态、偏差

**目标**

- 重点项目优先使用 `project-map.json` 里的标准 `goal`，必要时按本周实际微调。
- 日常工作写一句话说明这项工作的目的。

**进展**

- 2-5 个分句，用中文分号 `；` 分隔。
- 以动词开头：完成、实现、新增、修复、重构、补充、调整、升级、移除、合并。
- 写具体技术名词：表、接口、字段、页面、协议、模板、迁移。
- 不写 commit hash，不写“相关工作”，不写第一人称。
- 只写提交能支撑的内容，不编造上线、发布、指标。

**完成状态**

| 状态 | 使用条件 |
|---|---|
| `完成` | 本周工作闭环，无遗留 |
| `进行中` | 已启动、按计划推进，但本周未闭环 |
| `部分完成` | 多个子项只完成一部分 |
| `有偏差` | 有阻塞、延期或范围变化 |

如果状态不是 `完成`，`偏差说明` 必须写原因，不能写 `无`。

**证据**

每个 item 必须带 `evidence`：

- `projects`：对应的项目名，必须能在 `project-map.json` 中找到。
- `commit_count`：支撑该条目的提交数。
- `sample_commits`：1-5 条真实提交标题；单提交条目可为 1 条，其余建议 2-5 条。

### 7. 渲染 Excel

```bash
# 指定输出路径
uv run --with openpyxl python "$SKILL_DIR/scripts/render_report.py" \
  --input /tmp/git-weekly-report/report.json \
  --output "/Users/you/work/周报_20261019-20261025.xlsx"

# 或省略 --output：使用 config.json 的 output_dir，文件名按周期自动生成
uv run --with openpyxl python "$SKILL_DIR/scripts/render_report.py" \
  --input /tmp/git-weekly-report/report.json
```

默认 sheet 名为 `上周周报`，可用 `--sheet-name` 覆盖，也可在 `config.json` 的 `report.sheet_name` 中设置。

### 8. 校验

```bash
uv run --with openpyxl python "$SKILL_DIR/scripts/validate_report.py" \
  --report /tmp/git-weekly-report/report.json \
  --commits /tmp/git-weekly-report/commits.json \
  --xlsx "/Users/you/work/周报_20261019-20261025.xlsx"
```

校验内容：

- 每个有提交的项目是否被周报覆盖。
- 是否还有未归类仓库。
- 必填字段、状态、偏差是否合理。
- 每个条目是否有提交证据。
- Excel 的标题、表头、合并单元格、行高、打印设置。

校验失败时，修 `report.json` 后重新渲染，不要手改 Excel。

### 9. 打印预览

如果环境有 Numbers / Excel / LibreOffice，打开生成的文件做一次打印预览：

- A4 横向。
- 单页。
- 没有文字截断。
- 表格没有跑到第二页。

macOS 上 Numbers 的“打印预览”比 `qlmanage` 缩略图可靠；`qlmanage` 可能只截取页面的一部分。

## Excel 版式

默认版式：

- A4 横向，页边距 0.3 / 0.3 / 0.4 / 0.4 英寸。
- 标题行合并 A1:F1，浅蓝底。
- 表头行深蓝底、白字。
- 大类列按 section 合并，竖排文字，浅绿底。
- 列宽：A 8、B 24、C 34、D 68、E 10、F 22。
- 字体：宋体 11；标题 14；section 标签 11。
- 行高按中文/英文文本长度估算，最小 30，最大 409。
- `fitToWidth=1`、`fitToHeight=0`、`fitToPage=True`。
- 不显示网格线。

详细规则见 `references/report-spec.md`。

## 质量检查清单

- [ ] 周期正确，和用户说的“上周”一致。
- [ ] `stats.total` 与预期提交数一致。
- [ ] `unmapped` 已处理。
- [ ] 每个有提交的项目都有对应周报条目。
- [ ] 每个条目都有 `evidence.commit_count > 0`。
- [ ] 重点项目 3-5 个，日常工作 2-4 个。
- [ ] 状态不是 `完成` 的条目都有偏差说明。
- [ ] 没有编造提交之外的工作。
- [ ] 生成文件能正常打开。
- [ ] A4 横向单页，无截断。

## 常见问题

**没有提交**

- 检查 `workspace` 是否指向多仓库父目录。
- 检查 `authors` 是否包含所有提交邮箱。
- 检查日期范围是否按 author date 落在预期周。
- 如果工作在其他机器上，先 `git fetch` 或确认本地分支。

**有未归类仓库**

- 不要静默忽略。把仓库和样例提交列给用户确认。
- 确认后更新 `project-map.json`，再重新提取。

**Excel 文字被截断**

- 优先缩短 `progress`，不要直接缩小字体。
- 或增加行高；`render_report.py` 会按文本长度估算，仍不够时手动调整 `estimate_height` 的参数。

**OpenCode 看不到新 skill**

- 确认 `~/.agents/skills/git-weekly-report` 是 symlink 且指向本仓库。
- 重开一个 OpenCode 会话。
- 如果 symlink 不被识别，用 `node bin/skill-manager.js` 选择 OpenCode 做复制安装。

## 参考

- `references/report-spec.md`：模板、字段、版式、状态口径。
- `references/examples.md`：脱敏示例。
- `references/config.example.json`：本机配置示例。
- `references/project-map.example.json`：项目映射示例。
