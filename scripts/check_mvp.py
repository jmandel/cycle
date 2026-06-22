#!/usr/bin/env python3
"""Deterministic integrity and semantic checks on the MVP artifacts.

Terminology and profiles come from the SUSHI output (fsh-generated/); the single
worked example is the generated longitudinal Bundle in input/resources/.
"""
from __future__ import annotations

import base64
import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
RES = ROOT / "fsh-generated" / "resources"
BUNDLE_FILE = ROOT / "input" / "resources" / "Bundle-period-tracking-longitudinal-example.json"
CYCLE = "https://fhir.me/cycle/CodeSystem/cycle"
LOINC, SCT, UCUM = "http://loinc.org", "http://snomed.info/sct", "http://unitsofmeasure.org"
OBSCAT = "http://terminology.hl7.org/CodeSystem/observation-category"
FACT_PROFILE = "https://fhir.me/cycle/StructureDefinition/period-tracking-fact"
PANEL_PROFILE = "https://fhir.me/cycle/StructureDefinition/daily-tracking-panel"
BUNDLE_PROFILE = "https://fhir.me/cycle/StructureDefinition/period-tracking-bundle"
EXPECTED_CODES = {"daily-tracking-panel", "menstrual-flow", "flow-none", "flow-spotting", "flow-light", "flow-moderate", "flow-heavy"}
EXPECTED_PROFILES = {"period-tracking-bundle", "period-tracking-fact", "daily-tracking-panel"}
FLOW_VALUES = EXPECTED_CODES - {"daily-tracking-panel", "menstrual-flow"}
VALUE_KEYS = {"valueQuantity", "valueCodeableConcept", "valueString", "valueBoolean"}


def load(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise AssertionError(f"Missing resource: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def has_coding(cc: dict[str, Any], system: str, code: str) -> bool:
    return any(c.get("system") == system and c.get("code") == code for c in (cc or {}).get("coding", []))


def ref_tuple(ref: str):
    if not ref or "/" not in ref or ref.startswith(("http", "urn:", "#")):
        return None
    return tuple(ref.split("/", 1))


def main() -> int:
    messages: list[str] = []
    errors: list[str] = []
    try:
        cs = load(RES / "CodeSystem-cycle.json")
        assert {c["code"] for c in cs.get("concept", [])} == EXPECTED_CODES, "project CodeSystem codes differ"
        messages.append("Project CodeSystem contains exactly the expected seven concepts.")

        vs = load(RES / "ValueSet-menstrual-flow.json")
        inc = {c["code"] for i in vs.get("compose", {}).get("include", []) if i.get("system") == CYCLE for c in i.get("concept", [])}
        assert inc == FLOW_VALUES, "Menstrual Flow ValueSet differs"
        messages.append("Menstrual Flow ValueSet contains exactly the five ordinal result codes.")

        profiles = {load(p).get("id") for p in RES.glob("StructureDefinition-*.json")}
        assert profiles == EXPECTED_PROFILES, f"profile set differs: {sorted(profiles)}"
        messages.append("Exactly three MVP profiles were generated.")

        bundle = load(BUNDLE_FILE)
        assert BUNDLE_PROFILE in bundle.get("meta", {}).get("profile", []), "bundle missing profile"
        assert bundle.get("type") == "collection" and bundle.get("identifier") and bundle.get("timestamp")
        assert "link" not in bundle and "total" not in bundle
        entries = bundle.get("entry", [])
        full_urls = [e.get("fullUrl") for e in entries]
        assert None not in full_urls and len(full_urls) == len(set(full_urls)), "fullUrls missing or not unique"
        assert all(not ({"request", "response", "search"} & set(e)) for e in entries)

        resources = [e.get("resource", {}) for e in entries]
        keys = {(r.get("resourceType"), r.get("id")) for r in resources}
        for r in resources:  # references resolve (relative ones)
            for ref in _refs(r):
                key = ref_tuple(ref)
                if key and key not in keys:
                    errors.append(f"Unresolved reference: {ref}")

        kinds = {}
        for r in resources:
            kinds.setdefault(r.get("resourceType"), []).append(r)
        assert len(kinds.get("Patient", [])) == 1, "exactly one Patient required"
        assert kinds.get("Device") and kinds.get("Provenance") and kinds.get("Binary"), "Device/Provenance/Binary required"

        facts, panels = [], []
        by_key = {(r.get("resourceType"), r.get("id")): r for r in resources}
        for obs in kinds.get("Observation", []):
            prof = set(obs.get("meta", {}).get("profile", []))
            assert obs.get("status") == "final"
            assert any(has_coding({"coding": obs.get("category", [{}])[0].get("coding", [])}, OBSCAT, c) for c in ("survey", "vital-signs")), \
                f"{obs.get('id')} category not survey/vital-signs"
            assert obs.get("subject", {}).get("reference", "").startswith("Patient/")
            assert len(obs.get("performer", [])) == 1 and obs["performer"][0]["reference"].startswith("Patient/")
            assert obs.get("device", {}).get("reference", "").startswith("Device/")
            assert "effectiveDateTime" in obs
            if PANEL_PROFILE in prof:
                panels.append(obs)
                assert has_coding(obs.get("code", {}), CYCLE, "daily-tracking-panel")
                assert not (VALUE_KEYS & set(obs)) and "component" not in obs and "derivedFrom" not in obs
                assert obs.get("hasMember") or obs.get("note"), f"empty panel {obs.get('id')}"
            elif FACT_PROFILE in prof:
                facts.append(obs)
                assert len(VALUE_KEYS & set(obs)) == 1, f"fact {obs.get('id')} must have exactly one value"
                assert not ({"hasMember", "component", "derivedFrom", "dataAbsentReason"} & set(obs))
            else:
                raise AssertionError(f"Observation {obs.get('id')} declares no MVP profile")
        assert panels and facts, "expected panels and facts"

        for p in panels:  # panel members resolve, are facts, same patient/device/day
            for m in p.get("hasMember", []):
                k = ref_tuple(m["reference"])
                assert k in by_key, f"unresolved member {m['reference']}"
                f = by_key[k]
                assert FACT_PROFILE in f.get("meta", {}).get("profile", [])
                assert f.get("subject") == p.get("subject") and f.get("device") == p.get("device")
                assert str(f.get("effectiveDateTime"))[:10] == str(p.get("effectiveDateTime"))[:10]

        for f in facts:  # per-fact value semantics
            code = f.get("code", {})
            if has_coding(code, CYCLE, "menstrual-flow"):
                vals = {c["code"] for c in f.get("valueCodeableConcept", {}).get("coding", []) if c.get("system") == CYCLE}
                assert len(vals) == 1 and vals <= FLOW_VALUES, f"bad flow value in {f.get('id')}"
            if has_coding(code, LOINC, "72514-3"):
                q = f.get("valueQuantity", {})
                assert 0 <= q.get("value", -1) <= 10 and q.get("system") == UCUM and q.get("code") == "{score}"
            if has_coding(code, LOINC, "8310-5"):
                q = f.get("valueQuantity", {})
                assert q.get("system") == UCUM and q.get("code") in {"Cel", "[degF]"}
                assert any(has_coding({"coding": cat.get("coding", [])}, OBSCAT, "vital-signs") for cat in f.get("category", [])), \
                    "temperature must be category vital-signs"
            if has_coding(code, LOINC, "8678-5"):
                vals = {c["code"] for c in f.get("valueCodeableConcept", {}).get("coding", []) if c.get("system") == SCT}
                assert vals in ({"289894009"}, {"289895005"}), f"bad menstrual status in {f.get('id')}"
        assert any(has_coding(f.get("code", {}), LOINC, "8678-5") and has_coding(f.get("valueCodeableConcept", {}), SCT, "289895005") for f in facts), \
            "expected at least one explicit-negative (not menstruating) fact"
        assert any(p.get("note") and not p.get("hasMember") for p in panels), "expected at least one note-only panel"

        prov = kinds["Provenance"][0]
        targets = {ref_tuple(t.get("reference", "")) for t in prov.get("target", [])}
        assert {("Observation", p["id"]) for p in panels} <= targets, "Provenance must target every panel"
        assert any(e.get("role") == "source" and ref_tuple(e.get("what", {}).get("reference", "")) == ("Binary", kinds["Binary"][0]["id"]) for e in prov.get("entity", [])), \
            "Provenance must cite the Binary native archive as source"

        native = json.loads(base64.b64decode(kinds["Binary"][0]["data"], validate=True))
        assert native.get("sourceApp") == "Periodicity" and native.get("days"), "native archive must parse and name the source app"
        messages.append(f"Worked Bundle: {len(panels)} daily panels, {len(facts)} facts, explicit-negative + note-only days, Provenance, and a decodable native archive.")

        all_json = list(RES.glob("*.json"))
        for r in all_json:
            json.loads(r.read_text(encoding="utf-8"))
        messages.append(f"All {len(all_json)} generated JSON resources parse successfully.")
    except (AssertionError, KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        errors.append(f"{type(exc).__name__}: {exc}")

    report = ROOT / "validation" / "integrity-check.txt"
    report.parent.mkdir(exist_ok=True)
    report.write_text("Period Tracking MVP integrity check\n\n" + "\n".join(f"PASS: {m}" for m in messages) +
                      ("\n" if messages else "") + "\n".join(f"FAIL: {e}" for e in errors) + "\n", encoding="utf-8")
    print(report.read_text(encoding="utf-8"), end="")
    return 1 if errors else 0


def _refs(value: Any):
    if isinstance(value, dict):
        for k, v in value.items():
            if k == "reference" and isinstance(v, str):
                yield v
            else:
                yield from _refs(v)
    elif isinstance(value, list):
        for v in value:
            yield from _refs(v)


if __name__ == "__main__":
    raise SystemExit(main())
