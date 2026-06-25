#!/usr/bin/env bun
/**
 * Deterministic integrity and semantic checks on the MVP artifacts.
 *
 * Terminology and profiles come from the SUSHI output (fsh-generated/); the
 * worked example is the generated longitudinal Bundle supplied by BUNDLE_FILE
 * or produced under dist/examples/.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const RES = join(ROOT, "fsh-generated", "resources");
const BUNDLE_FILE = Bun.env.BUNDLE_FILE || join(ROOT, "dist", "examples", "Bundle-period-tracking-longitudinal-example.json");
const CYCLE = "https://cycle.fhir.me/CodeSystem/cycle";
const LOINC = "http://loinc.org";
const UCUM = "http://unitsofmeasure.org";
const OBSCAT = "http://terminology.hl7.org/CodeSystem/observation-category";
const BUNDLE_PROFILE = "https://cycle.fhir.me/StructureDefinition/period-tracking-bundle";
const FACT_PROFILE = "https://cycle.fhir.me/StructureDefinition/period-tracking-fact";
const FACT_PROFILES = {
  bleeding: "https://cycle.fhir.me/StructureDefinition/menstrual-bleeding-fact",
  flow: "https://cycle.fhir.me/StructureDefinition/menstrual-flow-fact",
  symptom: "https://cycle.fhir.me/StructureDefinition/symptom-fact",
  pain: "https://cycle.fhir.me/StructureDefinition/numeric-pain-severity-fact",
  bbt: "https://cycle.fhir.me/StructureDefinition/basal-body-temperature-fact",
};
const ALL_FACT_PROFILES = new Set([FACT_PROFILE, ...Object.values(FACT_PROFILES)]);
const EXPECTED_CODES = new Set(["menstrual-bleeding", "menstrual-flow", "symptom", "flow-none", "flow-spotting", "flow-light", "flow-moderate", "flow-heavy"]);
const EXPECTED_PROFILES = new Set(["period-tracking-bundle", "period-tracking-fact", "menstrual-bleeding-fact", "menstrual-flow-fact", "symptom-fact", "numeric-pain-severity-fact", "basal-body-temperature-fact"]);
const FLOW_VALUES = new Set(["flow-none", "flow-spotting", "flow-light", "flow-moderate", "flow-heavy"]);
const VALUE_KEYS = new Set(["valueQuantity", "valueCodeableConcept", "valueString", "valueBoolean"]);
const RESOURCE_SORT = "http://hl7.org/fhir/tools/StructureDefinition/resource-sort";
const EXPECTED_ARTIFACT_SORT = new Map([
  ["StructureDefinition/menstrual-bleeding-fact", 10],
  ["StructureDefinition/period-tracking-bundle", 20],
  ["StructureDefinition/menstrual-flow-fact", 30],
  ["StructureDefinition/symptom-fact", 40],
  ["StructureDefinition/numeric-pain-severity-fact", 50],
  ["StructureDefinition/basal-body-temperature-fact", 60],
  ["StructureDefinition/period-tracking-fact", 10],
  ["ValueSet/menstrual-flow", 10],
  ["ValueSet/common-tracker-symptoms", 20],
  ["ValueSet/ptmvp-fact-category", 30],
  ["CodeSystem/cycle", 10],
]);

const glob = (pattern: string, cwd: string) => Array.from(new Bun.Glob(pattern).scanSync({ cwd })).sort();
const setEq = <T>(a: Set<T>, b: Set<T>) => a.size === b.size && [...a].every((x) => b.has(x));
const assert = (condition: unknown, message: string): asserts condition => {
  if (!condition) throw new Error(message);
};

async function load(path: string) {
  if (!(await Bun.file(path).exists())) throw new Error(`Missing resource: ${path}`);
  return JSON.parse(await Bun.file(path).text());
}

function hasCoding(cc: any, system: string, code: string) {
  return (cc?.coding || []).some((c: any) => c.system === system && c.code === code);
}

function refTuple(ref?: string) {
  if (!ref || !ref.includes("/") || ref.startsWith("http") || ref.startsWith("urn:") || ref.startsWith("#")) return null;
  return ref.split("/", 2).join("/");
}

function* refs(value: any): Iterable<string> {
  if (Array.isArray(value)) {
    for (const item of value) yield* refs(item);
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (key === "reference" && typeof child === "string") yield child;
      else yield* refs(child);
    }
  }
}

function decodeBase64Json(data: string) {
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function main() {
  const messages: string[] = [];
  const errors: string[] = [];
  try {
    const cs = await load(join(RES, "CodeSystem-cycle.json"));
    assert(setEq(new Set((cs.concept || []).map((c: any) => c.code)), EXPECTED_CODES), "project CodeSystem codes differ");
    messages.push("Project CodeSystem contains exactly the expected eight concepts.");

    const vs = await load(join(RES, "ValueSet-menstrual-flow.json"));
    const inc = new Set<string>();
    for (const include of vs.compose?.include || []) {
      if (include.system !== CYCLE) continue;
      for (const concept of include.concept || []) inc.add(concept.code);
    }
    assert(setEq(inc, FLOW_VALUES), "Menstrual Flow ValueSet differs");
    messages.push("Menstrual Flow ValueSet contains exactly the five ordinal result codes.");

    const profiles = new Set<string>();
    for (const file of glob("StructureDefinition-*.json", RES)) profiles.add((await load(join(RES, file))).id);
    assert(setEq(profiles, EXPECTED_PROFILES), `profile set differs: ${JSON.stringify([...profiles].sort())}`);
    messages.push("Exactly seven MVP profiles were generated.");

    const ig = await load(join(RES, "ImplementationGuide-me.fhir.period-tracking-mvp.json"));
    for (const [reference, expectedSort] of EXPECTED_ARTIFACT_SORT) {
      const resource = (ig.definition?.resource || []).find((r: any) => r.reference?.reference === reference);
      assert(resource, `ImplementationGuide missing resource ${reference}`);
      const sort = (resource.extension || []).find((e: any) => e.url === RESOURCE_SORT)?.valueInteger;
      assert(sort === expectedSort, `ImplementationGuide ${reference} sort is ${sort}, expected ${expectedSort}`);
    }
    messages.push("Artifact sort metadata keeps the core profiles and terminology first.");

    const bundle = await load(BUNDLE_FILE);
    assert((bundle.meta?.profile || []).includes(BUNDLE_PROFILE), "bundle missing profile");
    assert(bundle.type === "collection", "bundle must be a collection");
    const entries = bundle.entry || [];
    const fullUrls = entries.map((e: any) => e.fullUrl);
    assert(!fullUrls.includes(undefined) && new Set(fullUrls).size === fullUrls.length, "fullUrls missing or not unique");

    const resources = entries.map((e: any) => e.resource || {});
    const keys = new Set(resources.map((r: any) => `${r.resourceType}/${r.id}`));
    for (const resource of resources) {
      for (const ref of refs(resource)) {
        const key = refTuple(ref);
        if (key && !keys.has(key)) errors.push(`Unresolved reference: ${ref}`);
      }
    }

    const kinds = new Map<string, any[]>();
    for (const resource of resources) {
      const list = kinds.get(resource.resourceType) || [];
      list.push(resource);
      kinds.set(resource.resourceType, list);
    }

    const facts: any[] = [];
    for (const obs of kinds.get("Observation") || []) {
      const prof = new Set(obs.meta?.profile || []);
      assert(obs.status === "final", `${obs.id} status not final`);
      if (obs.category) assert(["survey", "vital-signs"].some((c) => hasCoding({ coding: obs.category?.[0]?.coding || [] }, OBSCAT, c)), `${obs.id} category not survey/vital-signs`);
      assert("effectiveDateTime" in obs, `${obs.id} missing effectiveDateTime`);
      if ([...prof].some((p) => ALL_FACT_PROFILES.has(p))) {
        facts.push(obs);
        assert([...VALUE_KEYS].filter((k) => k in obs).length === 1, `fact ${obs.id} must have exactly one value`);
      } else {
        throw new Error(`Observation ${obs.id} declares no MVP fact profile`);
      }
    }
    assert(facts.length, "expected facts");

    const bleedingByDate = new Map<string, boolean>();
    const flowByDate = new Map<string, string>();
    for (const fact of facts) {
      const prof = new Set(fact.meta?.profile || []);
      const code = fact.code;
      const date = String(fact.effectiveDateTime || "").slice(0, 10);
      if (hasCoding(code, CYCLE, "menstrual-bleeding")) {
        assert(prof.has(FACT_PROFILES.bleeding), `bleeding fact ${fact.id} missing bleeding profile`);
        assert(typeof fact.valueBoolean === "boolean", `bad bleeding value in ${fact.id}`);
        bleedingByDate.set(date, fact.valueBoolean);
      }
      if (hasCoding(code, CYCLE, "menstrual-flow")) {
        assert(prof.has(FACT_PROFILES.flow), `flow fact ${fact.id} missing flow profile`);
        const vals = new Set<string>((fact.valueCodeableConcept?.coding || []).filter((c: any) => c.system === CYCLE).map((c: any) => c.code));
        assert(vals.size === 1 && [...vals].every((v) => FLOW_VALUES.has(v)), `bad flow value in ${fact.id}`);
        flowByDate.set(date, [...vals][0]);
      }
      if (hasCoding(code, CYCLE, "symptom")) {
        assert(prof.has(FACT_PROFILES.symptom), `symptom fact ${fact.id} missing symptom profile`);
        assert(fact.valueCodeableConcept?.coding?.length || fact.valueCodeableConcept?.text, `bad symptom value in ${fact.id}`);
      }
      if (hasCoding(code, LOINC, "72514-3")) {
        assert(prof.has(FACT_PROFILES.pain), `pain fact ${fact.id} missing pain profile`);
        const q = fact.valueQuantity || {};
        assert(q.value >= 0 && q.value <= 10 && q.system === UCUM && q.code === "{score}", `${fact.id} bad pain value`);
      }
      if (hasCoding(code, LOINC, "8310-5")) {
        assert(prof.has(FACT_PROFILES.bbt), `temperature fact ${fact.id} missing temperature profile`);
        const q = fact.valueQuantity || {};
        assert(q.system === UCUM && ["Cel", "[degF]"].includes(q.code), `${fact.id} bad temperature value`);
        assert((fact.category || []).some((cat: any) => hasCoding({ coding: cat.coding || [] }, OBSCAT, "vital-signs")), "temperature must be category vital-signs");
      }
    }
    assert([...bleedingByDate.values()].some((v) => v === true), "expected at least one bleeding=true core fact");
    assert([...bleedingByDate.values()].some((v) => v === false), "expected at least one bleeding=false core fact");
    for (const [date, flow] of flowByDate) {
      assert(bleedingByDate.has(date), `flow without bleeding core on ${date}`);
      assert(bleedingByDate.get(date) === (flow !== "flow-none"), `flow/bleeding mismatch on ${date}: ${flow}`);
    }

    const binary = kinds.get("Binary")?.[0];
    if (binary) {
      const native = decodeBase64Json(binary.data);
      assert(native.sourceApp === "Periodicity" && native.days, "native archive must parse and name the source app");
    }
    messages.push(`Worked Bundle: ${facts.length} profiled facts, boolean bleeding core, flow consistency, and optional native archive parsing.`);

    const allJson = glob("*.json", RES);
    for (const file of allJson) JSON.parse(await Bun.file(join(RES, file)).text());
    messages.push(`All ${allJson.length} generated JSON resources parse successfully.`);
  } catch (error: any) {
    errors.push(`${error?.name || "Error"}: ${error?.message || error}`);
  }

  const report = join(ROOT, "validation", "integrity-check.txt");
  await Bun.write(report, `Period Tracking MVP integrity check\n\n${messages.map((m) => `PASS: ${m}`).join("\n")}${messages.length ? "\n" : ""}${errors.map((e) => `FAIL: ${e}`).join("\n")}\n`);
  process.stdout.write(await Bun.file(report).text());
  return errors.length ? 1 : 0;
}

process.exit(await main());
