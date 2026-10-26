#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  generate_component_library.sh <domain-name> [target-dir] [--mode <mode>] --scope @your-scope

Modes:
  single-nest          生成单个 NestJS 组件包（快速集成）
  core-nest            生成 core + nest 两层包（推荐复用）
  core-nest-nestbase   生成 core + nest + nest-base 三层包（组织约定集成）

Defaults:
  target-dir = ~/.nest-base/
  mode       = core-nest

Required:
  --scope    必填，且必须以 @ 开头（例如 @acme）
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" || "${1:-}" == "" ]]; then
  usage
  exit 0
fi

DOMAIN_NAME="$1"
shift

TARGET_DIR="$HOME/.nest-base"
TARGET_DIR_IS_DEFAULT=1
if [[ "${1:-}" != "" && "${1:-}" != --* ]]; then
  TARGET_DIR="$1"
  TARGET_DIR_IS_DEFAULT=0
  shift
fi

MODE="core-nest"
SCOPE=""
SCOPE_SET=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode)
      MODE="${2:-}"
      shift 2
      ;;
    --scope)
      SCOPE="${2:-}"
      SCOPE_SET=1
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      usage
      exit 1
      ;;
  esac
done

if ! [[ "$DOMAIN_NAME" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
  echo "Error: <domain-name> must be kebab-case."
  exit 1
fi

if [[ "$SCOPE_SET" -ne 1 ]]; then
  echo "Error: --scope is required. Example: --scope @acme"
  usage
  exit 1
fi

if [[ "$SCOPE" != @* ]]; then
  echo "Error: --scope must start with @, for example @acme"
  exit 1
fi

if [[ "$MODE" != "single-nest" && "$MODE" != "core-nest" && "$MODE" != "core-nest-nestbase" ]]; then
  echo "Error: unsupported mode: $MODE"
  exit 1
fi

if [[ ! -d "$TARGET_DIR" ]]; then
  if [[ "$TARGET_DIR_IS_DEFAULT" -eq 1 ]]; then
    mkdir -p "$TARGET_DIR"
  else
    echo "Error: target dir not found: $TARGET_DIR"
    exit 1
  fi
fi

to_pascal_case() {
  local input="$1"
  echo "$input" | awk -F'-' '{
    for (i = 1; i <= NF; i++) {
      $i = toupper(substr($i, 1, 1)) substr($i, 2)
    }
    gsub(" ", "", $0)
    print
  }'
}

DOMAIN_PASCAL="$(to_pascal_case "$DOMAIN_NAME")"

CORE_PKG="${SCOPE}/${DOMAIN_NAME}-core"
NEST_PKG="${SCOPE}/${DOMAIN_NAME}-nest"
NEST_BASE_PKG="${SCOPE}/${DOMAIN_NAME}-nest-base"
SINGLE_NEST_PKG="${SCOPE}/${DOMAIN_NAME}"

OUTPUT_ROOT="${TARGET_DIR%/}/${DOMAIN_NAME}-library"
if [[ -e "$OUTPUT_ROOT" ]]; then
  echo "Error: output path already exists: $OUTPUT_ROOT"
  exit 1
fi

mkdir -p "$OUTPUT_ROOT"

write_tsconfig() {
  local file="$1"
  cat > "$file" <<'EOF'
{
  "compilerOptions": {
    "module": "commonjs",
    "declaration": true,
    "removeComments": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "allowSyntheticDefaultImports": true,
    "target": "es2021",
    "sourceMap": true,
    "outDir": "./dist",
    "baseUrl": "./",
    "incremental": false,
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
EOF
}

create_core_package() {
  local dir="$OUTPUT_ROOT/${DOMAIN_NAME}-core"
  mkdir -p "$dir/src"

  cat > "$dir/package.json" <<EOF
{
  "name": "${CORE_PKG}",
  "version": "0.1.0",
  "description": "${DOMAIN_NAME} core package",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "clean": "rm -rf dist"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.7.0"
  },
  "license": "MIT"
}
EOF

  write_tsconfig "$dir/tsconfig.json"

  cat > "$dir/src/${DOMAIN_NAME}.core-service.ts" <<EOF
export class ${DOMAIN_PASCAL}CoreService {
  health() {
    return { domain: '${DOMAIN_NAME}', ok: true };
  }
}
EOF

  cat > "$dir/src/index.ts" <<EOF
export * from './${DOMAIN_NAME}.core-service';
EOF
}

create_nest_package() {
  local dir="$OUTPUT_ROOT/${DOMAIN_NAME}-nest"
  mkdir -p "$dir/src"

  cat > "$dir/package.json" <<EOF
{
  "name": "${NEST_PKG}",
  "version": "0.1.0",
  "description": "${DOMAIN_NAME} nest adapter package",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "${CORE_PKG}": "workspace:*"
  },
  "peerDependencies": {
    "@nestjs/common": "^11.0.0",
    "@nestjs/core": "^11.0.0",
    "rxjs": "^7.8.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.7.0"
  },
  "license": "MIT"
}
EOF

  write_tsconfig "$dir/tsconfig.json"

  cat > "$dir/src/${DOMAIN_NAME}.options.ts" <<EOF
export interface ${DOMAIN_PASCAL}NestOptions {
  enabled?: boolean;
}

export const ${DOMAIN_PASCAL}NestOptionsToken = '${DOMAIN_PASCAL}NestOptionsToken';
EOF

  cat > "$dir/src/${DOMAIN_NAME}.service.ts" <<EOF
import { Inject, Injectable } from '@nestjs/common';
import { ${DOMAIN_PASCAL}CoreService } from '${CORE_PKG}';
import { ${DOMAIN_PASCAL}NestOptions, ${DOMAIN_PASCAL}NestOptionsToken } from './${DOMAIN_NAME}.options';

@Injectable()
export class ${DOMAIN_PASCAL}NestService {
  private readonly core = new ${DOMAIN_PASCAL}CoreService();

  constructor(
    @Inject(${DOMAIN_PASCAL}NestOptionsToken)
    private readonly options: ${DOMAIN_PASCAL}NestOptions,
  ) {}

  health() {
    return {
      ...this.core.health(),
      enabled: this.options.enabled ?? true,
    };
  }
}
EOF

  cat > "$dir/src/${DOMAIN_NAME}.module.ts" <<EOF
import { DynamicModule, Module } from '@nestjs/common';
import { ${DOMAIN_PASCAL}NestOptions, ${DOMAIN_PASCAL}NestOptionsToken } from './${DOMAIN_NAME}.options';
import { ${DOMAIN_PASCAL}NestService } from './${DOMAIN_NAME}.service';

@Module({})
export class ${DOMAIN_PASCAL}NestModule {
  static forRoot(options: ${DOMAIN_PASCAL}NestOptions = {}): DynamicModule {
    return {
      module: ${DOMAIN_PASCAL}NestModule,
      providers: [
        { provide: ${DOMAIN_PASCAL}NestOptionsToken, useValue: options },
        ${DOMAIN_PASCAL}NestService,
      ],
      exports: [${DOMAIN_PASCAL}NestService],
    };
  }
}
EOF

  cat > "$dir/src/index.ts" <<EOF
export * from './${DOMAIN_NAME}.module';
export * from './${DOMAIN_NAME}.service';
export * from './${DOMAIN_NAME}.options';
EOF
}

create_nest_base_package() {
  local dir="$OUTPUT_ROOT/${DOMAIN_NAME}-nest-base"
  mkdir -p "$dir/src"

  cat > "$dir/package.json" <<EOF
{
  "name": "${NEST_BASE_PKG}",
  "version": "0.1.0",
  "description": "${DOMAIN_NAME} nest-base adapter package",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "${NEST_PKG}": "workspace:*"
  },
  "peerDependencies": {
    "@nestjs/common": "^11.0.0",
    "@nestjs/core": "^11.0.0",
    "nest-base": ">=0.1.0",
    "rxjs": "^7.8.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.7.0"
  },
  "license": "MIT"
}
EOF

  write_tsconfig "$dir/tsconfig.json"

  cat > "$dir/src/${DOMAIN_NAME}.module.ts" <<EOF
import { DynamicModule, Module } from '@nestjs/common';
import { ${DOMAIN_PASCAL}NestModule, ${DOMAIN_PASCAL}NestOptions } from '${NEST_PKG}';

@Module({})
export class ${DOMAIN_PASCAL}NestBaseModule {
  static forRoot(options: ${DOMAIN_PASCAL}NestOptions = {}): DynamicModule {
    return {
      module: ${DOMAIN_PASCAL}NestBaseModule,
      imports: [${DOMAIN_PASCAL}NestModule.forRoot(options)],
      exports: [${DOMAIN_PASCAL}NestModule],
    };
  }
}
EOF

  cat > "$dir/src/index.ts" <<EOF
export * from './${DOMAIN_NAME}.module';
EOF
}

create_single_nest_package() {
  local dir="$OUTPUT_ROOT/${DOMAIN_NAME}"
  mkdir -p "$dir/src"

  cat > "$dir/package.json" <<EOF
{
  "name": "${SINGLE_NEST_PKG}",
  "version": "0.1.0",
  "description": "${DOMAIN_NAME} nest package",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "clean": "rm -rf dist"
  },
  "peerDependencies": {
    "@nestjs/common": "^11.0.0",
    "@nestjs/core": "^11.0.0",
    "rxjs": "^7.8.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.7.0"
  },
  "license": "MIT"
}
EOF

  write_tsconfig "$dir/tsconfig.json"

  cat > "$dir/src/${DOMAIN_NAME}.options.ts" <<EOF
export interface ${DOMAIN_PASCAL}Options {
  enabled?: boolean;
}

export const ${DOMAIN_PASCAL}OptionsToken = '${DOMAIN_PASCAL}OptionsToken';
EOF

  cat > "$dir/src/${DOMAIN_NAME}.service.ts" <<EOF
import { Inject, Injectable } from '@nestjs/common';
import { ${DOMAIN_PASCAL}Options, ${DOMAIN_PASCAL}OptionsToken } from './${DOMAIN_NAME}.options';

@Injectable()
export class ${DOMAIN_PASCAL}Service {
  constructor(
    @Inject(${DOMAIN_PASCAL}OptionsToken)
    private readonly options: ${DOMAIN_PASCAL}Options,
  ) {}

  health() {
    return {
      domain: '${DOMAIN_NAME}',
      enabled: this.options.enabled ?? true,
    };
  }
}
EOF

  cat > "$dir/src/${DOMAIN_NAME}.module.ts" <<EOF
import { DynamicModule, Module } from '@nestjs/common';
import { ${DOMAIN_PASCAL}Options, ${DOMAIN_PASCAL}OptionsToken } from './${DOMAIN_NAME}.options';
import { ${DOMAIN_PASCAL}Service } from './${DOMAIN_NAME}.service';

@Module({})
export class ${DOMAIN_PASCAL}Module {
  static forRoot(options: ${DOMAIN_PASCAL}Options = {}): DynamicModule {
    return {
      module: ${DOMAIN_PASCAL}Module,
      providers: [
        { provide: ${DOMAIN_PASCAL}OptionsToken, useValue: options },
        ${DOMAIN_PASCAL}Service,
      ],
      exports: [${DOMAIN_PASCAL}Service],
    };
  }
}
EOF

  cat > "$dir/src/index.ts" <<EOF
export * from './${DOMAIN_NAME}.module';
export * from './${DOMAIN_NAME}.service';
export * from './${DOMAIN_NAME}.options';
EOF
}

if [[ "$MODE" == "single-nest" ]]; then
  create_single_nest_package
elif [[ "$MODE" == "core-nest" ]]; then
  create_core_package
  create_nest_package
else
  create_core_package
  create_nest_package
  create_nest_base_package
fi

cat > "$OUTPUT_ROOT/README.md" <<EOF
# ${DOMAIN_NAME} Library Scaffold

Mode: ${MODE}

Generated by nest-lib-gen skill.

## Next Steps

1. Review package names and scope.
2. Install dependencies in your workspace.
3. Build each generated package:
   - npm run build
4. Integrate into target project by mode:
   - single-nest: import ${SINGLE_NEST_PKG}
   - core-nest: import ${CORE_PKG} + ${NEST_PKG}
   - core-nest-nestbase: import ${CORE_PKG} + ${NEST_PKG} + ${NEST_BASE_PKG}
EOF

echo "Scaffold created: $OUTPUT_ROOT"
echo "Mode: $MODE"
echo "Scope: $SCOPE"
echo "Generated packages:"
if [[ "$MODE" == "single-nest" ]]; then
  echo "- $OUTPUT_ROOT/${DOMAIN_NAME}"
elif [[ "$MODE" == "core-nest" ]]; then
  echo "- $OUTPUT_ROOT/${DOMAIN_NAME}-core"
  echo "- $OUTPUT_ROOT/${DOMAIN_NAME}-nest"
else
  echo "- $OUTPUT_ROOT/${DOMAIN_NAME}-core"
  echo "- $OUTPUT_ROOT/${DOMAIN_NAME}-nest"
  echo "- $OUTPUT_ROOT/${DOMAIN_NAME}-nest-base"
fi
