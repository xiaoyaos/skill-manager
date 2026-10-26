#!/usr/bin/env bash
#
# Remove symlinks created by link-skills.sh. Only removes links that point
# into this repository's skills/ directory; real directories are never touched.
#
# Usage:
#   bash scripts/unlink-skills.sh
#   OPENCODE_SKILLS_DIR=/path/to/skills bash scripts/unlink-skills.sh
#   bash scripts/unlink-skills.sh --dry-run

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${OPENCODE_SKILLS_DIR:-$HOME/.agents/skills}"
DRY_RUN=0

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help)
      echo "Usage: bash scripts/unlink-skills.sh [--dry-run]"
      echo "Env: OPENCODE_SKILLS_DIR (default: \$HOME/.agents/skills)"
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

if [ ! -d "$TARGET" ]; then
  echo "Target does not exist: $TARGET"
  exit 0
fi

removed=0

for dir in "$REPO_DIR"/skills/*/; do
  [ -f "$dir/SKILL.md" ] || continue
  dir="${dir%/}"
  name="$(basename "$dir")"
  target="$TARGET/$name"

  if [ ! -L "$target" ]; then
    continue
  fi

  current="$(readlink "$target")"
  case "$current" in
    "$REPO_DIR"/skills/*)
      if [ "$DRY_RUN" -eq 1 ]; then
        echo "[dry-run] unlink $name -> $current"
      else
        rm "$target"
        echo "[unlink]  $name -> $current"
      fi
      removed=$((removed + 1))
      ;;
    *)
      echo "[skip]    $name: symlink points outside this repo ($current)" >&2
      ;;
  esac
done

echo
echo "Removed: $removed"
