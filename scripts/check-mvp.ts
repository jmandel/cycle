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
const EXAMPLE_IDS = {
  bleeding: "menstrual-bleeding-example",
  flow: "menstrual-flow-example",
  symptom: "symptom-example",
  pain: "numeric-pain-severity-example",
  bbt: "basal-body-temperature-example",
};
const EXPECTED_CODES = new Set(["menstrual-bleeding", "menstrual-flow", "symptom", "flow-none", "flow-spotting", "flow-light", "flow-moderate", "flow-heavy"]);
const EXPECTED_PROFILES = new Set(["period-tracking-bundle", "period-tracking-fact", "menstrual-bleeding", "menstrual-flow", "symptom", "numeric-pain-severity", "basal-body-temperature"]);
const FLOW_VALUES = new Set(["flow-none", "flow-spotting", "flow-light", "flow-moderate", "flow-heavy"]);
const VALUE_KEYS = new Set(["valueQuantity", "valueCodeableConcept", "valueString", "valueBoolean"]);
const RESOURCE_SORT = "http://hl7.org/fhir/tools/StructureDefinition/resource-sort";
const EXPECTED_ARTIFACT_SORT = new Map([
  ["StructureDefinition/menstrual-bleeding", 10],
  ["StructureDefinition/menstrual-flow", 20],
  ["StructureDefinition/symptom", 30],
  ["StructureDefinition/numeric-pain-severity", 40],
  ["StructureDefinition/basal-body-temperature", 50],
  ["StructureDefinition/period-tracking-bundle", 60],
  ["StructureDefinition/period-tracking-fact", 70],
  ["ValueSet/menstrual-flow", 10],
  ["ValueSet/common-tracker-symptoms", 20],
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

function factKind(obs: any): keyof typeof EXAMPLE_IDS | null {
  if (hasCoding(obs.code, CYCLE, "menstrual-bleeding")) return "bleeding";
  if (hasCoding(obs.code, CYCLE, "menstrual-flow")) return "flow";
  if (hasCoding(obs.code, CYCLE, "symptom")) return "symptom";
  if (hasCoding(obs.code, LOINC, "72514-3")) return "pain";
  if (hasCoding(obs.code, LOINC, "8310-5")) return "bbt";
  return null;
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
    assert(!(bundle.meta?.profile?.length), "example Bundle should not stamp meta.profile");
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
      assert(obs.status === "final", `${obs.id} status not final`);
      assert(!(obs.meta?.profile?.length), `${obs.id} should not stamp meta.profile`);
      assert(!obs.category, `${obs.id} should not carry Observation.category`);
      assert("effectiveDateTime" in obs, `${obs.id} missing effectiveDateTime`);
      assert(factKind(obs), `Observation ${obs.id} is not a recognized MVP fact`);
      facts.push(obs);
      assert([...VALUE_KEYS].filter((k) => k in obs).length === 1, `fact ${obs.id} must have exactly one value`);
    }
    assert(facts.length, "expected facts");

    const bleedingByDate = new Map<string, boolean>();
    const flowByDate = new Map<string, string>();
    for (const fact of facts) {
      const code = fact.code;
      const date = String(fact.effectiveDateTime || "").slice(0, 10);
      if (hasCoding(code, CYCLE, "menstrual-bleeding")) {
        assert(typeof fact.valueBoolean === "boolean", `bad bleeding value in ${fact.id}`);
        bleedingByDate.set(date, fact.valueBoolean);
      }
      if (hasCoding(code, CYCLE, "menstrual-flow")) {
        const vals = new Set<string>((fact.valueCodeableConcept?.coding || []).filter((c: any) => c.system === CYCLE).map((c: any) => c.code));
        assert(vals.size === 1 && [...vals].every((v) => FLOW_VALUES.has(v)), `bad flow value in ${fact.id}`);
        flowByDate.set(date, [...vals][0]);
      }
      if (hasCoding(code, CYCLE, "symptom")) {
        assert(fact.valueCodeableConcept?.coding?.length || fact.valueCodeableConcept?.text, `bad symptom value in ${fact.id}`);
      }
      if (hasCoding(code, LOINC, "72514-3")) {
        const q = fact.valueQuantity || {};
        assert(q.value >= 0 && q.value <= 10 && q.system === UCUM && q.code === "{score}", `${fact.id} bad pain value`);
      }
      if (hasCoding(code, LOINC, "8310-5")) {
        const q = fact.valueQuantity || {};
        assert(q.system === UCUM && ["Cel", "[degF]"].includes(q.code), `${fact.id} bad temperature value`);
      }
    }
    assert([...bleedingByDate.values()].some((v) => v === true), "expected at least one bleeding=true core fact");
    assert([...bleedingByDate.values()].some((v) => v === false), "expected at least one bleeding=false core fact");
    for (const [date, flow] of flowByDate) {
      assert(bleedingByDate.has(date), `flow without bleeding core on ${date}`);
      assert(bleedingByDate.get(date) === (flow !== "flow-none"), `flow/bleeding mismatch on ${date}: ${flow}`);
    }

    assert(!kinds.get("Binary")?.length, "worked Bundle should not include a Binary native archive in this MVP");
    messages.push(`Worked Bundle: ${facts.length} recognized facts, boolean bleeding core, and flow consistency.`);

    const exampleDir = dirname(BUNDLE_FILE);
    for (const [kind, id] of Object.entries(EXAMPLE_IDS)) {
      const ex = await load(join(exampleDir, `Observation-${id}.json`));
      assert(ex.resourceType === "Observation" && ex.id === id, `${id} standalone example has wrong resource/id`);
      assert(factKind(ex) === kind, `${id} standalone example has wrong fact shape`);
      assert(!(ex.meta?.profile?.length), `${id} should not stamp meta.profile`);
      assert(!ex.text, `${id} should not include generated narrative`);
      assert(!ex.device, `${id} standalone example should not carry an unresolved device reference`);
      if (kind === "bbt") {
        assert(ex.subject?.reference === "#example-patient", `${id} standalone body-temperature example should carry a contained patient reference`);
        assert(ex.contained?.some((r: any) => r.resourceType === "Patient" && r.id === "example-patient"), `${id} standalone body-temperature example should contain its patient`);
      } else {
        assert(!ex.subject, `${id} standalone example should not carry an unresolved subject reference`);
      }
    }
    messages.push("Standalone profile examples are generated without inline profile stamps.");

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
