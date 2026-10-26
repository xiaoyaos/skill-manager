#!/usr/bin/env python3
"""Render report.json into the UJoin personal weekly report template.

The output is the bundled template with only the data cells replaced:

    row 1    个人周报——<姓名>
    row 2    fixed instructions (kept from the template)
    row 3    周报周期：<period>
    row 4    fixed headers
    row 5-8  重点项目, at most 4 items
    row 9-12 日常工作, at most 4 items
    row 13-22 the second blank table, kept exactly as the template

Everything else (fonts, fills, borders, merges, data validation, column
widths, gridlines, page setup) comes from ``assets/ujoin-weekly-template.xlsx``.
Do not hand-edit the generated .xlsx; edit report.json and re-render.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from report_layout import (
    BASE_SHEET,
    DEFAULT_CONFIG,
    DEFAULT_TEMPLATE,
    HEADERS,
    LayoutError,
    PERIOD_PREFIX,
    PERIOD_ROW,
    SECOND_BLOCK,
    SECTIONS,
    TITLE_PREFIX,
    TITLE_ROW,
    load_template,
    normalize_status,
    render_deviation,
    report_filename,
    resolve_person_name,
    section_map,
    text,
)

INVALID_SHEET_CHARS = set('[]:*?/\\')


def load_json(path: Path, label: str, *, required: bool = True) -> dict[str, Any]:
    if not path.exists():
        if not required:
            return {}
        raise LayoutError(f"{label} not found: {path}")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise LayoutError(f"invalid JSON in {label}: {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise LayoutError(f"{label} must be a JSON object: {path}")
    return data


def pick_sheet(workbook: Any) -> Any:
    if BASE_SHEET in workbook.sheetnames:
        return workbook[BASE_SHEET]
    return workbook.worksheets[0]


def safe_sheet_name(name: str) -> str:
    cleaned = "".join(
        "_" if char in INVALID_SHEET_CHARS else char for char in name
    ).strip()
    return (cleaned or "个人周报")[:31]


def validate_items(report: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    mapped = section_map(report)
    for entry in SECTIONS:
        for index, item in enumerate(mapped[entry["label"]], start=1):
            if not isinstance(item, dict):
                raise LayoutError(
                    f"{entry['label']} item {index} must be an object"
                )
            for field in ("name", "goal", "progress", "status"):
                if not text(item.get(field)):
                    raise LayoutError(
                        f"{entry['label']} item {index} has empty {field}"
                    )
            status = normalize_status(item.get("status"))
            if status != "✅已完成" and not render_deviation(item.get("deviation")):
                raise LayoutError(
                    f"{entry['label']} item {index} is {status}, "
                    "so deviation must explain why"
                )
    return mapped


def fill_first_block(worksheet: Any, mapped: dict[str, list[dict[str, Any]]]) -> None:
    for entry in SECTIONS:
        items = mapped[entry["label"]]
        for offset in range(entry["slots"]):
            row = entry["start_row"] + offset
            item = items[offset] if offset < len(items) else None
            if item is None:
                for column in range(2, 7):
                    worksheet.cell(row=row, column=column).value = None
                continue
            worksheet.cell(row=row, column=2).value = text(item.get("name"))
            worksheet.cell(row=row, column=3).value = text(item.get("goal"))
            worksheet.cell(row=row, column=4).value = text(item.get("progress"))
            worksheet.cell(row=row, column=5).value = normalize_status(
                item.get("status")
            )
            worksheet.cell(row=row, column=6).value = render_deviation(
                item.get("deviation")
            )


def reset_second_block(worksheet: Any) -> None:
    """Keep the lower blank table identical to the template."""
    worksheet.cell(
        row=SECOND_BLOCK["period_row"],
        column=1,
        value=f"{PERIOD_PREFIX}2026/月/日-2026/月/日",
    )
    for column, header in enumerate(HEADERS, start=1):
        worksheet.cell(row=SECOND_BLOCK["header_row"], column=column, value=header)
    for row in range(SECOND_BLOCK["start_row"], SECOND_BLOCK["end_row"] + 1):
        for column in range(2, 7):
            worksheet.cell(row=row, column=column).value = None


def build_workbook(
    report: dict[str, Any],
    config: dict[str, Any],
    template_path: Path,
    *,
    person_name: str | None = None,
) -> tuple[Any, str]:
    mapped = validate_items(report)

    period = text(report.get("period"))
    if not period:
        raise LayoutError("report.period is empty")

    name = text(person_name) or resolve_person_name(report, config)
    workbook = load_template(template_path)
    worksheet = pick_sheet(workbook)

    for sheet_name in list(workbook.sheetnames):
        if sheet_name != worksheet.title:
            del workbook[sheet_name]

    worksheet.title = safe_sheet_name(name)
    worksheet.cell(row=TITLE_ROW, column=1, value=f"{TITLE_PREFIX}{name}")
    worksheet.cell(row=PERIOD_ROW, column=1, value=f"{PERIOD_PREFIX}{period}")

    fill_first_block(worksheet, mapped)
    reset_second_block(worksheet)

    return workbook, name


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Render report.json into the UJoin personal weekly report template.",
    )
    parser.add_argument("--input", required=True, help="report.json path")
    parser.add_argument(
        "--output",
        help="output .xlsx path; defaults to config output_dir + 个人周报_<姓名>_<周期>.xlsx",
    )
    parser.add_argument(
        "--config",
        help=f"local config JSON (default: {DEFAULT_CONFIG})",
    )
    parser.add_argument(
        "--template",
        help=f"template .xlsx (default: {DEFAULT_TEMPLATE})",
    )
    parser.add_argument("--person-name", help="override the name in the title")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        config_path = Path(args.config).expanduser() if args.config else DEFAULT_CONFIG
        config = load_json(config_path, "config", required=bool(args.config))
        report = load_json(Path(args.input).expanduser(), "report")

        template_value = args.template or (
            (config.get("report") or {}).get("template")
            if isinstance(config.get("report"), dict)
            else None
        )
        template_path = (
            Path(str(template_value)).expanduser()
            if template_value
            else DEFAULT_TEMPLATE
        )

        workbook, name = build_workbook(
            report,
            config,
            template_path,
            person_name=args.person_name,
        )

        if args.output:
            output = Path(args.output).expanduser()
        else:
            output_dir = config.get("output_dir")
            if not output_dir:
                raise LayoutError("--output is required when config has no output_dir")
            output = Path(str(output_dir)).expanduser() / report_filename(
                name, text(report.get("period"))
            )

        output.parent.mkdir(parents=True, exist_ok=True)
        workbook.save(output)
    except LayoutError as exc:
        print(f"[error] {exc}", file=sys.stderr)
        return 2

    item_count = sum(len(section["items"]) for section in report["sections"])
    print(f"Saved: {output}")
    print(f"Person: {name}")
    print(f"Sections: {len(report['sections'])}")
    print(f"Items: {item_count}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
