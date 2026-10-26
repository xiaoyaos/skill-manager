---
name: nest-lib-gen
description: "基于 nest-base 生态架构模式生成新的 Nest 组件库。用于快速创建以下模式之一：单 Nest 组件包、core+nest 分层组件包、core+nest+nest-base 适配分层组件包。"
---

# Nest Library Generator

Use this skill to select a generation mode first, then scaffold a new component library.

## Supported Modes

1. `single-nest`: one NestJS package.
2. `core-nest`: layered reusable package (`core` + `nest`).
3. `core-nest-nestbase`: layered package with optional nest-base adapter.

## Generate Command

```bash
bash scripts/generate_component_library.sh <domain-name> [target-dir] [--mode <mode>] --scope @your-scope
```

Example:

```bash
bash scripts/generate_component_library.sh device-audit ./packages --mode core-nest-nestbase --scope @acme
```

Defaults:

1. `target-dir`: `~/.nest-base/`
2. `mode`: `core-nest`

Required:

1. `--scope` is mandatory (must start with `@`).

## AI Selection Rule

Before generation, AI chooses mode:

1. Use `single-nest` for fast project-local components.
2. Use `core-nest` for reusable libraries in NestJS ecosystem.
3. Use `core-nest-nestbase` when org conventions rely on `nest-base`.

## Output Contract

Return:

1. Selected mode and reason.
2. Created package paths.
3. Next commands to build and integrate.

## Optional Reference

See mode details:
`references/modes.md`
