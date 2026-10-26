#!/usr/bin/env bash
#
# Validate the CLI syntax and every skill in this repository.
#
# Usage:
#   bash scripts/validate-skills.sh

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

echo "== CLI syntax =="
node --check bin/skill-manager.js

echo
echo "== Skills =="
if command -v uv >/dev/null 2>&1; then
  uv run --with pyyaml python scripts/validate_skills.py
else
  python3 scripts/validate_skills.py
fi
