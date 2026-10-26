#!/usr/bin/env python3
"""Validate every skill in this repository.

Reuses skill-creator-x/scripts/quick_validate.py for the baseline checks, then
adds repository-specific checks: directory/name consistency, relative links,
Python/shell syntax, and obvious secret leaks.
"""

from __future__ import annotations

import importlib.util
import re
import subprocess
import sys
from pathlib import Path

import yaml

REPO_DIR = Path(__file__).resolve().parent.parent
SKILLS_DIR = REPO_DIR / "skills"
QUICK_VALIDATE_PATH = SKILLS_DIR / "skill-creator-x" / "scripts" / "quick_validate.py"

LINK_RE = re.compile(r"\[[^\]]*\]\(([^)]+)\)")
FENCED_CODE_RE = re.compile(r"^\s*(```|~~~).*?^\s*\1\s*$", re.DOTALL | re.MULTILINE)
INLINE_CODE_RE = re.compile(r"`[^`\n]*`")
SECRET_PATTERNS = [
    re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    re.compile(r"\bghp_[A-Za-z0-9]{20,}\b"),
    re.compile(r"\bsk-[A-Za-z0-9]{20,}\b"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
]
TEXT_SUFFIXES = {".md", ".py", ".sh", ".json", ".yaml", ".yml", ".txt"}


def load_quick_validate():
    spec = importlib.util.spec_from_file_location("quick_validate", QUICK_VALIDATE_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load {QUICK_VALIDATE_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def parse_frontmatter(text: str) -> dict:
    match = re.match(r"^---\n(.*?)\n---", text, re.DOTALL)
    if not match:
        return {}
    value = yaml.safe_load(match.group(1))
    return value if isinstance(value, dict) else {}


def check_relative_links(skill_dir: Path, text: str) -> list[str]:
    errors: list[str] = []
    # Links inside fenced or inline code are examples, not real references.
    text = FENCED_CODE_RE.sub("", text)
    text = INLINE_CODE_RE.sub("", text)
    for raw in LINK_RE.findall(text):
        target = raw.strip()
        if not target or target.startswith(("#", "http://", "https://", "mailto:")):
            continue
        target = target.split("#", 1)[0].split("?", 1)[0]
        if not target or target.startswith("/"):
            continue
        if not (skill_dir / target).exists():
            errors.append(f"broken relative link: {raw}")
    return errors


def check_python(skill_dir: Path) -> list[str]:
    errors: list[str] = []
    for path in sorted(skill_dir.rglob("*.py")):
        try:
            compile(path.read_text(encoding="utf-8"), str(path), "exec")
        except SyntaxError as exc:
            errors.append(f"python syntax error in {path.relative_to(skill_dir)}: {exc}")
    return errors


def check_shell(skill_dir: Path) -> list[str]:
    errors: list[str] = []
    for path in sorted(skill_dir.rglob("*.sh")):
        result = subprocess.run(["bash", "-n", str(path)], capture_output=True, text=True)
        if result.returncode != 0:
            errors.append(f"shell syntax error in {path.relative_to(skill_dir)}: {result.stderr.strip()}")
    return errors


def check_secrets(skill_dir: Path) -> list[str]:
    errors: list[str] = []
    for path in sorted(skill_dir.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in TEXT_SUFFIXES:
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        for pattern in SECRET_PATTERNS:
            if pattern.search(text):
                errors.append(f"possible secret in {path.relative_to(skill_dir)}")
                break
    return errors


def validate_skill(skill_dir: Path, quick_validate) -> list[str]:
    errors: list[str] = []
    skill_md = skill_dir / "SKILL.md"
    if not skill_md.exists():
        return ["SKILL.md not found"]

    ok, message = quick_validate.validate_skill(skill_dir)
    if not ok:
        errors.append(message)

    text = skill_md.read_text(encoding="utf-8")
    frontmatter = parse_frontmatter(text)
    name = str(frontmatter.get("name", "")).strip()
    if name and name != skill_dir.name:
        errors.append(f"frontmatter name '{name}' does not match directory '{skill_dir.name}'")

    errors.extend(check_relative_links(skill_dir, text))
    errors.extend(check_python(skill_dir))
    errors.extend(check_shell(skill_dir))
    errors.extend(check_secrets(skill_dir))
    return errors


def main() -> int:
    if not QUICK_VALIDATE_PATH.exists():
        print(f"[FAIL] missing validator: {QUICK_VALIDATE_PATH}")
        return 1

    quick_validate = load_quick_validate()
    skill_dirs = sorted(path for path in SKILLS_DIR.iterdir() if path.is_dir() and (path / "SKILL.md").exists())
    if not skill_dirs:
        print("[FAIL] no skills found")
        return 1

    failed = 0
    for skill_dir in skill_dirs:
        errors = validate_skill(skill_dir, quick_validate)
        if errors:
            failed += 1
            print(f"[FAIL] {skill_dir.name}")
            for error in errors:
                print(f"       - {error}")
        else:
            print(f"[PASS] {skill_dir.name}")

    print()
    print(f"Validated {len(skill_dirs)} skill(s), {failed} failed.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
