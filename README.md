# skill-manager

用于集中维护与分发自研 AI Skills 的 Git 仓库，同时提供一个可通过 npm 全局安装的交互式 CLI。

## 当前内容

- `nest-lib-gen`（目录：`skills/nest-lib-gen/`）
- `nest-dev-tools`（目录：`skills/nest-dev-tools/`）
- `skill-creator-x`（目录：`skills/skill-creator-x/`）
- `git-weekly-report`（目录：`skills/git-weekly-report/`）

`git-weekly-report` 从本地多仓库 Git 提交生成中文周报 Excel，100% 套用 UJoin《个人周报》模板（个人周报——姓名 / 周报周期 / 大类 / 名称 / 目标 / 进展 / 完成状态 / 偏差说明，重点项目 4 行 + 日常工作 4 行）。版式来源是 `skills/git-weekly-report/assets/ujoin-weekly-template.xlsx`，渲染器只替换数据单元格。

## 仓库边界

- 本仓库只管理**自研 skills**。
- 通过 `npx skills` 安装的外部 skills（如 `apple-design`、`ui-ux-pro-max`）继续由 `npx skills` 管理，不复制进本仓库。
- 自研 skill 通过 symlink 安装到 Agent 的 skills 目录；外部 skill 的真实目录保持不变。
- 真实的项目映射、作者邮箱、生成结果不提交进仓库；仓库只保留 `*.example.json` 和脱敏示例。

## 快速开始

```bash
# 校验 CLI 和所有 skill
npm run validate

# 链接全部自研 skill 到 OpenCode 全局目录
npm run link

# 取消链接（只删除指向本仓库的 symlink）
npm run unlink

# 从模板创建一个新 skill
npm run new -- my-skill
```

`npm run link` 默认目标：

```text
~/.agents/skills/<skill-name>
  -> <repo>/skills/<skill-name>
```

可以通过环境变量覆盖：

```bash
OPENCODE_SKILLS_DIR=/path/to/skills npm run link
```

脚本行为：

- 目标不存在：创建 symlink。
- 目标已是指向本仓库的 symlink：保持不动。
- 目标是指向其他位置的 symlink：更新为本仓库。
- 目标是真实目录：跳过并提示，不覆盖外部 skill。

## CLI 使用

### 本地开发

```bash
npm install
npm run start
```

### 全局安装

```bash
npm install -g .
skill-manager
```

开发期也可以使用：

```bash
npm link
skill-manager
```

### 兼容入口

```bash
bash skill-manager.sh
```

CLI 支持将当前仓库中的 skill **复制安装**到不同 Agent 的 skills 目录，包括 Codex、OpenCode、Claude Code、Cursor、Windsurf，也支持自定义路径。

- 复制安装适合分发和稳定使用。
- `npm run link` 的 symlink 安装适合本仓库开发：修改 skill 后无需重新安装。
- CLI 的 OpenCode profile 指向 `~/.agents/skills`。

## 目录结构

```text
skill-manager/
├── README.md
├── package.json
├── .gitignore
├── skill-manager.sh
├── bin/
│   └── skill-manager.js
├── scripts/
│   ├── link-skills.sh
│   ├── unlink-skills.sh
│   ├── validate-skills.sh
│   └── validate_skills.py
└── skills/
    ├── nest-lib-gen/
    ├── nest-dev-tools/
    ├── skill-creator-x/
    └── git-weekly-report/
```

每个 skill 的通用结构：

```text
skills/<skill-name>/
├── SKILL.md          # 必需：frontmatter + 工作流
├── scripts/          # 可选：可执行脚本
├── references/       # 可选：按需加载的详细资料
└── assets/           # 可选：模板、图片等输出资源
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

## 维护模式

### 方案 A：所有 skills 合并到一个中心仓库

优点：

1. 标准统一、版本可控。
2. 质量与评审流程一致。
3. 分发简单，团队上手快。

缺点：

1. 中心仓可能成为发布瓶颈。
2. 项目个性需求响应相对慢。

### 方案 B：每个项目自维护一套 skills，再发布到指定仓库

优点：

1. 业务贴合度高，迭代快。
2. 项目自治强。

缺点：

1. 容易重复建设、标准漂移。
2. 长期维护和协同成本高。

## 推荐结论

推荐采用“中心仓统一分发 + 项目仓本地扩展”的混合模式：

1. 中心仓维护通用核心 skills（统一标准与版本）。
2. 项目仓维护本地扩展 skills（快速适配业务）。
3. CLI 支持安装、同步、发布；解析优先级建议为：项目本地 > 中心仓 > 系统技能。

如果仅能二选一，当前阶段优先选择“中心仓为主”。

## 提交前检查

```bash
npm run validate
```

检查内容：

- `bin/skill-manager.js` 语法。
- 每个 `SKILL.md` 的 frontmatter、名称与目录一致性。
- 相对链接是否存在。
- Python / Shell 脚本语法。
- 明显的密钥泄漏。

## Git remote

仓库先以本地 Git 管理。需要远端时：

```bash
git remote add origin <your-repo-url>
git push -u origin main
```
