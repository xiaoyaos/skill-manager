---
name: nest-dev-tools
description: "面向 nest-base 生态提供项目框架识别、开发改动与问题检查工具流。用于识别项目是否为 Node/NestJS/nest-base、实施开发并输出结构化校验结果与风险。"
---

# Nest Dev Tools

Use this skill as the default workflow for coding tasks in `nest-base` ecosystem projects.

## Fixed 3-Step Flow

Always execute in this order:

1. Identify framework stack.
2. Implement development changes.
3. Check project issues and summarize.

## Step 1: Identify Framework

Run:

```bash
bash scripts/framework_dev_check.sh <project-dir>
```

Record:

1. Is it Node-only?
2. Is it NestJS?
3. Is `nest-base` integration expected?
4. Is it an app or a reusable package?

## Step 2: Develop

Based on detected stack:

1. For Node-only package: keep pure Node/TS boundaries.
2. For NestJS package: follow module/provider/decorator conventions.
3. For NestJS app with `nest-base`: keep `setupNestCommon` and `NestCommonModule.forRoot` conventions.

Make code changes directly in workspace.

## Step 3: Check Issues

After coding:

1. Re-run `framework_dev_check.sh`.
2. Run project build/test commands when available.
3. Report failures, warnings, and unresolved risks.

## Output Contract

Return:

1. Framework identification result.
2. Files changed and why.
3. Validation commands and outcomes.
4. Remaining risks and suggested next actions.

## Optional Reference

See workflow details:
`references/workflow.md`
