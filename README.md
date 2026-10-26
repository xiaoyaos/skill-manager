# skill-manager

用于集中维护与分发 AI Skills 的仓库，同时提供一个可通过 npm 全局安装的交互式 CLI。

## 当前内容

- 已从 `nest-base` 项目整体迁移 `skills/` 目录到本项目。
- 当前包含三个核心 skill：
  1. `nest-lib-gen`（目录：`skills/nest-lib-gen/`）
  2. `nest-dev-tools`（目录：`skills/nest-dev-tools/`）
  3. `skill-creator-x`
- 提供 `skill-manager` Node.js CLI，可浏览技能库并将当前仓库中的 skill 安装到不同 Agent 的 skills 目录。

## 两种维护模式对比

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

## CLI 使用

### 本地开发

```bash
npm install
npm run start
```

### 全局安装

本地全局安装当前仓库：

```bash
npm install -g .
skill-manager
```

开发期也可以使用：

```bash
npm link
skill-manager
```

发布到 npm 后，可直接执行：

```bash
npm install -g skill-manager
skill-manager
```

### 兼容入口

原有 Shell 入口仍然保留，但已切换为调用 Node CLI：

```bash
bash skills/skill-manager.sh
```

## 目录结构

```text
skill-manager/
├── README.md
├── package.json
├── bin/
│   └── skill-manager.js
└── skills/
    ├── nest-lib-gen/
    ├── nest-dev-tools/
    ├── skill-creator-x/
    └── skill-manager.sh
```
