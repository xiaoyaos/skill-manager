#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  integrate_extension.sh <requirement-md-file> [source]

Arguments:
  <requirement-md-file>  扩展需求文档路径（建议放在 extensions/pending/）
  [source]               需求来源描述，默认: chat
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" || "${1:-}" == "" ]]; then
  usage
  exit 0
fi

REQ_FILE="$1"
SOURCE="${2:-chat}"

if [[ ! -f "$REQ_FILE" ]]; then
  echo "[ERROR] 需求文件不存在: $REQ_FILE"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SKILL_FILE="$ROOT_DIR/SKILL.md"
APPLIED_DIR="$ROOT_DIR/extensions/applied"
REGISTRY_FILE="$ROOT_DIR/extensions/registry.md"

if [[ ! -f "$SKILL_FILE" ]]; then
  echo "[ERROR] 未找到 SKILL.md: $SKILL_FILE"
  exit 1
fi

mkdir -p "$APPLIED_DIR"

TIMESTAMP="$(date +"%Y-%m-%d %H:%M:%S")"
ID="$(date +"%Y%m%d-%H%M%S")"
BASENAME="$(basename "$REQ_FILE")"
SNAPSHOT_FILE="$APPLIED_DIR/${ID}-${BASENAME}"

cp "$REQ_FILE" "$SNAPSHOT_FILE"

if ! grep -q '^## Local Extensions (skill-creator-x)$' "$SKILL_FILE"; then
  cat >> "$SKILL_FILE" <<'SECTION'

## Local Extensions (skill-creator-x)

以下内容由本地扩展流程持续叠加，用于承载用户定制要求。
SECTION
fi

{
  echo ""
  echo "### EXT-$ID"
  echo "source: $SOURCE"
  echo "captured_at: $TIMESTAMP"
  echo ""
  cat "$REQ_FILE"
  echo ""
} >> "$SKILL_FILE"

{
  echo "- 时间: $TIMESTAMP | 来源: $SOURCE | 动作: append | 说明: 集成扩展文件 $BASENAME"
} >> "$REGISTRY_FILE"

echo "[OK] 扩展已集成"
echo "- snapshot: $SNAPSHOT_FILE"
echo "- skill: $SKILL_FILE"
echo "- registry: $REGISTRY_FILE"
