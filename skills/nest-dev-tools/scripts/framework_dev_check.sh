#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  framework_dev_check.sh [project-dir] [--strict] [--run-build]

Arguments:
  [project-dir]  Target project directory. Default: current directory
  [--strict]     Treat warnings as failures
  [--run-build]  Run npm build script if present
USAGE
}

PROJECT_DIR="$(pwd)"
STRICT=0
RUN_BUILD=0

for arg in "$@"; do
  case "$arg" in
    -h|--help)
      usage
      exit 0
      ;;
    --strict)
      STRICT=1
      ;;
    --run-build)
      RUN_BUILD=1
      ;;
    *)
      PROJECT_DIR="$arg"
      ;;
  esac
done

if [[ ! -d "$PROJECT_DIR" ]]; then
  echo "[FAIL] Project directory not found: $PROJECT_DIR"
  exit 2
fi

PACKAGE_JSON="$PROJECT_DIR/package.json"
if [[ ! -f "$PACKAGE_JSON" ]]; then
  echo "[FAIL] package.json not found: $PACKAGE_JSON"
  exit 2
fi

find_project_file() {
  local dir="$1"
  local name="$2"
  find "$dir" \
    -type d \( -name node_modules -o -name dist -o -name .git \) -prune -o \
    -type f -name "$name" -print | head -n 1 || true
}

contains_text() {
  local file="$1"
  local pattern="$2"
  if command -v rg >/dev/null 2>&1; then
    rg -q "$pattern" "$file"
  else
    grep -Eq "$pattern" "$file"
  fi
}

main_ts="$(find_project_file "$PROJECT_DIR" "main.ts")"
app_module_ts="$(find_project_file "$PROJECT_DIR" "app.module.ts")"
has_src=0
if [[ -d "$PROJECT_DIR/src" ]]; then
  has_src=1
fi

set +e
NODE_META="$(
  node - "$PACKAGE_JSON" <<'NODE'
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const allDeps = {
  ...(pkg.dependencies || {}),
  ...(pkg.devDependencies || {}),
  ...(pkg.peerDependencies || {}),
};
const hasNest = Object.keys(allDeps).some((k) => k.startsWith('@nestjs/'));
const hasNestBase = Boolean(allDeps['nest-base']) || pkg.name === 'nest-base';
const isPrivate = pkg.private === true;
const hasBuild = Boolean(pkg.scripts && pkg.scripts.build);
const hasTest = Boolean(pkg.scripts && pkg.scripts.test);
const hasLint = Boolean(pkg.scripts && pkg.scripts.lint);
console.log(`name=${pkg.name || ''}`);
console.log(`has_nest=${hasNest ? '1' : '0'}`);
console.log(`has_nest_base=${hasNestBase ? '1' : '0'}`);
console.log(`is_private=${isPrivate ? '1' : '0'}`);
console.log(`has_build=${hasBuild ? '1' : '0'}`);
console.log(`has_test=${hasTest ? '1' : '0'}`);
console.log(`has_lint=${hasLint ? '1' : '0'}`);
NODE
)"
NODE_STATUS=$?
set -e

if [[ "$NODE_STATUS" -ne 0 ]]; then
  echo "[FAIL] Failed to parse package metadata."
  exit 2
fi

pkg_name="$(echo "$NODE_META" | sed -n '1p' | cut -d= -f2-)"
has_nest="$(echo "$NODE_META" | sed -n '2p' | cut -d= -f2-)"
has_nest_base="$(echo "$NODE_META" | sed -n '3p' | cut -d= -f2-)"
is_private="$(echo "$NODE_META" | sed -n '4p' | cut -d= -f2-)"
has_build="$(echo "$NODE_META" | sed -n '5p' | cut -d= -f2-)"
has_test="$(echo "$NODE_META" | sed -n '6p' | cut -d= -f2-)"
has_lint="$(echo "$NODE_META" | sed -n '7p' | cut -d= -f2-)"

is_nest_app=0
if [[ -n "$main_ts" || -n "$app_module_ts" ]]; then
  is_nest_app=1
fi

fail_count=0
warn_count=0

echo "== Framework Dev Check =="
echo "project: $PROJECT_DIR"
echo "package: $pkg_name"

if [[ "$has_nest" -eq 1 ]]; then
  echo "[INFO] Framework: NestJS detected"
else
  echo "[INFO] Framework: Node/TypeScript generic package"
fi

if [[ "$has_nest_base" -eq 1 ]]; then
  echo "[INFO] Ecosystem: nest-base related"
fi

if [[ "$has_src" -eq 0 ]]; then
  echo "[WARN] src directory not found"
  warn_count=$((warn_count + 1))
fi

if [[ "$has_nest" -eq 1 && "$is_nest_app" -eq 0 ]]; then
  echo "[WARN] NestJS deps found but app entry files not found (likely library mode)"
  warn_count=$((warn_count + 1))
fi

if [[ "$has_nest" -eq 1 && "$is_nest_app" -eq 1 ]]; then
  if [[ -z "$main_ts" ]]; then
    echo "[FAIL] main.ts not found for NestJS app"
    fail_count=$((fail_count + 1))
  fi
  if [[ -z "$app_module_ts" ]]; then
    echo "[FAIL] app.module.ts not found for NestJS app"
    fail_count=$((fail_count + 1))
  fi
fi

if [[ "$has_nest_base" -eq 1 && "$is_nest_app" -eq 1 ]]; then
  if [[ -n "$main_ts" ]]; then
    if contains_text "$main_ts" "setupNestCommon\("; then
      echo "[PASS] setupNestCommon detected"
    else
      echo "[WARN] setupNestCommon not detected in main.ts"
      warn_count=$((warn_count + 1))
    fi
  fi

  if [[ -n "$app_module_ts" ]]; then
    if contains_text "$app_module_ts" "NestCommonModule\.forRoot\("; then
      echo "[PASS] NestCommonModule.forRoot detected"
    else
      echo "[WARN] NestCommonModule.forRoot not detected in app.module.ts"
      warn_count=$((warn_count + 1))
    fi
  fi
fi

if [[ "$has_build" -eq 1 ]]; then
  echo "[PASS] build script detected"
else
  echo "[WARN] build script missing"
  warn_count=$((warn_count + 1))
fi

if [[ "$has_test" -eq 1 ]]; then
  echo "[INFO] test script detected"
else
  echo "[WARN] test script missing"
  warn_count=$((warn_count + 1))
fi

if [[ "$has_lint" -eq 0 ]]; then
  echo "[WARN] lint script missing"
  warn_count=$((warn_count + 1))
fi

if [[ "$is_private" -eq 1 ]]; then
  echo "[INFO] package is private=true"
fi

if [[ "$RUN_BUILD" -eq 1 && "$has_build" -eq 1 ]]; then
  set +e
  (cd "$PROJECT_DIR" && npm run -s build)
  build_status=$?
  set -e
  if [[ "$build_status" -ne 0 ]]; then
    echo "[FAIL] npm run build failed"
    fail_count=$((fail_count + 1))
  else
    echo "[PASS] npm run build succeeded"
  fi
fi

if [[ "$fail_count" -gt 0 ]]; then
  echo "Result: FAILED (fail=$fail_count warn=$warn_count)"
  exit 1
fi

if [[ "$STRICT" -eq 1 && "$warn_count" -gt 0 ]]; then
  echo "Result: FAILED-STRICT (warn=$warn_count)"
  exit 1
fi

if [[ "$warn_count" -gt 0 ]]; then
  echo "Result: PASSED WITH WARNINGS (warn=$warn_count)"
else
  echo "Result: PASSED"
fi
