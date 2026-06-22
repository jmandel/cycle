/**
 * gen-example.ts (bun) — generate the longitudinal worked-example resources.
 *
 * Turns the deterministic copper-IUD case (viewer-src/dataset.mjs) into
 * new-model FHIR R4 resources, assembled into a PeriodTrackingBundle that
 * conforms to the IG's profiles. The encoding is COMMON-CORE / standard-code
 * first (LOINC, SNOMED, the IG cycle CodeSystem); exactly one datum uses the
 * IG's app-native escape hatch. Writes the bundle into input/resources/ so the
 * IG Publisher autoloads it as a published, validated example.
 *
 * Run ahead of the publisher:  bun scripts/gen-example.ts
 */
import { buildDataset, IUD_DATE } from "../viewer-src/dataset.mjs";
import { SYS, LOINC, SCT, FLOW_CODE_BY_LEVEL, SYMPTOM_DEFS } from "../viewer-src/codes.mjs";

const CANON = "https://fhir.me/cycle";
const BASE = "https://example.org/fhir";
const ref = (t: string, id: string) => ({ reference: `${t}/${id}` });
const PT = "pt-longitudinal";
const DEV = "periodicity-app";
const SURVEY = { coding: [{ system: SYS.obsCat, code: "survey", display: "Survey" }] };
const VITALS = { coding: [{ system: SYS.obsCat, code: "vital-signs", display: "Vital Signs" }] };

type Res = any;
const entries: Res[] = [];
const add = (r: Res) => { entries.push(r); return r; };
const factProfile = [`${CANON}/StructureDefinition/period-tracking-fact`];
const panelProfile = [`${CANON}/StructureDefinition/daily-tracking-panel`];

// SNOMED/cycle codings in generated resources omit display to avoid display-name
// validation churn; the codes themselves are validated against the terminology server.
const cc = (system: string, code: string, display?: string) => ({ coding: [{ system, code, ...(display ? { display } : {}) }] });
const qty = (value: number, code: string, unit: string) => ({ valueQuantity: { value, unit, system: SYS.ucum, code } });

function fact(id: string, date: string, code: any, value: any, extra: any = {}) {
  return add({
    resourceType: "Observation", id, meta: { profile: factProfile },
    status: "final", category: [extra.category || SURVEY], code,
    subject: ref("Patient", PT), effectiveDateTime: extra.effective || date,
    performer: [ref("Patient", PT)], ...value, device: ref("Device", DEV),
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

// --- IUD insertion event (the clinical context of this case) ---
add({
  resourceType: "Procedure", id: "iud-insertion", status: "completed",
  code: { coding: [{ system: SYS.sct, code: SCT.iudInsertion }], text: "Copper IUD insertion" },
  subject: ref("Patient", PT), performedDateTime: IUD_DATE,
  text: { status: "generated", div: `<div xmlns="http://www.w3.org/1999/xhtml"><p>Copper IUD inserted on ${IUD_DATE}.</p></div>` },
});

// --- per-day panels + facts (common core, standard codes) ---
const daily = buildDataset();
const panelIds: string[] = [];
const slug = (d: string) => d.replace(/-/g, "");
let factCount = 0;
let appNativeDay: string | null = null;

for (const d of daily) {
  const s = slug(d.date);
  const members: string[] = [];
  const mk = (id: string, code: any, value: any, extra: any = {}) => { fact(id, d.date, code, value, extra); members.push(id); factCount++; };

  if (d.isPeriod) mk(`status-${s}`, cc(SYS.loinc, LOINC.menstrualStatus, "Menstrual status - Reported"), { valueCodeableConcept: cc(SYS.sct, SCT.bleedingPresent) });
  if ((d.flow || 0) >= 1) mk(`flow-${s}`, cc(SYS.cycle, "menstrual-flow", "Patient-reported menstrual flow category"), { valueCodeableConcept: cc(SYS.cycle, FLOW_CODE_BY_LEVEL[d.flow]) });
  if ((d.pain || 0) > 0) mk(`pain-${s}`, cc(SYS.loinc, LOINC.painScore, "Pain severity - 0-10 verbal numeric rating [Score] - Reported"), qty(d.pain, "{score}", "{score}"));
  if (d.painTypes?.includes("dyspareunia")) mk(`dyspareunia-${s}`, cc(SYS.loinc, LOINC.symptom, "Symptom"), { valueCodeableConcept: cc(SYS.sct, SCT.dyspareunia) });
  if (d.symptoms) for (const sd of SYMPTOM_DEFS) {
    if (d.symptoms[sd.key] > 0) mk(`sym-${sd.key.toLowerCase()}-${s}`, cc(SYS.loinc, LOINC.symptom, "Symptom"), { valueCodeableConcept: cc(SYS.sct, sd.sct) });
  }
  if (d.bbt != null) mk(`bbt-${s}`, cc(SYS.loinc, LOINC.bodyTemp, "Body temperature"), qty(d.bbt, "Cel", "degree Celsius"),
    { category: VITALS, effective: `${d.date}T06:45:00-05:00`, method: cc(SYS.sct, SCT.basalTempMethod) });

  // one illustrative app-native fact (the documented escape hatch), on the first IMB day
  if (!appNativeDay && d.intermenstrual) {
    appNativeDay = d.date;
    mk(`custom-${s}`, cc(SYS.loinc, LOINC.symptom, "Symptom"), {
      valueCodeableConcept: { coding: [{ system: SYS.appExample, code: "pulling-sensation", display: "Pulling sensation", userSelected: true }], text: "Pulling sensation" },
    });
  }

  if (members.length === 0 && !d.note) continue; // not recorded -> no panel
  const panelId = `panel-${s}`;
  panelIds.push(panelId);
  add({
    resourceType: "Observation", id: panelId, meta: { profile: panelProfile },
    status: "final", category: [SURVEY], code: cc(SYS.cycle, "daily-tracking-panel", "Daily tracking panel"),
    subject: ref("Patient", PT), effectiveDateTime: d.date, performer: [ref("Patient", PT)], device: ref("Device", DEV),
    hasMember: members.map((m) => ref("Observation", m)),
    ...(d.note ? { note: [{ text: d.note }] } : {}),
    text: { status: "generated", div: `<div xmlns="http://www.w3.org/1999/xhtml"><p>Daily tracking panel for ${d.date} (${members.length} facts).</p></div>` },
  });
}

// --- Provenance ---
add({
  resourceType: "Provenance", id: "export-prov",
  target: [ref("Patient", PT), ref("Device", DEV), ...panelIds.map((id) => ref("Observation", id))],
  recorded: "2026-06-21T18:00:00-05:00",
  agent: [{ type: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/provenance-participant-type", code: "assembler", display: "Assembler" }] }, who: ref("Device", DEV) }],
  text: { status: "generated", div: `<div xmlns="http://www.w3.org/1999/xhtml"><p>Periodicity assembled ${panelIds.length} daily panels into the longitudinal export.</p></div>` },
});

// --- assemble the bundle ---
const bundle = {
  resourceType: "Bundle", id: "period-tracking-longitudinal-example",
  meta: { profile: [`${CANON}/StructureDefinition/period-tracking-bundle`] },
  identifier: { system: "https://example.org/period-tracking-export", value: "export-longitudinal-001" },
  type: "collection", timestamp: "2026-06-21T18:00:00-05:00",
  entry: entries.map((r) => ({ fullUrl: `${BASE}/${r.resourceType}/${r.id}`, resource: r })),
};

const out = `${import.meta.dir}/../input/resources/Bundle-period-tracking-longitudinal-example.json`;
await Bun.write(out, JSON.stringify(bundle, null, 2));
console.log(`wrote ${out}`);
console.log(`  entries=${entries.length} panels=${panelIds.length} facts=${factCount} appNativeDay=${appNativeDay}`);
