# skill-manager

UJoin 自研 AI Skills 的全生命周期管理 CLI：查看 skill 库、安装到指定 Agent、卸载、更新本地仓库、检查并同步已安装 Skill。仓库同时集中维护这些自研 skills。

## 当前内容

周报 Skill 使用 `uj-` 前缀。

- `task-forge`（目录：`skills/task-forge/`）
- `spec-workflow`（目录：`skills/spec-workflow/`）
- `nest-lib-gen`（目录：`skills/nest-lib-gen/`）
- `nest-dev-tools`（目录：`skills/nest-dev-tools/`）
- `skill-creator-x`（目录：`skills/skill-creator-x/`）
- `uj-weekly-report`（目录：`skills/uj-weekly-report/`）

`uj-weekly-report` 从本地多仓库 Git 提交生成中文周报 Excel，100% 套用 UJoin《个人周报》模板（个人周报——姓名 / 周报周期 / 大类 / 名称 / 目标 / 进展 / 完成状态 / 偏差说明，重点项目 4 行 + 日常工作 4 行）。版式来源是 `skills/uj-weekly-report/assets/ujoin-weekly-template.xlsx`，渲染器只替换数据单元格。

## 仓库边界

- 本仓库只管理**自研 skills**。
- 通过 `npx skills` 安装的外部 skills（如 `apple-design`、`ui-ux-pro-max`）继续由 `npx skills` 管理，不复制进本仓库。
- 自研 skill 可以复制安装，也可以用 symlink 安装；外部 skill 的真实目录保持不变。
- 真实的项目映射、作者邮箱、生成结果不提交进仓库；仓库只保留 `*.example.json` 和脱敏示例。

## 全局安装

要求 Node.js >= 20.12（交互式终端依赖 `@clack/prompts`）。

```bash
cd packages/skill-manager

# 方式 A：从本地目录全局安装（会链接回本仓库，适合当前阶段）
npm install -g .

# 方式 B：开发时注册全局命令
npm link

# 方式 C：发布后从 npm 安装
npm install -g ujoin-skill-manager
```

安装后任意目录可用：

```bash
skill-manager --version
skill-manager list

# 短命令，完全等价
skm --version
skm list
```

> 包名使用 `ujoin-skill-manager`，因为 npm 上的 `skill-manager` 已被其他项目占用。命令名保留 `skill-manager`，同时提供 `skm` 短别名。

维护者发布：

```bash
npm login
npm publish
```

发布后其他机器可直接 `npm install -g ujoin-skill-manager`，并用 `skill-manager update` 更新。

## 命令一览

| 命令 | 作用 |
|---|---|
| `skill-manager` | 交互式终端（默认） |
| `skill-manager list` | 查看 skill 库、描述和安装状态 |
| `skill-manager install [skill...]` | 安装 skill 到 Agent |
| `skill-manager uninstall [skill...]` | 从 Agent 卸载 skill |
| `skill-manager update` | 更新本地 CLI / Git 仓库，不修改已安装 Skill |
| `skill-manager update --check` | 只检查本地仓库 / CLI 是否有更新 |
| `skill-manager sync` | 检查并更新已安装 Skill 副本 |
| `skill-manager sync --dry-run` | 只检查已安装 Skill 是否有更新 |
| `skill-manager doctor` | 环境、目录、状态文件、断链和过期副本诊断 |
| `skill-manager agents` | 查看支持的 Agent 及其 skills 目录 |
| `skill-manager link` | 把所有 skill 以 symlink 安装到 Agent（默认 OpenCode 全局；Codex 用 `--agent codex`） |
| `skill-manager help` | 帮助 |

短命令与子命令缩写（`skill-manager` / `skm` 完全等价）：

| 写法 | 等价于 |
|---|---|
| `skm` | `skill-manager` |
| `skm i`、`skm add` | `skm install` |
| `skm ls` | `skm list` |
| `skm un`、`skm rm` | `skm uninstall` |
| `skm up`、`skm upgrade` | `skm update` |
| `skm status` | `skm doctor` |

例如：

```bash
skm                                  # 交互式菜单
skm i uj-weekly-report --agent codex
skm ls
skm up --check
skm un uj-weekly-report --agent codex --yes
```

通用参数：

| 参数 | 说明 |
|---|---|
| `--agent <key>` | `codex` / `opencode` / `claude` / `cursor` / `windsurf`，或完整 key（如 `codex-global`） |
| `--scope <global\|project>` | 全局或项目级目录，默认 `global` |
| `--project <dir>` | project scope 的项目目录，默认当前目录 |
| `--path <dir>` | 自定义 Agent skills 目录 |
| `--copy` | 复制安装（默认，独立副本） |
| `--link` | symlink 安装（本地开发，随仓库更新） |
| `--all` | 对所有 skill 操作 |
| `--force` | 覆盖已存在目标，或删除未托管目标 |
| `--dry-run` | 只显示将要做什么 |
| `--yes`, `-y` | 跳过确认 |
| `--json` | `list` / `agents` 输出 JSON |
| `--verbose` | 显示完整描述和路径 |

## 安装 skill 到 Codex

Codex 全局目录：`$CODEX_HOME/skills`，默认 `~/.codex/skills`。

```bash
# 交互式：先选 Agent，再选 skill 和安装方式
skill-manager install

# 安装单个 skill 到 Codex 全局
skill-manager install uj-weekly-report --agent codex

# 一次安装全部 skill
skill-manager install --all --agent codex --yes

# 安装到当前项目的 .codex/skills
skill-manager install uj-weekly-report --agent codex --scope project

# 本地开发用 symlink
skill-manager install --all --agent codex --link --yes
```

安装完成后在 Codex 对话中使用：

```text
使用 $uj-weekly-report
```

卸载：

```bash
skill-manager uninstall uj-weekly-report --agent codex
skill-manager uninstall --all --agent codex --yes
```

## 交互式终端

直接运行 `skill-manager` 或 `skm` 会进入基于 [`@clack/prompts`](https://github.com/bombshell-dev/clack) 的交互式终端（与 `vercel-labs/skills` 同一套交互方案）：

```text
┌  Skill Manager v0.3.0
│
◇  当前状态
│  Skill 库  6 个
│  已安装    1 个副本
│
◆  你想做什么？
│  ● 查看 Skill 库 (6 个 skill)
│  ○ 安装 Skill 到 Agent
│  ○ 卸载 Agent 中的 Skill
│  ○ 检查并更新本地仓库
│  ○ 检查并更新已安装 Skill
│  ○ 环境诊断
│  ○ 查看 Agent 目录
│  ○ 退出
```

仓库更新与已安装 Skill 更新是两个独立操作：前者只更新 CLI / Git 仓库，后者只同步 Agent 中由本 CLI 管理的副本。交互式终端各提供一个“检查并更新”入口，均先检查；有更新时再询问是否更新，无更新时提示后返回主页。

操作方式：

| 按键 | 作用 |
|---|---|
| `↑` / `↓` | 移动选项 |
| `Enter` | 确认 / 执行 |
| 直接输入 | 在 Agent / skill 列表中搜索过滤 |
| `Tab` | 多选时勾选 / 取消勾选 |
| `Esc` / `Ctrl+C` | 取消当前操作 |

非 TTY 环境（管道、CI、脚本）不会启动交互界面，而是回退为帮助信息；脚本中请使用显式命令和 `--yes`。

Agent 列表 Codex 排在最前：

- Codex (Global) → `$CODEX_HOME/skills`
- Codex (Project) → `<project>/.codex/skills`
- OpenCode (Global) → `~/.agents/skills`
- Claude Code / Cursor / Windsurf
- 自定义 Agent 路径

卸载时会标记“未托管”的目录：这类目录不是本 CLI 安装的，需要二次确认才会强制删除。

## 更新机制

仓库更新与已安装 Skill 更新是两个独立操作，不会互相隐式触发。

### 更新本地仓库（`skm update`）

```bash
skill-manager update --check   # 只检查本地仓库 / CLI 是否有更新
skill-manager update --yes     # 只更新本地仓库 / CLI
```

#### Git checkout（本地仓库 / `npm install -g .` 的 symlink 安装）

行为：

- 没有 `origin` remote：提示先配置 remote。
- 没有 upstream：提示设置 `git branch --set-upstream-to=origin/main`。
- 工作区有未提交改动：拒绝自动更新，先提交或 stash。
- 更新成功后只变更本地仓库，不修改 Agent 中已安装的 Skill。

#### npm 全局安装（从 registry 安装）

行为：

- 读取 `package.json` 的包名，查询 npm registry 最新版本。
- 有新版本时执行 `npm install -g <包名>@latest`。
- 更新后只影响 CLI，不同步已安装 Skill。

### 更新已安装 Skill（`skm sync`）

```bash
skill-manager sync --dry-run   # 只检查 Agent 中的已安装副本是否有变化
skill-manager sync             # 按当前仓库内容更新已安装副本
```

行为：

- 仅处理安装记录中由本 CLI 管理的 Skill 副本。
- 复制安装会对比源目录与目标副本；符号链接安装会检查链接指向。
- 可选择在交互式终端中先检查，确认后再更新。
- 出现冲突或源 Skill 缺失时会单独提示，不会隐式修改本地仓库。

推荐维护流程：

```bash
skm update --check   # 1. 检查本地仓库
skm update --yes     # 2. 更新本地仓库
skm sync --dry-run   # 3. 检查已安装 Skill
skm sync             # 4. 更新已安装 Skill
```

**结论：**

- `update` 只负责 CLI / Git 仓库，`sync` 只负责 Agent 中已安装的 Skill。
- 从 npm registry 安装的用户可继续使用 `npm update -g ujoin-skill-manager`；它不会同步 Skill 副本。
- 当前包未发布时，`update` 会提示“未发布”，回到源码仓库执行 `git pull` 或重新 `npm install -g <path>`。

## 安装状态

CLI 把安装记录写到：

```text
~/.config/skill-manager/state.json
```

可用 `SKILL_MANAGER_HOME` 或 `XDG_CONFIG_HOME` 覆盖。

记录内容包括 Agent、skills 目录、skill、安装方式、源路径、源内容 hash、版本和安装时间。复制安装还会在目标目录写入 `.skill-manager.json`，用于识别“这是本 CLI 安装的副本”。

`skill-manager sync` 会比较源和目标的 hash：

- 源更新：重新复制。
- 目标被手改：恢复为源版本。
- symlink：只检查/修复链接。
- 源 skill 已删除：报告 `missing-source`，不会静默删除目标。

## 支持的 Agent

| Agent | 全局目录 | 项目目录 |
|---|---|---|
| Codex | `$CODEX_HOME/skills` | `<project>/.codex/skills` |
| OpenCode | `~/.agents/skills` | - |
| Claude Code | `~/.claude/skills` | `<project>/.claude/skills` |
| Cursor | `~/.cursor/skills` | `<project>/.cursor/skills` |
| Windsurf | `~/.codeium/windsurf/skills` | `<project>/.windsurf/skills` |

## 开发

```bash
# 语法检查 + 所有 skill 校验 + CLI 测试
npm run validate

# 只跑 CLI 测试
npm test

# 从模板创建新 skill
npm run new -- my-skill
```

`npm run validate` 会执行：

- `bin/`、`src/`、`test/` 下所有 JS 的 `node --check`。
- `scripts/validate_skills.py`：frontmatter、目录/名称一致性、相对链接、Python/Shell 语法、密钥泄漏。
- `node --test`：Agent 解析、frontmatter、semver、安装/卸载/同步、CLI 端到端、git 更新。

## 目录结构

```text
packages/skill-manager/
├── bin/
│   └── skill-manager.js       # CLI 入口
├── src/
│   ├── agents.js              # Agent 注册表与路径解析
│   ├── cli.js                 # 命令分发与交互菜单
│   ├── config.js              # 包路径、状态目录
│   ├── frontmatter.js         # SKILL.md frontmatter 解析
│   ├── install.js             # 安装、卸载、检测、同步
│   ├── skills.js              # skill 扫描、hash、复制
│   ├── state.js               # 安装状态读写
│   ├── tui.js                 # Clack 交互式终端封装
│   ├── update.js              # git/npm 更新检查与执行
│   └── util.js
├── skills/
│   ├── task-forge/
│   ├── spec-workflow/
│   ├── nest-lib-gen/
│   ├── nest-dev-tools/
│   ├── skill-creator-x/
│   └── uj-weekly-report/
├── test/
├── scripts/
│   ├── link-skills.sh
│   ├── unlink-skills.sh
│   ├── validate-skills.sh
│   └── validate_skills.py
└── package.json
```

## uj-weekly-report 的本地配置

真实配置放在本机，不进入 Git。配置目录沿用 `git-weekly-report`，以兼容已有配置：

```text
~/.config/git-weekly-report/
├── config.json          # workspace、作者邮箱、姓名、输出目录
└── project-map.json     # 仓库 -> 项目映射
```

仓库内只保留：

```text
skills/uj-weekly-report/assets/ujoin-weekly-template.xlsx   # 脱敏后的空白模板
skills/uj-weekly-report/references/config.example.json
skills/uj-weekly-report/references/project-map.example.json
```

首次使用时，按示例创建本地配置，再运行 skill。详细步骤见 `skills/uj-weekly-report/SKILL.md`。

## Git remote

仓库已配置远端：

```text
origin  https://github.com/xiaoyaos/skill-manager.git
```

当前分支 `main` 跟踪 `origin/main`。`skill-manager update` 通过 `git fetch` 检查、`git pull --ff-only` 更新。
