/**
 * codes.mjs — terminology for the Period Tracking MVP *new* data model.
 *
 * The IG's point is a small common core plus optional layers:
 *   - bleeding is the universal boolean core (cycle#menstrual-bleeding)
 *   - flow is a coded optional intensity layer (cycle#flow-*)
 *   - pain is LOINC 72514-3, a 0-10 {score} Quantity
 *   - symptoms use cycle#symptom + an exact SNOMED or app-native value
 *   - basal body temperature is LOINC 8310-5 (a vital sign)
 * The worked example includes a single illustrative custom symptom reusing the
 * IG's existing example-app-symptoms CodeSystem.
 *
 * Used by generate-example.ts (write) and transform.mjs (read).
 */

export const SYS = {
  loinc: "http://loinc.org",
  sct: "http://snomed.info/sct",
  ucum: "http://unitsofmeasure.org",
  obsCat: "http://terminology.hl7.org/CodeSystem/observation-category",
  cycle: "https://cycle.fhir.me/CodeSystem/cycle",
  appExample: "https://example.org/fhir/CodeSystem/example-app-symptoms",
};

export const LOINC = {
  painScore: "72514-3",
  symptom: "75325-1",
  mood: "80296-7",
  bodyTemp: "8310-5",
};

export const SCT = {
  basalTempMethod: "281660007",
  iudInsertion: "65200003", // Insertion of intrauterine contraceptive device (procedure)
  dyspareunia: "71315007",
};

/* ----- flow: cycle CodeSystem coded values <-> ordinal 0-4 ----- */
export const FLOW_CODE_BY_LEVEL = ["flow-none", "flow-spotting", "flow-light", "flow-moderate", "flow-heavy"];
export const FLOW_LEVEL_BY_CODE = { "flow-none": 0, "flow-spotting": 1, "flow-light": 2, "flow-moderate": 3, "flow-heavy": 4 };

/* ----- premenstrual tracker symptoms -> exact SNOMED finding or app-native coding ----- */
export const SYMPTOM_DEFS = [
  { key: "irritability", sct: "55929007" },
  { key: "headache", sct: "25064002" },
  { key: "bloating", sct: "116289008" }, // Abdominal bloating (finding) — active
  { key: "fatigue", sct: "84229001" },
];
export const APP_SYMPTOM_DEFS = [
  { key: "lowMood", code: "low-mood", display: "Low mood" },
];
/* SNOMED finding (and the IG example's mood/stress) -> view-model symptom key */
export const FINDING_SYMPTOM_KEY = Object.fromEntries([
  ...SYMPTOM_DEFS.map((s) => [s.sct, s.key]),
  ["366979004", "lowMood"], // Depressed mood (finding), preferred starter concept when exact
  ["73595000", "lowMood"], // Stress (finding), used by the IG's own example
]);
/* app-native value code -> view-model symptom key */
export const APP_SYMPTOM_KEY = Object.fromEntries(APP_SYMPTOM_DEFS.map((s) => [s.code, s.key]));
/* SNOMED finding -> pain association the viewer recognises */
export const FINDING_PAINTYPE = { [SCT.dyspareunia]: "dyspareunia" };
