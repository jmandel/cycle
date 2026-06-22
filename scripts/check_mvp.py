#!/usr/bin/env python3
"""Perform deterministic integrity and semantic checks on the MVP artifacts."""
from __future__ import annotations

import base64
import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
RES = ROOT / "fsh-generated" / "resources"
CYCLE_SYSTEM = "https://fhir.me/cycle/CodeSystem/cycle"
FACT_PROFILE = "https://fhir.me/cycle/StructureDefinition/period-tracking-fact"
PANEL_PROFILE = "https://fhir.me/cycle/StructureDefinition/daily-tracking-panel"
BUNDLE_PROFILE = "https://fhir.me/cycle/StructureDefinition/period-tracking-bundle"
EXPECTED_CODES = {
    "daily-tracking-panel",
    "menstrual-flow",
    "flow-none",
    "flow-spotting",
    "flow-light",
    "flow-moderate",
    "flow-heavy",
}
EXPECTED_PROFILES = {
    "period-tracking-bundle",
    "period-tracking-fact",
    "daily-tracking-panel",
}
VALUE_KEYS = {"valueQuantity", "valueCodeableConcept", "valueString", "valueBoolean"}


def load(name: str) -> dict[str, Any]:
    path = RES / name
    if not path.exists():
        raise AssertionError(f"Missing generated resource: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def walk_references(value: Any):
    if isinstance(value, dict):
        for key, child in value.items():
            if key == "reference" and isinstance(child, str):
                yield child
            else:
                yield from walk_references(child)
    elif isinstance(value, list):
        for child in value:
            yield from walk_references(child)


def coding_exists(concept: dict[str, Any], system: str, code: str) -> bool:
    return any(c.get("system") == system and c.get("code") == code for c in concept.get("coding", []))


def ref_tuple(ref: str) -> tuple[str, str] | None:
    if ref.startswith("http://") or ref.startswith("https://") or ref.startswith("urn:") or ref.startswith("#"):
        return None
    if "/" not in ref:
        return None
    return tuple(ref.split("/", 1))  # type: ignore[return-value]


def main() -> int:
    messages: list[str] = []
    errors: list[str] = []

    try:
        cs = load("CodeSystem-cycle.json")
        codes = {c["code"] for c in cs.get("concept", [])}
        assert codes == EXPECTED_CODES, f"Project CodeSystem codes differ: {sorted(codes)}"
        messages.append("Project CodeSystem contains exactly the expected seven concepts.")

        vs = load("ValueSet-menstrual-flow.json")
        included = {
            c["code"]
            for inc in vs.get("compose", {}).get("include", [])
            if inc.get("system") == CYCLE_SYSTEM
            for c in inc.get("concept", [])
        }
        assert included == EXPECTED_CODES - {"daily-tracking-panel", "menstrual-flow"}
        messages.append("Menstrual Flow ValueSet contains exactly the five ordinal result codes.")

        profiles = {
            json.loads(path.read_text(encoding="utf-8")).get("id")
            for path in RES.glob("StructureDefinition-*.json")
        }
        assert profiles == EXPECTED_PROFILES, f"Profile set differs: {sorted(profiles)}"
        messages.append("Exactly three MVP profiles were generated.")

        bundle = load("Bundle-period-tracking-bundle-example.json")
        assert BUNDLE_PROFILE in bundle.get("meta", {}).get("profile", [])
        assert bundle.get("type") == "collection"
        assert bundle.get("identifier") and bundle.get("timestamp")
        assert "link" not in bundle and "total" not in bundle
        entries = bundle.get("entry", [])
        full_urls = [entry.get("fullUrl") for entry in entries]
        assert None not in full_urls
        assert len(full_urls) == len(set(full_urls)), "Bundle fullUrl values are not unique"
        assert all("request" not in e and "response" not in e and "search" not in e for e in entries)

        resources = [entry.get("resource", {}) for entry in entries]
        keys = {(r.get("resourceType"), r.get("id")) for r in resources}
        urls = set(full_urls)
        for resource in resources:
            for ref in walk_references(resource):
                if ref.startswith("#"):
                    continue
                if ref.startswith("http://") or ref.startswith("https://") or ref.startswith("urn:"):
                    if ref.startswith("https://example.org/fhir/") and ref not in urls:
                        errors.append(f"Unresolved absolute example reference: {ref}")
                    continue
                key = ref_tuple(ref)
                if key and key not in keys:
                    errors.append(f"Unresolved relative reference: {ref}")

        patients = [r for r in resources if r.get("resourceType") == "Patient"]
        devices = [r for r in resources if r.get("resourceType") == "Device"]
        observations = [r for r in resources if r.get("resourceType") == "Observation"]
        provenances = [r for r in resources if r.get("resourceType") == "Provenance"]
        binaries = [r for r in resources if r.get("resourceType") == "Binary"]
        assert len(patients) == 1
        assert devices
        assert provenances
        assert len(binaries) == 1
        assert devices[0].get("deviceName", [{}])[0].get("name") == "MVP Reference Tracker"
        assert devices[0].get("version", [{}])[0].get("value") == "0.1.0"

        facts: list[dict[str, Any]] = []
        panels: list[dict[str, Any]] = []
        by_key = {(r.get("resourceType"), r.get("id")): r for r in resources}
        for obs in observations:
            profile_set = set(obs.get("meta", {}).get("profile", []))
            assert obs.get("status") == "final"
            assert any(coding_exists(cat, "http://terminology.hl7.org/CodeSystem/observation-category", "survey") for cat in obs.get("category", []))
            assert obs.get("subject", {}).get("reference", "").startswith("Patient/")
            assert len(obs.get("performer", [])) == 1 and obs["performer"][0].get("reference", "").startswith("Patient/")
            assert obs.get("device", {}).get("reference", "").startswith("Device/")
            assert "effectiveDateTime" in obs
            if PANEL_PROFILE in profile_set:
                panels.append(obs)
                assert coding_exists(obs.get("code", {}), CYCLE_SYSTEM, "daily-tracking-panel")
                assert not VALUE_KEYS.intersection(obs)
                assert obs.get("hasMember") or obs.get("note")
                assert "component" not in obs and "derivedFrom" not in obs
            elif FACT_PROFILE in profile_set:
                facts.append(obs)
                present_values = VALUE_KEYS.intersection(obs)
                assert len(present_values) == 1, f"Fact {obs.get('id')} has value keys {sorted(present_values)}"
                assert "dataAbsentReason" not in obs
                assert "hasMember" not in obs and "derivedFrom" not in obs and "component" not in obs
            else:
                raise AssertionError(f"Observation {obs.get('id')} does not declare an MVP profile")

        assert len(panels) == 3, f"Expected 3 daily panels, found {len(panels)}"
        assert len(facts) == 12, f"Expected 12 facts, found {len(facts)}"

        for panel in panels:
            for member in panel.get("hasMember", []):
                key = ref_tuple(member["reference"])
                assert key and key in by_key, f"Unresolved panel member {member['reference']}"
                fact = by_key[key]
                assert FACT_PROFILE in fact.get("meta", {}).get("profile", [])
                assert fact.get("subject") == panel.get("subject")
                assert fact.get("device") == panel.get("device")
                assert str(fact.get("effectiveDateTime"))[:10] == str(panel.get("effectiveDateTime"))[:10]

        flow_values = EXPECTED_CODES - {"daily-tracking-panel", "menstrual-flow"}
        for fact in facts:
            code = fact.get("code", {})
            if coding_exists(code, CYCLE_SYSTEM, "menstrual-flow"):
                values = {
                    c.get("code")
                    for c in fact.get("valueCodeableConcept", {}).get("coding", [])
                    if c.get("system") == CYCLE_SYSTEM
                }
                assert len(values) == 1 and values <= flow_values, f"Bad flow value in {fact.get('id')}: {values}"
            if coding_exists(code, "http://loinc.org", "72514-3"):
                q = fact.get("valueQuantity", {})
                assert 0 <= q.get("value", -1) <= 10
                assert q.get("system") == "http://unitsofmeasure.org" and q.get("code") == "{score}"
            if coding_exists(code, "http://loinc.org", "8310-5"):
                q = fact.get("valueQuantity", {})
                assert q.get("system") == "http://unitsofmeasure.org"
                assert q.get("code") in {"Cel", "[degF]"}
            if coding_exists(code, "http://loinc.org", "8678-5"):
                status_codes = {
                    c.get("code")
                    for c in fact.get("valueCodeableConcept", {}).get("coding", [])
                    if c.get("system") == "http://snomed.info/sct"
                }
                assert status_codes <= {"289894009", "289895005"} and len(status_codes) == 1

        normalized_ids = {r["id"] for r in facts + panels}
        provenance_targets = {
            ref_tuple(t["reference"])[1]
            for p in provenances
            for t in p.get("target", [])
            if ref_tuple(t.get("reference", ""))
        }
        assert normalized_ids <= provenance_targets, "Provenance does not target every normalized fact and panel"
        assert any(e.get("role") == "source" and e.get("what", {}).get("reference") == "Binary/native-source-json-example" for e in provenances[0].get("entity", []))

        native_bytes = base64.b64decode(binaries[0]["data"], validate=True)
        native_obj = json.loads(native_bytes)
        source_file = ROOT / "examples" / "native-source" / "reference-tracker-sample.json"
        assert native_obj == json.loads(source_file.read_text(encoding="utf-8"))
        assert native_obj["sourceApp"] == "MVP Reference Tracker"
        messages.append("Worked Bundle contains 3 daily panels, 12 granular facts, required Provenance, and a byte-equivalent native JSON archive.")

        all_json = list(RES.glob("*.json"))
        for resource in all_json:
            json.loads(resource.read_text(encoding="utf-8"))
        messages.append(f"All {len(all_json)} generated JSON resources parse successfully.")
    except (AssertionError, KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        errors.append(str(exc))

    report = ROOT / "validation" / "integrity-check.txt"
    report.parent.mkdir(exist_ok=True)
    report.write_text(
        "Period Tracking MVP integrity check\n\n"
        + "\n".join(f"PASS: {m}" for m in messages)
        + ("\n" if messages else "")
        + "\n".join(f"FAIL: {e}" for e in errors)
        + "\n",
        encoding="utf-8",
    )
    print(report.read_text(encoding="utf-8"), end="")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
