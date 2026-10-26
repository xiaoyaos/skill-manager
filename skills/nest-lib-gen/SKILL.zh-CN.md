# Nest 组件库生成器

该 skill 用于“先进行模式选择，再基于 nest-base 生态生成新的组件库”。

## 支持模式

1. `single-nest`：单个 NestJS 组件包。
2. `core-nest`：分层组件包（`core + nest`）。
3. `core-nest-nestbase`：分层组件包（`core + nest + nest-base` 适配层）。

## 生成命令

```bash
bash scripts/generate_component_library.sh <domain-name> [target-dir] [--mode <mode>] --scope @your-scope
```

示例：

```bash
bash scripts/generate_component_library.sh device-audit ./packages --mode core-nest-nestbase --scope @acme
```

默认值：

1. `target-dir`：`~/.nest-base/`
2. `mode`：`core-nest`

必填项：

1. `--scope` 必须传入，且以 `@` 开头。

## AI 选择规则

生成前先选模式：

1. 追求最快集成：`single-nest`
2. 追求复用和解耦：`core-nest`
3. 需要组织级 nest-base 约定：`core-nest-nestbase`

## 输出规范

结果需包含：

1. 选择了哪种模式及理由。
2. 创建了哪些包路径。
3. 后续构建和接入命令。

## 参考

详见：
`references/modes.md`
