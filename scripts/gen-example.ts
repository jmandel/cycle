/**
 * gen-example.ts (bun) — generate the longitudinal worked-example resources.
 *
 * Turns the deterministic copper-IUD case (viewer-src/dataset.mjs) into
 * new-model FHIR R4 resources, assembled into a PeriodTrackingBundle that
 * conforms to the IG's profiles. The encoding emits the Layer 0 boolean
 * bleeding core first, then Layer 1 structured facts. Use standard codes only where they match the
 * synthetic source meaning; several values use the app-native escape hatch. Writes
 * the Bundle and standalone profile examples under dist/ for local validation/demo use; generated sample data is
 * not committed as IG input.
 *
 * Run ahead of the publisher:  bun scripts/gen-example.ts
 */
import { buildDataset, IUD_DATE } from "../viewer-src/dataset.mjs";
import { SYS, LOINC, SCT, FLOW_CODE_BY_LEVEL, SYMPTOM_DEFS, APP_SYMPTOM_DEFS } from "../viewer-src/codes.mjs";
import { mkdir } from "node:fs/promises";

const BASE = "https://example.org/fhir";
const ref = (t: string, id: string) => ({ reference: `${t}/${id}` });
const PT = "pt-longitudinal";
const DEV = "periodicity-app";

type Res = any;
const entries: Res[] = [];
const add = (r: Res) => { entries.push(r); return r; };
const exampleIds = {
  bleeding: "menstrual-bleeding-example",
  flow: "menstrual-flow-example",
  symptom: "symptom-example",
  pain: "numeric-pain-severity-example",
  bbt: "basal-body-temperature-example",
};
const exampleByKind: Record<string, Res> = {};

// SNOMED/cycle codings in generated resources omit display to avoid display-name
// validation churn; the codes themselves are validated against the terminology server.
const cc = (system: string, code: string, display?: string) => ({ coding: [{ system, code, ...(display ? { display } : {}) }] });
const qty = (value: number, code: string, unit: string) => ({ valueQuantity: { value, unit, system: SYS.ucum, code } });

function standaloneExample(kind: keyof typeof exampleIds, resource: Res) {
  if (exampleByKind[kind]) return;
  const clone = structuredClone(resource);
  clone.id = exampleIds[kind];
  delete clone.subject;
  delete clone.device;
  if (kind === "bbt") {
    clone.contained = [{ resourceType: "Patient", id: "example-patient" }];
    clone.subject = { reference: "#example-patient" };
  }
  exampleByKind[kind] = clone;
}

function fact(kind: keyof typeof exampleIds, id: string, date: string, code: any, value: any, extra: any = {}) {
  const resource = add({
    resourceType: "Observation", id,
    status: "final", code,
    subject: ref("Patient", PT), effectiveDateTime: extra.effective || date,
    ...value, device: ref("Device", DEV),
  });
  standaloneExample(kind, resource);
  return resource;
}

// --- Patient, Device ---
add({
  resourceType: "Patient", id: PT,
  identifier: [{ system: "https://example.org/mrn", value: "PT-MVP-LONG-001" }],
  name: [{ use: "usual", family: "Rivera", given: ["Sam"] }], birthDate: "1994-02-09",
});
add({
  resourceType: "Device", id: DEV, status: "active",
  deviceName: [{ name: "Periodicity (synthetic reference app)", type: "user-friendly-name" }],
  type: { text: "Period-tracking application" }, version: [{ value: "synthetic" }],
});

// --- app-native symptom CodeSystem (the escape hatch for source labels without exact standard codes) ---
add({
  resourceType: "CodeSystem", id: "example-app-symptoms",
  url: SYS.appExample, version: "1", name: "ExampleAppSymptoms", title: "Example App Symptoms",
  description: "An illustrative app-native symptom dictionary for the worked example, demonstrating the escape hatch for source terms with no exact standard code.",
  status: "active", experimental: true, content: "complete", caseSensitive: true,
  concept: [
    { code: "low-mood", display: "Low mood", definition: "A source symptom label retained in app-native terminology because no active standard concept was accepted as exact." },
    { code: "pulling-sensation", display: "Pulling sensation", definition: "A user-defined symptom retained in its source vocabulary because no reviewed standard mapping was established." },
  ],
});

// --- IUD insertion event (the clinical context of this case) ---
add({
  resourceType: "Procedure", id: "iud-insertion", status: "completed",
  code: { coding: [{ system: SYS.sct, code: SCT.iudInsertion }], text: "Copper IUD insertion" },
  subject: ref("Patient", PT), performedDateTime: IUD_DATE,
});

// --- facts (Layer 0 bleeding core + Layer 1 structured facts) ---
const daily = buildDataset();
const slug = (d: string) => d.replace(/-/g, "");
let factCount = 0;
let appNativeDay: string | null = null;

for (const d of daily) {
  const s = slug(d.date);
  const mk = (kind: keyof typeof exampleIds, id: string, code: any, value: any, extra: any = {}) => { fact(kind, id, d.date, code, value, extra); factCount++; };

  mk("bleeding", `bleeding-${s}`, cc(SYS.cycle, "menstrual-bleeding", "Menstrual bleeding"), { valueBoolean: (d.flow || 0) > 0 });
  if (d.flow != null) mk("flow", `flow-${s}`, cc(SYS.cycle, "menstrual-flow", "Patient-reported menstrual flow category"), { valueCodeableConcept: cc(SYS.cycle, FLOW_CODE_BY_LEVEL[d.flow]) });
  if ((d.pain || 0) > 0) mk("pain", `pain-${s}`, cc(SYS.loinc, LOINC.painScore, "Pain severity - 0-10 verbal numeric rating [Score] - Reported"), qty(d.pain, "{score}", "{score}"));
  if (d.painTypes?.includes("dyspareunia")) mk("symptom", `dyspareunia-${s}`, cc(SYS.cycle, "symptom", "Symptom"), { valueCodeableConcept: cc(SYS.sct, SCT.dyspareunia) });
  if (d.symptoms) for (const sd of SYMPTOM_DEFS) {
    if (d.symptoms[sd.key] > 0) mk("symptom", `sym-${sd.key.toLowerCase()}-${s}`, cc(SYS.cycle, "symptom", "Symptom"), { valueCodeableConcept: cc(SYS.sct, sd.sct) });
  }
  if (d.symptoms) for (const sd of APP_SYMPTOM_DEFS) {
    if (d.symptoms[sd.key] > 0) mk("symptom", `sym-${sd.key.toLowerCase()}-${s}`, cc(SYS.cycle, "symptom", "Symptom"), {
      valueCodeableConcept: { coding: [{ system: SYS.appExample, code: sd.code, display: sd.display, userSelected: true }], text: sd.display },
    });
  }
  if (d.bbt != null) mk("bbt", `bbt-${s}`, cc(SYS.loinc, LOINC.bodyTemp, "Body temperature"), qty(d.bbt, "Cel", "degree Celsius"),
    { effective: `${d.date}T06:45:00-05:00` });

  // one additional app-native fact (the documented escape hatch), on the first IMB day
  if (!appNativeDay && d.intermenstrual) {
    appNativeDay = d.date;
    mk("symptom", `custom-${s}`, cc(SYS.cycle, "symptom", "Symptom"), {
      valueCodeableConcept: { coding: [{ system: SYS.appExample, code: "pulling-sensation", display: "Pulling sensation", userSelected: true }], text: "Pulling sensation" },
    });
  }
}

// --- assemble the bundle ---
const bundle = {
  resourceType: "Bundle", id: "period-tracking-longitudinal-example",
  identifier: { system: "https://example.org/period-tracking-export", value: "export-longitudinal-001" },
  type: "collection", timestamp: "2026-06-21T18:00:00-05:00",
  entry: entries.map((r) => ({ fullUrl: `${BASE}/${r.resourceType}/${r.id}`, resource: r })),
};

const out = Bun.env.EXAMPLE_OUT || `${import.meta.dir}/../dist/examples/Bundle-period-tracking-longitudinal-example.json`;
const outDir = out.slice(0, out.lastIndexOf("/"));
await mkdir(outDir, { recursive: true });
await Bun.write(out, JSON.stringify(bundle, null, 2));
for (const [kind, resource] of Object.entries(exampleByKind)) {
  await Bun.write(`${outDir}/Observation-${exampleIds[kind as keyof typeof exampleIds]}.json`, JSON.stringify(resource, null, 2));
}
console.log(`wrote ${out}`);
console.log(`  entries=${entries.length} facts=${factCount} appNativeDay=${appNativeDay}`);
