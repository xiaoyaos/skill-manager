#!/usr/bin/env python3
"""Extract local Git commits for a weekly report.

The script reads a machine-local config and project map, scans the workspace
for Git repositories, keeps commits by the configured authors inside the
requested ISO week, deduplicates them, and writes commits.json.

Data flow:

    git log -> commits.json -> report.json -> 周报.xlsx

Only commits.json is produced here. The narrative report.json is written by
the model, and the Excel file is rendered by render_report.py.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from collections import Counter
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

DEFAULT_CONFIG = Path.home() / ".config" / "git-weekly-report" / "config.json"
DEFAULT_PROJECT_MAP = Path.home() / ".config" / "git-weekly-report" / "project-map.json"

# Directories that are never useful for repository discovery.
SKIP_DIRS = {
    ".git",
    "node_modules",
    "dist",
    "build",
    "out",
    ".next",
    ".nuxt",
    ".svelte-kit",
    ".cache",
    ".venv",
    "venv",
    "__pycache__",
    ".idea",
    ".vscode",
    "target",
    "coverage",
    ".turbo",
    ".pnpm-store",
    "Pods",
    "DerivedData",
}

# Conventional commit prefixes. Keep this list in sync with references/report-spec.md.
PREFIX_RE = re.compile(
    r"^(feat|fix|refactor|refine|docs|test|chore|build|perf|dependency|"
    r"migration|revert|style|ci|wip)(\([^)]+\))?!?:\s*",
    re.IGNORECASE,
)


class ConfigError(RuntimeError):
    """Raised when local configuration or CLI input is invalid."""


def eprint(*args: Any) -> None:
    print(*args, file=sys.stderr)


def load_json(path: Path, label: str, *, required: bool = True) -> dict[str, Any]:
    if not path.exists():
        if required:
            raise ConfigError(
                f"{label} not found: {path}\n"
                "Create it from the example first, for example:\n"
                "  mkdir -p ~/.config/git-weekly-report\n"
                "  cp references/config.example.json ~/.config/git-weekly-report/config.json\n"
                "  cp references/project-map.example.json ~/.config/git-weekly-report/project-map.json"
            )
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ConfigError(f"invalid JSON in {label}: {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise ConfigError(f"{label} must be a JSON object: {path}")
    return data


def normalize_repo_path(value: Any) -> str:
    text = str(value).strip().replace("\\", "/")
    while text.startswith("./"):
        text = text[2:]
    return text.strip("/")


def normalize_subject(subject: str) -> str:
    cleaned = PREFIX_RE.sub("", subject).strip()
    return cleaned or subject.strip()


def parse_iso_date(value: str, label: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise ConfigError(f"{label} must be YYYY-MM-DD, got: {value!r}") from exc


def previous_week(today: date | None = None) -> tuple[date, date]:
    current = today or date.today()
    this_monday = current - timedelta(days=current.weekday())
    start = this_monday - timedelta(days=7)
    return start, start + timedelta(days=6)


def week_range(week_value: str, year: int) -> tuple[date, date]:
    match = re.fullmatch(r"[Ww]?(\d{1,2})", week_value.strip())
    if not match:
        raise ConfigError(f"--week must look like W43 or 43, got: {week_value!r}")
    week_number = int(match.group(1))
    if not 1 <= week_number <= 53:
        raise ConfigError(f"--week out of range: {week_value!r}")
    try:
        start = date.fromisocalendar(year, week_number, 1)
        end = date.fromisocalendar(year, week_number, 7)
    except ValueError as exc:
        raise ConfigError(f"invalid ISO week {year}-W{week_number:02d}: {exc}") from exc
    return start, end


def resolve_period(args: argparse.Namespace) -> tuple[date, date]:
    if bool(args.start) != bool(args.end):
        raise ConfigError("--start and --end must be used together")
    if args.start and args.week:
        raise ConfigError("use either --start/--end or --week, not both")
    if args.year and not args.week:
        raise ConfigError("--year is only valid together with --week")
    if args.start and args.end:
        start = parse_iso_date(args.start, "--start")
        end = parse_iso_date(args.end, "--end")
    elif args.week:
        year = args.year or date.today().isocalendar().year
        start, end = week_range(args.week, year)
    else:
        today = parse_iso_date(args.today, "--today") if args.today else date.today()
        start, end = previous_week(today)
    if start > end:
        raise ConfigError(f"start date is after end date: {start} > {end}")
    return start, end


def discover_repos(workspace: Path, scan_depth: int) -> list[Path]:
    if scan_depth < 1:
        raise ConfigError("scan_depth must be at least 1")
    repos: list[Path] = []
    for root, dirs, _files in os.walk(workspace, followlinks=False):
        root_path = Path(root)
        try:
            relative = root_path.relative_to(workspace)
        except ValueError:
            continue
        depth = 0 if relative == Path(".") else len(relative.parts)
        dirs[:] = [
            name
            for name in dirs
            if name not in SKIP_DIRS
            and not name.startswith(".")
            and not (root_path / name).is_symlink()
        ]
        if depth >= scan_depth:
            dirs[:] = []
        if (root_path / ".git").exists():
            repos.append(root_path)
    return sorted(repos)


def read_git_log(
    repo_path: Path,
    *,
    all_branches: bool,
    exclude_merge: bool,
) -> list[tuple[str, date, str, str]]:
    command = ["git", "-C", str(repo_path), "log"]
    if all_branches:
        command.append("--all")
    if exclude_merge:
        command.append("--no-merges")
    command.extend(["--format=%H%x1f%ad%x1f%ae%x1f%s", "--date=short"])

    result = subprocess.run(
        command,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if result.returncode != 0:
        stderr = result.stderr.strip()
        if "does not have any commits" in stderr or "your current branch" in stderr:
            return []
        raise RuntimeError(f"git log failed for {repo_path}: {stderr}")

    commits: list[tuple[str, date, str, str]] = []
    for line in result.stdout.splitlines():
        parts = line.split("\x1f", 3)
        if len(parts) != 4:
            continue
        commit_hash, raw_date, raw_email, subject = parts
        try:
            commit_date = date.fromisoformat(raw_date)
        except ValueError:
            continue
        commits.append(
            (
                commit_hash,
                commit_date,
                raw_email.strip().lower(),
                subject.strip(),
            )
        )
    return commits


def load_project_map(
    path: Path,
    *,
    required: bool,
) -> tuple[dict[str, str], dict[str, dict[str, Any]], set[str], list[str]]:
    raw = load_json(path, "project map", required=required)
    projects_raw = raw.get("projects", {})
    if not isinstance(projects_raw, dict):
        raise ConfigError(f"project map 'projects' must be an object: {path}")

    repo_to_project: dict[str, str] = {}
    projects: dict[str, dict[str, Any]] = {}
    for project_name, meta in projects_raw.items():
        name = str(project_name).strip()
        if not name:
            raise ConfigError(f"empty project name in {path}")
        if not isinstance(meta, dict):
            raise ConfigError(f"project {name!r} must be an object in {path}")
        repos = meta.get("repos", [])
        if not isinstance(repos, list):
            raise ConfigError(f"project {name!r} 'repos' must be a list in {path}")
        normalized_repos = []
        for repo in repos:
            repo_path = normalize_repo_path(repo)
            if not repo_path:
                raise ConfigError(f"project {name!r} contains an empty repo path in {path}")
            existing = repo_to_project.get(repo_path)
            if existing and existing != name:
                raise ConfigError(
                    f"repo {repo_path!r} is mapped to both {existing!r} and {name!r} in {path}"
                )
            repo_to_project[repo_path] = name
            normalized_repos.append(repo_path)
        projects[name] = {
            "repos": normalized_repos,
            "goal": str(meta.get("goal", "")).strip(),
            "strategic": bool(meta.get("strategic", False)),
        }

    ignored_raw = raw.get("ignored_repos", [])
    if not isinstance(ignored_raw, list):
        raise ConfigError(f"project map 'ignored_repos' must be a list: {path}")
    ignored = {normalize_repo_path(repo) for repo in ignored_raw if normalize_repo_path(repo)}

    return repo_to_project, projects, ignored, sorted(ignored)


def resolve_settings(args: argparse.Namespace) -> dict[str, Any]:
    config_path = Path(args.config).expanduser() if args.config else DEFAULT_CONFIG
    if config_path.exists():
        config = load_json(config_path, "config")
    elif args.config or not (args.workspace and args.author):
        raise ConfigError(
            f"config not found: {config_path}\n"
            "Copy references/config.example.json to that path, or pass --workspace and --author."
        )
    else:
        config = {}

    workspace_value = args.workspace or config.get("workspace")
    if not workspace_value:
        raise ConfigError(f"'workspace' is required in {config_path} or via --workspace")
    workspace = Path(str(workspace_value)).expanduser()
    if not workspace.is_dir():
        raise ConfigError(f"workspace does not exist or is not a directory: {workspace}")
    workspace = workspace.resolve()

    raw_authors = args.author if args.author else config.get("authors", [])
    if isinstance(raw_authors, str):
        raw_authors = [raw_authors]
    if not isinstance(raw_authors, list):
        raise ConfigError(f"'authors' must be a list in {config_path}")
    authors = sorted(
        {
            str(author).strip().lower()
            for author in raw_authors
            if str(author).strip()
        }
    )
    if not authors:
        raise ConfigError(f"'authors' is empty in {config_path} or via --author")

    map_value = args.project_map or config.get("project_map")
    map_path = Path(str(map_value)).expanduser() if map_value else DEFAULT_PROJECT_MAP
    map_required = bool(args.project_map or map_value)
    repo_to_project, projects, ignored, ignored_sorted = load_project_map(
        map_path,
        required=map_required,
    )

    scan_depth_value = args.scan_depth
    if scan_depth_value is None:
        scan_depth_value = config.get("scan_depth", 5)
    try:
        scan_depth = int(scan_depth_value)
    except (TypeError, ValueError) as exc:
        raise ConfigError(f"scan_depth must be an integer, got: {scan_depth_value!r}") from exc

    git_config = config.get("git", {})
    if not isinstance(git_config, dict):
        raise ConfigError(f"'git' must be an object in {config_path}")

    return {
        "workspace": workspace,
        "authors": authors,
        "config_path": config_path,
        "map_path": map_path,
        "repo_to_project": repo_to_project,
        "projects": projects,
        "ignored": ignored,
        "ignored_sorted": ignored_sorted,
        "scan_depth": scan_depth,
        "all_branches": not args.no_all_branches and bool(git_config.get("all_branches", True)),
        "exclude_merge": not args.include_merges and bool(git_config.get("exclude_merge", True)),
    }


def collect_commits(
    *,
    workspace: Path,
    repos: list[Path],
    authors: set[str],
    start: date,
    end: date,
    repo_to_project: dict[str, str],
    ignored: set[str],
    all_branches: bool,
    exclude_merge: bool,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[str]]:
    deduplicated: dict[tuple[str, str, str], dict[str, Any]] = {}
    errors: list[str] = []

    for repo_path in repos:
        try:
            repo = repo_path.relative_to(workspace).as_posix()
        except ValueError:
            continue
        if repo in ignored:
            continue

        try:
            log_rows = read_git_log(
                repo_path,
                all_branches=all_branches,
                exclude_merge=exclude_merge,
            )
        except RuntimeError as exc:
            errors.append(str(exc))
            continue

        project = repo_to_project.get(repo)
        for commit_hash, commit_date, email, subject in log_rows:
            if email not in authors:
                continue
            if not (start <= commit_date <= end):
                continue

            normalized = normalize_subject(subject)
            key = (repo, commit_date.isoformat(), normalized)
            candidate = {
                "hash": commit_hash,
                "date": commit_date.isoformat(),
                "week": f"W{commit_date.isocalendar().week:02d}",
                "iso_year": commit_date.isocalendar().year,
                "project": project,
                "repo": repo,
                "subject": subject,
                "norm": normalized,
            }

            existing = deduplicated.get(key)
            if existing is None:
                deduplicated[key] = candidate
            elif "(" not in existing["subject"] and "(" in subject:
                # Prefer the variant with a scope, since it carries more context.
                deduplicated[key] = candidate

    commits = sorted(
        deduplicated.values(),
        key=lambda item: (
            item["iso_year"],
            item["week"],
            item["project"] or "~unmapped",
            item["repo"],
            item["date"],
            item["norm"],
        ),
    )

    unmapped_groups: dict[str, list[dict[str, Any]]] = {}
    for commit in commits:
        if commit["project"] is None:
            unmapped_groups.setdefault(commit["repo"], []).append(commit)

    unmapped = []
    for repo in sorted(unmapped_groups):
        items = unmapped_groups[repo]
        unmapped.append(
            {
                "repo": repo,
                "commit_count": len(items),
                "sample_commits": [
                    f"{item['date']} {item['norm']}" for item in items[:3]
                ],
            }
        )

    return commits, unmapped, errors


def build_payload(
    *,
    settings: dict[str, Any],
    start: date,
    end: date,
    repos: list[Path],
    commits: list[dict[str, Any]],
    unmapped: list[dict[str, Any]],
    errors: list[str],
) -> dict[str, Any]:
    workspace: Path = settings["workspace"]
    projects: dict[str, dict[str, Any]] = settings["projects"]
    repo_to_project: dict[str, str] = settings["repo_to_project"]

    by_project = Counter(
        commit["project"] for commit in commits if commit["project"] is not None
    )
    by_repo = Counter(commit["repo"] for commit in commits)
    by_week = Counter(commit["week"] for commit in commits)

    missing_repos = sorted(
        repo for repo in repo_to_project if not (workspace / repo / ".git").exists()
    )
    projects_without_commits = sorted(set(projects) - set(by_project))

    start_iso = start.isocalendar()
    end_iso = end.isocalendar()
    multi_week = (start_iso.year, start_iso.week) != (end_iso.year, end_iso.week)

    return {
        "generated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "workspace": str(workspace),
        "period": {
            "start": start.isoformat(),
            "end": end.isoformat(),
            "label": f"{start:%Y/%m/%d}-{end:%Y/%m/%d}",
            "week": f"W{start_iso.week:02d}",
            "iso_year": start_iso.year,
            "multi_week": multi_week,
        },
        "authors": settings["authors"],
        "commits": commits,
        "unmapped": unmapped,
        "stats": {
            "total": len(commits),
            "scanned_repos": len(repos),
            "repos_with_commits": len(by_repo),
            "by_project": dict(sorted(by_project.items())),
            "by_repo": dict(sorted(by_repo.items())),
            "by_week": dict(sorted(by_week.items())),
            "missing_repos": missing_repos,
            "projects_without_commits": projects_without_commits,
            "ignored_repos": settings["ignored_sorted"],
            "errors": errors,
        },
    }


def print_summary(payload: dict[str, Any], output: Path) -> None:
    period = payload["period"]
    stats = payload["stats"]
    print(f"Period: {period['label']} ({period['week']}, {period['iso_year']})")
    print(f"Workspace: {payload['workspace']}")
    print(f"Authors: {', '.join(payload['authors'])}")
    print(f"Scanned repos: {stats['scanned_repos']}")
    print(f"Commits: {stats['total']}")

    if stats["by_project"]:
        print("\nBy project:")
        for project, count in stats["by_project"].items():
            print(f"  {project}: {count}")

    if payload["unmapped"]:
        print("\nUnmapped repos (confirm project mapping before generating the report):")
        for item in payload["unmapped"]:
            print(f"  {item['repo']}: {item['commit_count']} commit(s)")
            for sample in item["sample_commits"]:
                print(f"    - {sample}")

    if stats["missing_repos"]:
        print("\nMissing repos from project map:")
        for repo in stats["missing_repos"]:
            print(f"  {repo}")

    if stats["projects_without_commits"]:
        print("\nProjects without commits in this period:")
        for project in stats["projects_without_commits"]:
            print(f"  {project}")

    if stats["errors"]:
        print("\nWarnings:")
        for error in stats["errors"]:
            print(f"  {error}")

    if period["multi_week"]:
        eprint(
            "\n[warn] the selected range spans more than one ISO week; "
            "the single-week template expects one week."
        )

    print(f"\nWritten: {output}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Extract local Git commits for a weekly report.",
    )
    parser.add_argument(
        "--config",
        help=f"local config JSON (default: {DEFAULT_CONFIG})",
    )
    parser.add_argument(
        "--project-map",
        help=f"repo-to-project map JSON (default: {DEFAULT_PROJECT_MAP})",
    )
    parser.add_argument("--workspace", help="override workspace directory")
    parser.add_argument(
        "--author",
        action="append",
        help="author email to include; repeatable; overrides config authors",
    )
    parser.add_argument("--start", help="start date, YYYY-MM-DD")
    parser.add_argument("--end", help="end date, YYYY-MM-DD")
    parser.add_argument("--week", help="ISO week, for example W43 or 43")
    parser.add_argument("--year", type=int, help="ISO year for --week")
    parser.add_argument(
        "--today",
        help="override today's date for the default period (YYYY-MM-DD)",
    )
    parser.add_argument(
        "--output",
        default="commits.json",
        help="output JSON path (default: commits.json)",
    )
    parser.add_argument(
        "--scan-depth",
        type=int,
        help="maximum directory depth to scan for .git (default: 5)",
    )
    parser.add_argument(
        "--no-all-branches",
        action="store_true",
        help="only read the current branch instead of all refs",
    )
    parser.add_argument(
        "--include-merges",
        action="store_true",
        help="include merge commits",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        start, end = resolve_period(args)
        settings = resolve_settings(args)
        repos = discover_repos(settings["workspace"], settings["scan_depth"])
        commits, unmapped, errors = collect_commits(
            workspace=settings["workspace"],
            repos=repos,
            authors=set(settings["authors"]),
            start=start,
            end=end,
            repo_to_project=settings["repo_to_project"],
            ignored=settings["ignored"],
            all_branches=settings["all_branches"],
            exclude_merge=settings["exclude_merge"],
        )
        payload = build_payload(
            settings=settings,
            start=start,
            end=end,
            repos=repos,
            commits=commits,
            unmapped=unmapped,
            errors=errors,
        )
        output = Path(args.output).expanduser()
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print_summary(payload, output)
        return 0
    except ConfigError as exc:
        eprint(f"[error] {exc}")
        return 2


if __name__ == "__main__":
    sys.exit(main())
