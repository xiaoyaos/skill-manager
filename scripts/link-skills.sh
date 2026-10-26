#!/usr/bin/env bash
#
# Link every skill in this repository into an agent's skills directory.
# Default target is OpenCode's global skills directory: ~/.agents/skills
#
# Usage:
#   bash scripts/link-skills.sh
#   OPENCODE_SKILLS_DIR=/path/to/skills bash scripts/link-skills.sh
#   bash scripts/link-skills.sh --dry-run

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${OPENCODE_SKILLS_DIR:-$HOME/.agents/skills}"
DRY_RUN=0

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help)
      echo "Usage: bash scripts/link-skills.sh [--dry-run]"
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
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "[dry-run] mkdir -p $TARGET"
  else
    mkdir -p "$TARGET"
  fi
fi

linked=0
updated=0
skipped=0

for dir in "$REPO_DIR"/skills/*/; do
  [ -f "$dir/SKILL.md" ] || continue
  dir="${dir%/}"
  name="$(basename "$dir")"
  target="$TARGET/$name"

  if [ -L "$target" ]; then
    current="$(readlink "$target")"
    if [ "$current" = "$dir" ]; then
      echo "[ok]      $name -> $dir"
      linked=$((linked + 1))
      continue
    fi
    if [ "$DRY_RUN" -eq 1 ]; then
      echo "[dry-run] relink $name: $current -> $dir"
    else
      rm "$target"
      ln -s "$dir" "$target"
      echo "[relink]  $name -> $dir"
    fi
    updated=$((updated + 1))
    continue
  fi

  if [ -e "$target" ]; then
    echo "[skip]    $name: target exists and is not a symlink ($target)" >&2
    skipped=$((skipped + 1))
    continue
  fi

  if [ "$DRY_RUN" -eq 1 ]; then
    echo "[dry-run] link $name -> $dir"
  else
    ln -s "$dir" "$target"
    echo "[link]    $name -> $dir"
  fi
  linked=$((linked + 1))
done

echo
echo "Target: $TARGET"
echo "Linked: $linked  Updated: $updated  Skipped: $skipped"
