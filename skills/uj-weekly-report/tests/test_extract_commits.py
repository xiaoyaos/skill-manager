from __future__ import annotations

import io
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from datetime import date
from pathlib import Path
from unittest.mock import patch

SCRIPT_DIR = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPT_DIR))

from extract_commits import build_payload, collect_commits, print_summary  # noqa: E402


class ExtractCommitsTest(unittest.TestCase):
    def test_ignored_repo_commits_are_counted_and_visible(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            workspace = Path(temp_dir)
            active_repo = workspace / "active"
            ignored_repo = workspace / "ignored"

            def fake_git_log(repo_path: Path, **_kwargs: object):
                if repo_path == ignored_repo:
                    return [
                        ("ignored-own", date(2026, 10, 27), "me@example.com", "fix: ignored own"),
                        ("ignored-other", date(2026, 10, 27), "other@example.com", "fix: ignored other"),
                        ("ignored-outside", date(2026, 10, 20), "me@example.com", "fix: outside"),
                    ]
                return [
                    ("active-own", date(2026, 10, 27), "me@example.com", "feat: active own"),
                    ("active-other", date(2026, 10, 27), "other@example.com", "feat: active other"),
                ]

            with patch("extract_commits.read_git_log", side_effect=fake_git_log):
                commits, unmapped, ignored, errors = collect_commits(
                    workspace=workspace,
                    repos=[active_repo, ignored_repo],
                    authors={"me@example.com"},
                    start=date(2026, 10, 26),
                    end=date(2026, 11, 1),
                    repo_to_project={"active": "Example Platform"},
                    ignored={"ignored"},
                    all_branches=True,
                    exclude_merge=True,
                )

            settings = {
                "workspace": workspace,
                "projects": {
                    "Example Platform": {
                        "repos": ["active"],
                        "goal": "Example goal.",
                        "strategic": True,
                    }
                },
                "repo_to_project": {"active": "Example Platform"},
                "ignored_sorted": ["ignored"],
                "authors": ["me@example.com"],
            }
            payload = build_payload(
                settings=settings,
                start=date(2026, 10, 26),
                end=date(2026, 11, 1),
                repos=[active_repo, ignored_repo],
                commits=commits,
                unmapped=unmapped,
                ignored=ignored,
                errors=errors,
            )

            self.assertEqual(len(commits), 1)
            self.assertEqual(commits[0]["subject"], "feat: active own")
            self.assertEqual(unmapped, [])
            self.assertEqual(
                ignored,
                [
                    {
                        "repo": "ignored",
                        "commit_count": 1,
                        "sample_commits": ["2026-10-27 ignored own"],
                    }
                ],
            )
            self.assertEqual(payload["stats"]["ignored_commit_count"], 1)
            self.assertEqual(payload["stats"]["ignored_repos_with_commits"], 1)

            output = io.StringIO()
            with redirect_stdout(output):
                print_summary(payload, workspace / "commits.json")
            self.assertIn("Ignored repos", output.getvalue())
            self.assertIn("Total own commits excluded by ignored_repos: 1", output.getvalue())

    def test_ignored_repo_without_personal_commits_is_not_reported(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            workspace = Path(temp_dir)
            ignored_repo = workspace / "ignored"

            with patch(
                "extract_commits.read_git_log",
                return_value=[
                    ("other", date(2026, 10, 27), "other@example.com", "fix: other")
                ],
            ):
                commits, unmapped, ignored, errors = collect_commits(
                    workspace=workspace,
                    repos=[ignored_repo],
                    authors={"me@example.com"},
                    start=date(2026, 10, 26),
                    end=date(2026, 11, 1),
                    repo_to_project={},
                    ignored={"ignored"},
                    all_branches=True,
                    exclude_merge=True,
                )

            self.assertEqual(commits, [])
            self.assertEqual(unmapped, [])
            self.assertEqual(ignored, [])
            self.assertEqual(errors, [])


if __name__ == "__main__":
    unittest.main()
