#!/usr/bin/env python3
"""Validate MVP profiles and generated resources against supplied FHIR R4 StructureDefinitions.

This is an offline, deterministic structural check. It deliberately uses the
R4 StructureDefinitions as the source of truth rather than the package's
OpenAPI JSON schemas, which are not complete profile validators.
"""
from __future__ import annotations

import argparse
import json
import tarfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

ROOT = Path(__file__).resolve().parents[1]
RES = ROOT / "fsh-generated" / "resources"
FHIR_CANONICAL_PREFIX = "http://hl7.org/fhir/StructureDefinition/"

PRIMITIVE_TYPES = {
    "base64Binary", "boolean", "canonical", "code", "date", "dateTime",
    "decimal", "id", "instant", "integer", "markdown", "oid",
    "positiveInt", "string", "time", "unsignedInt", "uri", "url", "uuid",
}
INTEGER_TYPES = {"integer", "positiveInt", "unsignedInt"}
STRING_TYPES = PRIMITIVE_TYPES - {"boolean", "decimal"} - INTEGER_TYPES


@dataclass
class PackageReader:
    path: Path

    def __post_init__(self) -> None:
        self._tar: tarfile.TarFile | None = None
        self._prefix = ""
        if self.path.is_file():
            self._tar = tarfile.open(self.path, "r:gz")
            names = set(self._tar.getnames())
            self._prefix = "package/" if "package/package.json" in names else ""
        elif not self.path.is_dir():
            raise FileNotFoundError(self.path)

    def read_json(self, filename: str) -> dict[str, Any]:
        if self._tar is not None:
            member = self._tar.extractfile(self._prefix + filename)
            if member is None:
                raise FileNotFoundError(filename)
            return json.load(member)
        candidates = [self.path / filename, self.path / "package" / filename]
        for candidate in candidates:
            if candidate.exists():
                return json.loads(candidate.read_text(encoding="utf-8"))
        raise FileNotFoundError(filename)

    def close(self) -> None:
        if self._tar is not None:
            self._tar.close()


def max_value(value: str | None) -> float:
    if value in (None, "*"):
        return float("inf")
    return float(value)


def type_suffix(code: str) -> str:
    return code[0].upper() + code[1:]


def value_matches_type(value: Any, code: str) -> bool:
    if code == "boolean":
        return isinstance(value, bool)
    if code in INTEGER_TYPES:
        return isinstance(value, int) and not isinstance(value, bool)
    if code == "decimal":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if code in STRING_TYPES:
        return isinstance(value, str)
    return isinstance(value, dict)


def load_generated() -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]]]:
    resources: list[dict[str, Any]] = []
    by_url: dict[str, dict[str, Any]] = {}
    for path in sorted(RES.glob("*.json")):
        obj = json.loads(path.read_text(encoding="utf-8"))
        obj["__filename"] = path.name
        resources.append(obj)
        if obj.get("url"):
            by_url[obj["url"]] = obj
    return resources, by_url


def base_type_for_profile(url: str, generated_by_url: dict[str, dict[str, Any]]) -> str | None:
    if url.startswith(FHIR_CANONICAL_PREFIX):
        return url.removeprefix(FHIR_CANONICAL_PREFIX)
    profile = generated_by_url.get(url)
    if not profile:
        return None
    return profile.get("type")


def validate_profile_differential(
    profile: dict[str, Any],
    core: PackageReader,
    generated_by_url: dict[str, dict[str, Any]],
) -> list[str]:
    errors: list[str] = []
    base_url = profile.get("baseDefinition")
    if not base_url or not base_url.startswith(FHIR_CANONICAL_PREFIX):
        return [f"{profile['__filename']}: unsupported baseDefinition {base_url!r}"]
    base_type = base_url.removeprefix(FHIR_CANONICAL_PREFIX)
    try:
        base = core.read_json(f"StructureDefinition-{base_type}.json")
    except FileNotFoundError:
        return [f"{profile['__filename']}: missing core StructureDefinition for {base_type}"]
    base_elements = {e["path"]: e for e in base["snapshot"]["element"]}
    for element in profile.get("differential", {}).get("element", []):
        path = element["path"]
        if path not in base_elements:
            errors.append(f"{profile['__filename']}: differential path not in R4 base: {path}")
            continue
        parent = base_elements[path]
        if element.get("min", parent.get("min", 0)) < parent.get("min", 0):
            errors.append(f"{profile['__filename']}: {path} lowers min cardinality")
        if max_value(element.get("max", parent.get("max"))) > max_value(parent.get("max")):
            errors.append(f"{profile['__filename']}: {path} raises max cardinality")
        if "type" in element:
            base_types = {t["code"] for t in parent.get("type", [])}
            for narrowed in element["type"]:
                code = narrowed["code"]
                if code not in base_types:
                    errors.append(
                        f"{profile['__filename']}: {path} type {code} is not allowed by R4 base {sorted(base_types)}"
                    )
                if code == "Reference" and narrowed.get("targetProfile"):
                    allowed_targets = {
                        target
                        for t in parent.get("type", [])
                        if t.get("code") == "Reference"
                        for target in t.get("targetProfile", [])
                    }
                    allowed_types = {base_type_for_profile(t, generated_by_url) for t in allowed_targets}
                    for target in narrowed["targetProfile"]:
                        target_type = base_type_for_profile(target, generated_by_url)
                        if allowed_targets and target not in allowed_targets and target_type not in allowed_types:
                            errors.append(
                                f"{profile['__filename']}: {path} targetProfile {target} is not a subtype of an allowed R4 target"
                            )
    return errors


def child_elements(sd: dict[str, Any]) -> dict[str, dict[str, Any]]:
    root = sd["type"]
    result: dict[str, dict[str, Any]] = {}
    for element in sd["snapshot"]["element"]:
        path = element["path"]
        if not path.startswith(root + "."):
            continue
        tail = path[len(root) + 1 :]
        if "." not in tail:
            result[tail] = element
    return result


def validate_resource_top_level(resource: dict[str, Any], core: PackageReader) -> list[str]:
    errors: list[str] = []
    rt = resource.get("resourceType")
    filename = resource.get("__filename", f"{rt}/{resource.get('id', '?')}")
    if not rt:
        return [f"{filename}: resourceType missing"]
    try:
        sd = core.read_json(f"StructureDefinition-{rt}.json")
    except FileNotFoundError:
        return [f"{filename}: no R4 StructureDefinition found for {rt}"]
    elements = child_elements(sd)
    allowed_keys = {"resourceType", "__filename"}
    choice_keys: dict[str, str] = {}
    for name, element in elements.items():
        if name.endswith("[x]"):
            base_name = name[:-3]
            for t in element.get("type", []):
                key = base_name + type_suffix(t["code"])
                allowed_keys.add(key)
                choice_keys[key] = t["code"]
        else:
            allowed_keys.add(name)
            if any(t.get("code") in PRIMITIVE_TYPES for t in element.get("type", [])):
                allowed_keys.add("_" + name)
    for key in resource:
        if key not in allowed_keys:
            errors.append(f"{filename}: unknown top-level R4 element {key}")
    for name, element in elements.items():
        min_card = element.get("min", 0)
        max_card = element.get("max", "1")
        if name.endswith("[x]"):
            base_name = name[:-3]
            present = [k for k in resource if k.startswith(base_name) and k in choice_keys]
            if min_card and not present:
                errors.append(f"{filename}: required choice {name} is missing")
            if len(present) > 1:
                errors.append(f"{filename}: more than one choice supplied for {name}: {present}")
            for key in present:
                if not value_matches_type(resource[key], choice_keys[key]):
                    errors.append(f"{filename}: {key} has wrong JSON type for {choice_keys[key]}")
            continue
        if min_card and name not in resource:
            errors.append(f"{filename}: required R4 element {name} is missing")
        if name not in resource:
            continue
        value = resource[name]
        if max_card == "*" or (max_card.isdigit() and int(max_card) > 1):
            if not isinstance(value, list):
                errors.append(f"{filename}: repeating element {name} must be a JSON array")
                continue
            values = value
        else:
            if isinstance(value, list):
                errors.append(f"{filename}: singleton element {name} must not be a JSON array")
                continue
            values = [value]
        types = [t["code"] for t in element.get("type", [])]
        if types:
            for item in values:
                if not any(value_matches_type(item, code) for code in types):
                    errors.append(f"{filename}: {name} has wrong JSON type for R4 types {types}")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--r4-package",
        type=Path,
        required=True,
        help="Path to hl7.fhir.r4.core#4.0.1 package directory or .tgz",
    )
    args = parser.parse_args()
    core = PackageReader(args.r4_package)
    resources, generated_by_url = load_generated()
    errors: list[str] = []
    profile_count = 0
    instance_count = 0
    for resource in resources:
        errors.extend(validate_resource_top_level(resource, core))
        if resource.get("resourceType") == "StructureDefinition" and resource.get("derivation") == "constraint":
            profile_count += 1
            errors.extend(validate_profile_differential(resource, core, generated_by_url))
        else:
            instance_count += 1
        if resource.get("resourceType") == "Bundle":
            for entry in resource.get("entry", []):
                nested = dict(entry.get("resource", {}))
                if nested:
                    nested["__filename"] = f"{resource['__filename']}::{nested.get('resourceType')}/{nested.get('id', '?')}"
                    errors.extend(validate_resource_top_level(nested, core))
    core.close()

    report = ROOT / "validation" / "r4-structure-validation.md"
    report.parent.mkdir(exist_ok=True)
    lines = [
        "# FHIR R4 StructureDefinition validation",
        "",
        f"Validated {profile_count} constrained profiles and {instance_count} other generated resources against the supplied FHIR R4 4.0.1 StructureDefinitions.",
        "",
    ]
    if errors:
        lines += ["## Errors", ""] + [f"- {e}" for e in errors]
    else:
        lines += [
            "**PASS** — all differential paths, cardinality restrictions, type restrictions, and generated resource top-level structures are compatible with FHIR R4 4.0.1.",
            "",
            "This deterministic offline check is complementary to, not a replacement for, the HL7 FHIR Validator and IG Publisher QA.",
        ]
    report.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(report.read_text(encoding="utf-8"), end="")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
