#!/usr/bin/env python3
"""Verify LOINC and SNOMED CT codes referenced by the MVP FSH source.

The input files are FHIR CodeSystem NDJSON distributions in which the first
line is CodeSystem metadata and subsequent lines are concepts.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import json
import re
import sys
from pathlib import Path

REF_RE = re.compile(r"\$(LNC|SCT)#([A-Za-z0-9.\-]+)(?:\s+\"([^\"]+)\")?")


def collect_references(root: Path) -> dict[str, dict[str, str]]:
    refs: dict[str, dict[str, str]] = {"LNC": {}, "SCT": {}}
    for path in sorted((root / "input" / "fsh").glob("*.fsh")):
        text = path.read_text(encoding="utf-8")
        for system, code, display in REF_RE.findall(text):
            refs[system].setdefault(code, display)
    return refs


def load_concepts(path: Path, wanted: set[str]) -> dict[str, dict]:
    found: dict[str, dict] = {}
    with gzip.open(path, "rt", encoding="utf-8") as stream:
        for line in stream:
            obj = json.loads(line)
            code = obj.get("code")
            if code in wanted:
                found[code] = obj
                if len(found) == len(wanted):
                    break
    return found


def property_values(obj: dict, code: str) -> list[object]:
    values: list[object] = []
    for prop in obj.get("property", []):
        if prop.get("code") != code:
            continue
        for key, value in prop.items():
            if key.startswith("value"):
                values.append(value)
    return values


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--loinc", type=Path, required=True)
    parser.add_argument("--snomed", type=Path, required=True)
    args = parser.parse_args()

    refs = collect_references(args.root)
    sources = {"LNC": args.loinc, "SCT": args.snomed}
    systems = {"LNC": "http://loinc.org", "SCT": "http://snomed.info/sct"}
    rows: list[dict[str, object]] = []
    errors: list[str] = []

    for label in ("LNC", "SCT"):
        wanted = set(refs[label])
        found = load_concepts(sources[label], wanted)
        for code in sorted(wanted):
            obj = found.get(code)
            expected_display = refs[label][code]
            if obj is None:
                active = False
                actual_display = ""
                errors.append(f"{label} {code} was not found")
            else:
                actual_display = obj.get("display", "")
                if label == "LNC":
                    statuses = [str(v).upper() for v in property_values(obj, "STATUS")]
                    active = not statuses or "ACTIVE" in statuses
                else:
                    inactive = property_values(obj, "inactive")
                    active = not any(v is True for v in inactive)
                if not active:
                    errors.append(f"{label} {code} is inactive")
            rows.append(
                {
                    "system": systems[label],
                    "code": code,
                    "expected_display": expected_display,
                    "actual_display": actual_display,
                    "found": obj is not None,
                    "active": active,
                    "display_match": not expected_display or expected_display == actual_display,
                }
            )

    validation_dir = args.root / "validation"
    validation_dir.mkdir(exist_ok=True)
    csv_path = validation_dir / "terminology-validation.csv"
    with csv_path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)

    md_path = validation_dir / "terminology-validation.md"
    with md_path.open("w", encoding="utf-8") as stream:
        stream.write("# Terminology validation\n\n")
        stream.write(f"Checked {len(refs['LNC'])} LOINC and {len(refs['SCT'])} SNOMED CT codes.\n\n")
        stream.write("| System | Code | Display | Found | Active | Display match |\n")
        stream.write("|---|---|---|---:|---:|---:|\n")
        for row in rows:
            stream.write(
                f"| {row['system']} | `{row['code']}` | {row['actual_display']} | "
                f"{row['found']} | {row['active']} | {row['display_match']} |\n"
            )
        if errors:
            stream.write("\n## Errors\n\n")
            for error in errors:
                stream.write(f"- {error}\n")

    print(f"Checked {len(rows)} terminology references; report: {md_path}")
    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
