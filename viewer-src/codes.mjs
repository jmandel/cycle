/**
 * codes.mjs — terminology for the Period Tracking MVP *new* data model.
 *
 * The IG's point is a small COMMON CORE expressed in standard codes, so almost
 * everything here is LOINC / SNOMED / the IG's own cycle CodeSystem:
 *   - flow is a coded value (cycle#flow-*)
 *   - menstrual status is LOINC 8678-5 with a SNOMED present/absent finding
 *   - pain is LOINC 72514-3, a 0-10 {score} Quantity
 *   - symptoms are LOINC 75325-1 "Symptom" + a SNOMED finding (presence)
 *   - basal body temperature is LOINC 8310-5 (a vital sign)
 * The only app-native datum is a single illustrative custom symptom reusing the
 * IG's existing example-app-symptoms CodeSystem (the documented escape hatch).
 *
 * Used by generate-example.ts (write) and transform.mjs (read).
 */

export const SYS = {
  loinc: "http://loinc.org",
  sct: "http://snomed.info/sct",
  ucum: "http://unitsofmeasure.org",
  obsCat: "http://terminology.hl7.org/CodeSystem/observation-category",
  cycle: "https://fhir.me/cycle/CodeSystem/cycle",
  appExample: "https://example.org/fhir/CodeSystem/example-app-symptoms",
};

export const LOINC = {
  menstrualStatus: "8678-5",
  painScore: "72514-3",
  symptom: "75325-1",
  mood: "80296-7",
  bodyTemp: "8310-5",
};

export const SCT = {
  bleedingPresent: "289894009",
  notMenstruating: "289895005",
  basalTempMethod: "281660007",
  iudInsertion: "65200003", // Insertion of intrauterine contraceptive device (procedure)
  dyspareunia: "71315007",
};

/* ----- flow: cycle CodeSystem coded values <-> ordinal 0-4 ----- */
export const FLOW_CODE_BY_LEVEL = ["flow-none", "flow-spotting", "flow-light", "flow-moderate", "flow-heavy"];
export const FLOW_LEVEL_BY_CODE = { "flow-none": 0, "flow-spotting": 1, "flow-light": 2, "flow-moderate": 3, "flow-heavy": 4 };

/* ----- premenstrual tracker symptoms -> SNOMED finding (LOINC 75325-1) ----- */
export const SYMPTOM_DEFS = [
  { key: "irritability", sct: "24199005" },
  { key: "lowMood", sct: "366979004" },
  { key: "headache", sct: "25064002" },
  { key: "bloating", sct: "116289008" }, // Abdominal bloating (finding) — active
  { key: "fatigue", sct: "84229001" },
];
/* SNOMED finding (and the IG example's mood/stress) -> view-model symptom key */
export const FINDING_SYMPTOM_KEY = Object.fromEntries([
  ...SYMPTOM_DEFS.map((s) => [s.sct, s.key]),
  ["73595000", "lowMood"], // Stress (finding), used by the IG's own example
]);
/* SNOMED finding -> pain association the viewer recognises */
export const FINDING_PAINTYPE = { [SCT.dyspareunia]: "dyspareunia" };
