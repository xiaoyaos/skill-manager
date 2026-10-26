# skill-manager

UJoin 自研 AI Skills 的全生命周期管理 CLI：查看 skill 库、安装到指定 Agent、卸载、检查更新、更新并同步。仓库同时集中维护这些自研 skills。

## 当前内容

- `nest-lib-gen`（目录：`skills/nest-lib-gen/`）
- `nest-dev-tools`（目录：`skills/nest-dev-tools/`）
- `skill-creator-x`（目录：`skills/skill-creator-x/`）
- `git-weekly-report`（目录：`skills/git-weekly-report/`）

`git-weekly-report` 从本地多仓库 Git 提交生成中文周报 Excel，100% 套用 UJoin《个人周报》模板（个人周报——姓名 / 周报周期 / 大类 / 名称 / 目标 / 进展 / 完成状态 / 偏差说明，重点项目 4 行 + 日常工作 4 行）。版式来源是 `skills/git-weekly-report/assets/ujoin-weekly-template.xlsx`，渲染器只替换数据单元格。

## 仓库边界

- 本仓库只管理**自研 skills**。
- 通过 `npx skills` 安装的外部 skills（如 `apple-design`、`ui-ux-pro-max`）继续由 `npx skills` 管理，不复制进本仓库。
- 自研 skill 可以复制安装，也可以用 symlink 安装；外部 skill 的真实目录保持不变。
- 真实的项目映射、作者邮箱、生成结果不提交进仓库；仓库只保留 `*.example.json` 和脱敏示例。

## 全局安装

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
sm --version
skm list
```

> 包名使用 `ujoin-skill-manager`，因为 npm 上的 `skill-manager` 已被其他项目占用。命令名保留 `skill-manager`，同时提供 `sm` 和 `skm` 两个短别名。

维护者发布：

```bash
npm login
npm publish
```

发布后其他机器可直接 `npm install -g ujoin-skill-manager`，并用 `skill-manager update` 更新。

## 命令一览

| 命令 | 作用 |
|---|---|
| `skill-manager` | 交互式菜单（默认） |
| `skill-manager list` | 查看 skill 库、描述和安装状态 |
| `skill-manager install [skill...]` | 安装 skill 到 Agent |
| `skill-manager uninstall [skill...]` | 从 Agent 卸载 skill |
| `skill-manager update` | 检查并拉取最新 CLI / skill 仓库，然后同步副本 |
| `skill-manager update --check` | 只检查更新，不修改 |
| `skill-manager sync` | 把已安装的复制副本同步到当前仓库版本 |
| `skill-manager doctor` | 环境、目录、状态文件、断链和过期副本诊断 |
| `skill-manager agents` | 查看支持的 Agent 及其 skills 目录 |
| `skill-manager link` | 把所有 skill 以 symlink 安装到 Agent（默认 OpenCode 全局；Codex 用 `--agent codex`） |
| `skill-manager help` | 帮助 |

短命令与子命令缩写（`skill-manager` / `sm` / `skm` 完全等价）：

| 写法 | 等价于 |
|---|---|
| `sm`、`skm` | `skill-manager` |
| `sm i`、`sm add` | `sm install` |
| `sm ls` | `sm list` |
| `sm un`、`sm rm` | `sm uninstall` |
| `sm up`、`sm upgrade` | `sm update` |
| `sm status` | `sm doctor` |

例如：

```bash
sm                                  # 交互式菜单
sm i git-weekly-report --agent codex
sm ls
sm up --check
sm un git-weekly-report --agent codex --yes
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
skill-manager install git-weekly-report --agent codex

# 一次安装全部 skill
skill-manager install --all --agent codex --yes

# 安装到当前项目的 .codex/skills
skill-manager install git-weekly-report --agent codex --scope project

# 本地开发用 symlink
skill-manager install --all --agent codex --link --yes
```

安装完成后在 Codex 对话中使用：

```text
使用 $git-weekly-report
```

卸载：

```bash
skill-manager uninstall git-weekly-report --agent codex
skill-manager uninstall --all --agent codex --yes
```

## 交互式菜单

直接运行 `skill-manager`：

```text
1) 查看 skill 库
2) 安装 skill 到 Agent
3) 卸载 Agent 中的 skill
4) 检查更新
5) 更新并同步
6) 环境诊断
7) 查看 Agent 目录
0) 退出
```

Agent 列表 Codex 排在最前：

- Codex (Global) → `$CODEX_HOME/skills`
- Codex (Project) → `<project>/.codex/skills`
- OpenCode (Global) → `~/.agents/skills`
- Claude Code / Cursor / Windsurf
- 自定义 Agent 路径

## 更新机制

`skill-manager update` 会自动识别安装方式：

### Git checkout（本地仓库 / `npm install -g .` 的 symlink 安装）

```bash
skill-manager update --check   # 查看落后多少个提交
skill-manager update --yes     # git pull --ff-only，然后同步已安装副本
```

行为：

- 没有 `origin` remote：提示先配置 remote。
- 没有 upstream：提示设置 `git branch --set-upstream-to=origin/main`。
- 工作区有未提交改动：拒绝自动更新，先提交或 stash。
- 更新成功后，对复制安装的 skill 执行 `sync`；symlink 安装自动指向新代码。

### npm 全局安装（从 registry 安装）

```bash
skill-manager update --check
skill-manager update --yes
```

行为：

- 读取 `package.json` 的包名，查询 npm registry 最新版本。
- 有新版本时执行 `npm install -g <包名>@latest`。
- 更新后同步已安装副本。

**结论：**

- 从 npm registry 安装的用户，`npm update -g ujoin-skill-manager` 就够了；本 CLI 的 `update` 只是把它和 skill 副本同步串起来。
- 从本地 Git 仓库安装 / symlink 的用户，npm 包更新帮不上忙，需要 `git pull`；`skill-manager update` 会自动处理。
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
│   ├── ui.js                  # 交互提示
│   ├── update.js              # git/npm 更新检查与执行
│   └── util.js
├── skills/
│   ├── nest-lib-gen/
│   ├── nest-dev-tools/
│   ├── skill-creator-x/
│   └── git-weekly-report/
├── test/
├── scripts/
│   ├── link-skills.sh
│   ├── unlink-skills.sh
│   ├── validate-skills.sh
│   └── validate_skills.py
└── package.json
```

## git-weekly-report 的本地配置

真实配置放在本机，不进入 Git：

```text
~/.config/git-weekly-report/
├── config.json          # workspace、作者邮箱、姓名、输出目录
└── project-map.json     # 仓库 -> 项目映射
```

仓库内只保留：

```text
skills/git-weekly-report/assets/ujoin-weekly-template.xlsx   # 脱敏后的空白模板
skills/git-weekly-report/references/config.example.json
skills/git-weekly-report/references/project-map.example.json
```

首次使用时，按示例创建本地配置，再运行 skill。详细步骤见 `skills/git-weekly-report/SKILL.md`。

## Git remote

仓库当前以本地 Git 管理。需要远端时：

```bash
git remote add origin <your-repo-url>
git push -u origin main
```

配置 remote 后，`skill-manager update` 才能通过 `git pull` 更新。
