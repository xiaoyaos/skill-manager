---
name: uj-weekly-report
description: 从本地多仓库 Git 提交生成中文周报 Excel，100% 套用 UJoin《个人周报》模板（个人周报——姓名 / 周报周期 / 大类 / 名称 / 目标 / 进展 / 完成状态 / 偏差说明，重点项目 4 行 + 日常工作 4 行）。用于用户说“写周报 / 上周周报 / 工作周报 / weekly report / Git 提交汇总”时，自动扫描工作区仓库、按作者和周归并提交、生成单周周报并校验模板一致性。仅处理本地已 clone 的 Git 仓库，不替代人工确认。
---

# Git Weekly Report

把本地 Git 提交转成一份符合 UJoin 个人周报模板的中文周报。核心原则：**提交是证据，周报是叙事，Excel 只是排版**。

## 何时使用

- 用户要写“上周周报”“本周周报”“工作周报”“weekly report”。
- 用户给了一个日期范围，要求按项目汇总自己的 Git 提交。
- 用户要求周报套用 UJoin《个人周报》模板。

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

本 skill 的脚本都在 `scripts/` 下，模板在 `assets/` 下。下文用 `$SKILL_DIR` 表示本 `SKILL.md` 所在目录：

```bash
SKILL_DIR="${SKILL_DIR:-$HOME/.agents/skills/uj-weekly-report}"
```

## 模板

唯一版式来源：`assets/ujoin-weekly-template.xlsx`。它是 `ujoin周报模板.xlsx` 中“个人周报（模板）”工作表的脱敏副本，保留全部字体、底色、边框、合并单元格、数据验证和列宽。

固定结构：

| 行 | 内容 |
|---|---|
| 1 | `个人周报——<姓名>`，合并 A1:F1，深蓝底白字 16 号加粗 |
| 2 | 填写说明，合并 A2:F2 |
| 3 | `周报周期：YYYY/MM/DD-YYYY/MM/DD`，合并 A3:F3，浅蓝底 |
| 4 | `大类` / `名称（只列关键）` / `目标` / `进展` / `完成状态` / `偏差说明`，浅黄底加粗 |
| 5-8 | 重点项目，固定 4 个槽位，A5:A8 合并，蓝底白字竖排 |
| 9-12 | 日常工作，固定 4 个槽位，A9:A12 合并，绿底白字竖排 |
| 13-22 | 第二张空白表，保持模板原样 |

要点：

- 每个大类最多 4 条。超过 4 条必须先合并主题，不能加行。
- 不足 4 条时，剩余槽位留空。
- 不改行高、不改列宽、不改打印设置、不改第二张空白表。
- 完成状态只允许 `✅已完成`、`🟡进行中`、`⏸暂停`、`❌延期`，与模板的数据验证一致。

## 本地配置

真实配置放在本机，不提交到 Git。配置目录沿用 `git-weekly-report`，以兼容已有配置：

```text
~/.config/git-weekly-report/
├── config.json          # workspace、作者邮箱、姓名、输出目录
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
3. `report.person_name` 是否与周报标题一致。
4. `project-map.json` 中的仓库路径是否相对 `workspace`，项目名和标准目标是否符合用户口径。

`config.json` 示例：

```json
{
  "workspace": "/Users/you/work",
  "authors": ["you@example.com"],
  "output_dir": "/Users/you/work",
  "scan_depth": 5,
  "report": {
    "person_name": "张三"
  }
}
```

`report.person_name` 用于标题 `个人周报——张三` 和工作表名；未设置时回退到 `report.json` 的 `person_name`，再回退到 `员工姓名`。

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
- 输出 `commits.json`，包含 `commits`、`unmapped`、`ignored`、`stats`。
- `ignored` 记录 `ignored_repos` 中符合作者和日期范围的本人提交，不能静默跳过。

### 3. 处理未归类与被忽略仓库

如果 `unmapped` 不为空，先不要生成周报。把仓库名、提交数、样例提交列给用户，让用户选择：

- 归入已有项目：把仓库加到该项目的 `repos`。
- 新建项目：补 `goal` 和 `strategic`。
- 忽略：加入 `ignored_repos`。

更新 `~/.config/git-weekly-report/project-map.json` 后重新运行提取。确认 `unmapped` 为空，或用户明确同意忽略。

每次生成周报前还必须检查 `ignored` 和 `stats.ignored_commit_count`：

- 如果 `ignored` 非空，先向用户列出被排除的仓库、本人提交数和样例提交。
- 只有用户明确确认这些提交不属于本周报范围时，才能继续生成。
- 如果属于工作内容，优先移到 `projects`，不要为了消掉提示继续保留在 `ignored_repos`。

### 4. 生成 report.json

读取 `commits.json`，按项目归并提交，写出 `report.json`。不要直接把 commit 列表塞进 Excel。

`report.json` 结构：

```json
{
  "person_name": "张三",
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
          "status": "✅已完成",
          "deviation": "",
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
          "status": "✅已完成",
          "deviation": "",
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

**重点项目**（3-4 条）：

- 战略性、功能级、跨多天或多仓库。
- 对用户可见，或涉及架构、协议、核心链路。
- 一个项目提交很多时，按主题拆成 2-3 个重点项目，而不是逐条列提交。

**日常工作**（2-4 条）：

- 小修复、文档、配置、构建、环境维护。
- 单条或少量提交，但确实占用了工作时间。
- 不要为了凑数把重点项目拆成日常。

总数不超过 8 条，正好填满模板的 4+4 行。

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
| `✅已完成` | 本周工作闭环，无遗留 |
| `🟡进行中` | 已启动、按计划推进，但本周未闭环 |
| `⏸暂停` | 因依赖、资源或优先级变化暂停 |
| `❌延期` | 有阻塞、延期或范围变化 |

兼容旧写法：`完成` → `✅已完成`，`进行中` / `部分完成` → `🟡进行中`，`暂停` → `⏸暂停`，`有偏差` → `❌延期`。新报告请直接写模板状态。

**偏差说明**

- 状态不是 `✅已完成` 时必填，写具体原因，例如“等待第三方接口联调”“硬件环境未到位”“范围新增，顺延到下周”。
- 状态是 `✅已完成` 时留空；写 `无` 也会在渲染时按空处理。

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
  --output "/Users/you/work/个人周报_张三_20261019-20261025.xlsx"

# 或省略 --output：使用 config.json 的 output_dir，文件名自动生成
uv run --with openpyxl python "$SKILL_DIR/scripts/render_report.py" \
  --input /tmp/git-weekly-report/report.json
```

默认使用 `assets/ujoin-weekly-template.xlsx`；需要临时换模板时用 `--template`，或在 `config.json` 的 `report.template` 中设置。

输出只有一个工作表，表名为 `report.person_name`。

### 8. 校验

```bash
uv run --with openpyxl python "$SKILL_DIR/scripts/validate_report.py" \
  --report /tmp/git-weekly-report/report.json \
  --commits /tmp/git-weekly-report/commits.json \
  --xlsx "/Users/you/work/个人周报_张三_20261019-20261025.xlsx"
```

校验内容：

- 每个有提交的项目是否被周报覆盖。
- 是否还有未归类仓库。
- 字段、状态、偏差是否合理。
- 每个条目是否有提交证据。
- 是否严格等于模板：标题、说明、周期、表头、8 个合并区域、列宽、行高、数据验证、字体/底色/边框/对齐，逐单元格比对。
- 重点项目 / 日常工作是否超过 4 条。
- 第二张空白表是否被改动。

校验失败时，修 `report.json` 后重新渲染，不要手改 Excel。

### 9. 交付前检查

- 打开文件确认标题姓名、周期正确。
- 重点项目 4 行、日常工作 4 行，空槽位保持空白。
- 状态全部是 `✅已完成` / `🟡进行中` / `⏸暂停` / `❌延期`。
- 非完成项都有偏差说明。
- 没有文字被截断（模板行高自动撑开，不需要手工调）。

## Excel 版式

版式完全由模板决定，渲染器只写数据单元格：

- 标题行 `个人周报——<姓名>`，合并 A1:F1，`1F4E79` 底、白字 16 号加粗。
- 说明行合并 A2:F2。
- 周期行 `周报周期：...`，合并 A3:F3，`C7DCFF` 底、`404040` 字。
- 表头行 `FFF2CC` 底、10 号加粗、细边框 `BFBFBF`。
- 重点项目标签 `2E75B6` 底、白字竖排；日常工作标签 `548235` 底、白字竖排。
- 列宽：B 23.0625、C 37.5312、D 61.3203，A/E/F 用默认宽度。
- 行高不设置，交给 Excel 自动撑开。
- 网格线显示；页面设置保持模板默认，不做 A4 横向强制缩放。
- 数据验证：`E5:E12` 和 `E15:E22` 为 `✅已完成,🟡进行中,⏸暂停,❌延期`。

详细规则见 `references/report-spec.md`。

## 质量检查清单

- [ ] 周期正确，和用户说的“上周”一致。
- [ ] `stats.total` 与预期提交数一致。
- [ ] `unmapped` 已处理。
- [ ] `ignored` 已审查，`stats.ignored_commit_count` 已向用户说明。
- [ ] 每个有提交的项目都有对应周报条目。
- [ ] 每个条目都有 `evidence.commit_count > 0`。
- [ ] 重点项目 3-4 条，日常工作 2-4 条。
- [ ] 非 `✅已完成` 的条目都有偏差说明。
- [ ] 没有编造提交之外的工作。
- [ ] 生成文件能正常打开。
- [ ] 校验输出 `[PASS]`，0 error。

## 常见问题

**没有提交**

- 检查 `workspace` 是否指向多仓库父目录。
- 检查 `authors` 是否包含所有提交邮箱。
- 检查日期范围是否按 author date 落在预期周。
- 如果工作在其他机器上，先 `git fetch` 或确认本地分支。

**有未归类仓库**

- 不要静默忽略。把仓库和样例提交列给用户确认。
- 确认后更新 `project-map.json`，再重新提取。

**有被忽略仓库的本人提交**

- 不要只看 `stats.total`。同时检查 `ignored` 和 `stats.ignored_commit_count`。
- 如果被排除的是实际工作，把仓库加入对应 `projects`，然后重新提取。
- 如果确认不需要进入周报，保留 `ignored_repos`，但仍需在本次处理中向用户说明数量。

**超过 4 条放不下**

- 模板每个大类只有 4 行，不能加行。
- 合并同类项，或把次要内容降级到日常工作，必要时删掉价值最低的条目。

**模板文件打不开**

- `ujoin周报模板.xlsx` 由 WPS 生成，`styles.xml` 里有 `<fill/>`，openpyxl 会报 `Fill() takes no arguments`。
- 渲染器和校验器会自动修补这个临时副本；仓库内的 `assets/ujoin-weekly-template.xlsx` 已经修好，不需要手工处理。

**OpenCode 看不到新 skill**

- 确认 `~/.agents/skills/uj-weekly-report` 是 symlink 且指向本仓库。
- 重开一个 OpenCode 会话。
- 如果 symlink 不被识别，运行 `skill-manager install uj-weekly-report --agent opencode` 做复制安装。

## 参考

- `assets/ujoin-weekly-template.xlsx`：唯一版式来源。
- `references/report-spec.md`：字段、状态、模板结构、校验规则。
- `references/examples.md`：脱敏示例。
- `references/config.example.json`：本机配置示例。
- `references/project-map.example.json`：项目映射示例。
