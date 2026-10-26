# Workflow Detail

This reference explains the 3-step execution pattern in detail.

## 1) Framework Identification

Check:

1. `package.json` dependencies and scripts
2. NestJS app entry files (`main.ts`, `app.module.ts`)
3. Whether `nest-base` integration markers exist

Classify project as:

1. Node generic package
2. NestJS library package
3. NestJS app
4. NestJS app with nest-base conventions

## 2) Development Execution

Guidelines:

1. Keep changes minimal and aligned to detected framework.
2. Do not force nest-base patterns into Node-only packages.
3. Keep core logic framework-agnostic when building reusable packages.

## 3) Issue Check

At minimum:

1. Re-run framework check script.
2. Run build/test when available.
3. Summarize failures, warnings, and risks.
