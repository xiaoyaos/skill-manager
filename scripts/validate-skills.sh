#!/usr/bin/env bash
#
# Validate the CLI syntax, every skill in this repository, and the CLI tests.
#
# Usage:
#   bash scripts/validate-skills.sh

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

echo "== CLI syntax =="
for file in bin/*.js src/*.js test/*.js; do
  [ -f "$file" ] || continue
  node --check "$file"
done

echo
echo "== CLI tests =="
node --test

echo
echo "== Skills =="
if command -v uv >/dev/null 2>&1; then
  uv run --with pyyaml python scripts/validate_skills.py
else
  python3 scripts/validate_skills.py
fi
