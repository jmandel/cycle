/**
 * gen-example.ts (bun) — generate the longitudinal worked-example resources.
 *
 * Turns the deterministic copper-IUD case (viewer-src/dataset.mjs) into
 * new-model FHIR R4 resources, assembled into a PeriodTrackingBundle that
 * conforms to the IG's profiles. The encoding emits the Layer 0 boolean
 * bleeding core first, then Layer 1 structured facts. Use standard codes only where they match the
 * synthetic source meaning; several values use the app-native escape hatch. Writes
 * the bundle under dist/ for local validation/demo use; generated sample data is
 * not committed as IG input.
 *
 * Run ahead of the publisher:  bun scripts/gen-example.ts
 */
import { buildDataset, IUD_DATE } from "../viewer-src/dataset.mjs";
import { SYS, LOINC, SCT, FLOW_CODE_BY_LEVEL, SYMPTOM_DEFS, APP_SYMPTOM_DEFS } from "../viewer-src/codes.mjs";
import { mkdir } from "node:fs/promises";

const CANON = "https://cycle.fhir.me";
const BASE = "https://example.org/fhir";
const ref = (t: string, id: string) => ({ reference: `${t}/${id}` });
const PT = "pt-longitudinal";
const DEV = "periodicity-app";
const SURVEY = { coding: [{ system: SYS.obsCat, code: "survey", display: "Survey" }] };
const VITALS = { coding: [{ system: SYS.obsCat, code: "vital-signs", display: "Vital Signs" }] };

type Res = any;
const entries: Res[] = [];
const add = (r: Res) => { entries.push(r); return r; };
const factProfiles = {
  bleeding: [`${CANON}/StructureDefinition/menstrual-bleeding-fact`],
  flow: [`${CANON}/StructureDefinition/menstrual-flow-fact`],
  symptom: [`${CANON}/StructureDefinition/symptom-fact`],
  pain: [`${CANON}/StructureDefinition/numeric-pain-severity-fact`],
  bbt: [`${CANON}/StructureDefinition/basal-body-temperature-fact`],
};

// SNOMED/cycle codings in generated resources omit display to avoid display-name
// validation churn; the codes themselves are validated against the terminology server.
const cc = (system: string, code: string, display?: string) => ({ coding: [{ system, code, ...(display ? { display } : {}) }] });
const qty = (value: number, code: string, unit: string) => ({ valueQuantity: { value, unit, system: SYS.ucum, code } });
const base64Utf8 = (text: string) => {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

function fact(profile: string[], id: string, date: string, code: any, value: any, extra: any = {}) {
  return add({
    resourceType: "Observation", id, meta: { profile },
    status: "final", category: [extra.category || SURVEY], code,
    subject: ref("Patient", PT), effectiveDateTime: extra.effective || date,
    ...value, device: ref("Device", DEV),
    ...(extra.method ? { method: extra.method } : {}),
  });
}

// --- Patient, Device ---
add({
  resourceType: "Patient", id: PT,
  identifier: [{ system: "https://example.org/mrn", value: "PT-MVP-LONG-001" }],
  name: [{ use: "usual", family: "Rivera", given: ["Sam"] }], birthDate: "1994-02-09",
  text: { status: "generated", div: `<div xmlns="http://www.w3.org/1999/xhtml"><p><b>Sam Rivera</b>, born 9 Feb 1994. Synthetic longitudinal example.</p></div>` },
});
add({
  resourceType: "Device", id: DEV, status: "active",
  deviceName: [{ name: "Periodicity (synthetic reference app)", type: "user-friendly-name" }],
  type: { text: "Period-tracking application" }, version: [{ value: "synthetic" }],
  text: { status: "generated", div: `<div xmlns="http://www.w3.org/1999/xhtml"><p>Source application: <b>Periodicity</b> (synthetic reference app).</p></div>` },
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
  text: { status: "generated", div: `<div xmlns="http://www.w3.org/1999/xhtml"><p>Example app-native symptom dictionary containing <code>low-mood</code> and <code>pulling-sensation</code>.</p></div>` },
});

// --- IUD insertion event (the clinical context of this case) ---
add({
  resourceType: "Procedure", id: "iud-insertion", status: "completed",
  code: { coding: [{ system: SYS.sct, code: SCT.iudInsertion }], text: "Copper IUD insertion" },
  subject: ref("Patient", PT), performedDateTime: IUD_DATE,
  text: { status: "generated", div: `<div xmlns="http://www.w3.org/1999/xhtml"><p>Copper IUD inserted on ${IUD_DATE}.</p></div>` },
});

// --- facts (Layer 0 bleeding core + Layer 1 structured facts) ---
const daily = buildDataset();
const slug = (d: string) => d.replace(/-/g, "");
let factCount = 0;
let appNativeDay: string | null = null;

for (const d of daily) {
  const s = slug(d.date);
  const mk = (profile: string[], id: string, code: any, value: any, extra: any = {}) => { fact(profile, id, d.date, code, value, extra); factCount++; };

  mk(factProfiles.bleeding, `bleeding-${s}`, cc(SYS.cycle, "menstrual-bleeding", "Menstrual bleeding"), { valueBoolean: (d.flow || 0) > 0 });
  if (d.flow != null) mk(factProfiles.flow, `flow-${s}`, cc(SYS.cycle, "menstrual-flow", "Patient-reported menstrual flow category"), { valueCodeableConcept: cc(SYS.cycle, FLOW_CODE_BY_LEVEL[d.flow]) });
  if ((d.pain || 0) > 0) mk(factProfiles.pain, `pain-${s}`, cc(SYS.loinc, LOINC.painScore, "Pain severity - 0-10 verbal numeric rating [Score] - Reported"), qty(d.pain, "{score}", "{score}"));
  if (d.painTypes?.includes("dyspareunia")) mk(factProfiles.symptom, `dyspareunia-${s}`, cc(SYS.cycle, "symptom", "Symptom"), { valueCodeableConcept: cc(SYS.sct, SCT.dyspareunia) });
  if (d.symptoms) for (const sd of SYMPTOM_DEFS) {
    if (d.symptoms[sd.key] > 0) mk(factProfiles.symptom, `sym-${sd.key.toLowerCase()}-${s}`, cc(SYS.cycle, "symptom", "Symptom"), { valueCodeableConcept: cc(SYS.sct, sd.sct) });
  }
  if (d.symptoms) for (const sd of APP_SYMPTOM_DEFS) {
    if (d.symptoms[sd.key] > 0) mk(factProfiles.symptom, `sym-${sd.key.toLowerCase()}-${s}`, cc(SYS.cycle, "symptom", "Symptom"), {
      valueCodeableConcept: { coding: [{ system: SYS.appExample, code: sd.code, display: sd.display, userSelected: true }], text: sd.display },
    });
  }
  if (d.bbt != null) mk(factProfiles.bbt, `bbt-${s}`, cc(SYS.loinc, LOINC.bodyTemp, "Body temperature"), qty(d.bbt, "Cel", "degree Celsius"),
    { category: VITALS, effective: `${d.date}T06:45:00-05:00`, method: cc(SYS.sct, SCT.basalTempMethod) });

  // one additional app-native fact (the documented escape hatch), on the first IMB day
  if (!appNativeDay && d.intermenstrual) {
    appNativeDay = d.date;
    mk(factProfiles.symptom, `custom-${s}`, cc(SYS.cycle, "symptom", "Symptom"), {
      valueCodeableConcept: { coding: [{ system: SYS.appExample, code: "pulling-sensation", display: "Pulling sensation", userSelected: true }], text: "Pulling sensation" },
    });
  }
}

// --- optional native-JSON archive (the "Complete export" safety net) ---
const nativeDays = daily.filter((d) => d.isPeriod || d.note || d.bbt != null).slice(0, 6).map((d) => ({
  date: d.date, bleeding: (d.flow || 0) > 0, flow: d.flow ? FLOW_CODE_BY_LEVEL[d.flow].replace("flow-", "") : undefined,
  painScore: d.pain || undefined, temperature: d.bbt != null ? { value: d.bbt, unit: "Cel", basal: true } : undefined, note: d.note || undefined,
}));
const native = { sourceApp: "Periodicity", appVersion: "synthetic", schemaVersion: 1, timezone: "America/Chicago", days: nativeDays };
add({
  resourceType: "Binary", id: "native-source", contentType: "application/json",
  securityContext: ref("Patient", PT), data: base64Utf8(JSON.stringify(native)),
});

// --- assemble the bundle ---
const bundle = {
  resourceType: "Bundle", id: "period-tracking-longitudinal-example",
  meta: { profile: [`${CANON}/StructureDefinition/period-tracking-bundle`] },
  identifier: { system: "https://example.org/period-tracking-export", value: "export-longitudinal-001" },
  type: "collection", timestamp: "2026-06-21T18:00:00-05:00",
  entry: entries.map((r) => ({ fullUrl: `${BASE}/${r.resourceType}/${r.id}`, resource: r })),
};

const out = Bun.env.EXAMPLE_OUT || `${import.meta.dir}/../dist/examples/Bundle-period-tracking-longitudinal-example.json`;
await mkdir(out.slice(0, out.lastIndexOf("/")), { recursive: true });
await Bun.write(out, JSON.stringify(bundle, null, 2));
console.log(`wrote ${out}`);
console.log(`  entries=${entries.length} facts=${factCount} appNativeDay=${appNativeDay}`);
