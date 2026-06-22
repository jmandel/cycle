# FHIR mapping reference

The authoritative model is the IG. Open these alongside this file:

- Mapping contract: https://build.fhir.org/ig/jmandel/periodicity/mapping.html
- Scope & missing-data rules: https://build.fhir.org/ig/jmandel/periodicity/scope.html
- Terminology: https://build.fhir.org/ig/jmandel/periodicity/terminology.html
- Profiles (artifacts): https://build.fhir.org/ig/jmandel/periodicity/artifacts.html
- Worked Bundle (copy from this): `Bundle-period-tracking-bundle-example.json` and the richer `Bundle-period-tracking-longitudinal-example.json` under the IG base.

## Bundle shape

`period-tracking-bundle` is a FHIR R4 `collection` Bundle:

```
Bundle (type=collection; identifier 1..1; timestamp 1..1)
├── Patient            exactly 1 (minimally identified — share only what the workflow needs)
├── Device             ≥1, the source application (name + version)
├── Observation        daily-tracking-panel  ≥1   (one per calendar date with data)
│     └── hasMember → period-tracking-fact Observations for that day
├── Observation        period-tracking-fact  ≥1   (the granular facts)
├── Provenance         ≥1, describes who/what assembled the export
└── Binary             optional native-JSON snapshot (see "Complete export")
```

Each **fact** Observation: `status=final`; `category` = `survey` (or `vital-signs` for temperature); a question `code`; `subject` and `performer` = the Patient; `effectiveDateTime` (day precision for date-only facts, full timestamp when the source has one — never invent a time); `device` → the Device; and exactly one `value[x]` (`Quantity | CodeableConcept | string | boolean`). The MVP uses **`hasMember` grouping, never `Observation.component`**, because each fact must be independently searchable/displayable.

Code system URLs:
`http://loinc.org` · `http://snomed.info/sct` · `http://unitsofmeasure.org` · `http://terminology.hl7.org/CodeSystem/observation-category` · project: `https://fhir.me/cycle/CodeSystem/cycle`.

## Fact-by-fact mapping (common core)

| Fact | `code` | `value[x]` | Notes |
|---|---|---|---|
| Menstrual flow | `cycle#menstrual-flow` | `valueCodeableConcept` = `cycle#flow-none\|flow-spotting\|flow-light\|flow-moderate\|flow-heavy` | Ordinal *source* category. NEVER convert to mL. "heavy" = the app's top bucket, not clinical menorrhagia. |
| Menstrual status | LOINC `8678-5` | `valueCodeableConcept` = SNOMED `289894009` (bleeding present) or `289895005` (not currently menstruating) | The explicit "this is my period" / "not menstruating" assertion. Distinct from flow. |
| Pain, 0–10 | LOINC `72514-3` | `valueQuantity` `{ value, system: ucum, code: "{score}" }` | For a numeric scale. |
| Pain, ordinal | LOINC `38208-5` | `valueCodeableConcept` (e.g. SNOMED severity qualifier) | For apps with mild/moderate/severe, not 0–10. |
| Symptom | LOINC `75325-1` | `valueCodeableConcept` = a SNOMED finding, or an app-native coding/`text` | One Observation per symptom. Starter findings in the common-tracker-symptoms ValueSet. |
| Mood | LOINC `80296-7` | `valueCodeableConcept` = a SNOMED finding | Preserve the source mood label's meaning. |
| Basal body temperature | LOINC `8310-5` | `valueQuantity` `Cel` | `category` MUST be `vital-signs` (FHIR forces this for vital-sign codes). Add `method` SNOMED `281660007` (basal measurement). |
| Diary note | — (lives on the panel) | `Observation.note.text` on the `daily-tracking-panel` | Applies to the date unless a narrower context is given. |

Pain associations the viewer understands (e.g. dyspareunia) are expressed as their own symptom facts (e.g. LOINC `75325-1` + SNOMED `71315007` "Dyspareunia"). Intermenstrual / postcoital bleeding is just flow on a day without a period status — no special code.

## Terminology choices

- **Standard-code first.** Use LOINC for the question, SNOMED CT for findings/answers "when the meaning is exact," UCUM for units, and the project `cycle` CodeSystem for flow. The MVP is a *common core in standard codes*; keep app-specific coding to the minimum.
- **Symptom starter set.** The IG publishes a small, **non-binding** `common-tracker-symptoms` ValueSet (cramp `431416001`, headache `25064002`, fatigue `84229001`, abdominal bloating `116289008`, low mood `366979004`, irritability `24199005`, stress `73595000`, dyspareunia `71315007`). Bootstrap from it so independent apps pick the same code, but you MAY use any exact SNOMED finding.
- **App-native escape hatch.** For a genuinely app-specific symptom with no exact standard code, emit `LOINC 75325-1` with a coding from a *stable URL you control* (and/or `CodeableConcept.text`). Don't bend a standard code to fit. Don't pollute the project CodeSystem.

## Missing-data rules (do not skip)

From the IG `scope.md`:

| Source state | Emit |
|---|---|
| User entered/selected a value | the fact |
| User explicitly selected "none"/"no" | the explicit-negative fact (e.g. flow `flow-none`, status `289895005`) |
| App left a field at its default (not user intent) | nothing |
| Category never opened/assessed | nothing |
| Source can't tell default from explicit-negative | nothing normalized; keep the raw state in the native archive |
| App prediction / inferred cycle state | nothing (predictions are out of scope) |

A `daily-tracking-panel` is created only for a date with ≥1 exported fact or a shared note. An empty day is simply absent.

## Predictions and summaries are out of scope

Do not emit predicted periods, fertile windows, or roll-up statistics (cycle length, medians, "heavy days") as facts. The *receiver* computes those from the granular facts (the IG viewer does). A future profile may carry precomputed summaries with `derivedFrom`; until then, keep them out.

## Complete export (optional)

A *Normalized* export is just the facts. A *Complete* export additionally preserves every selected source datum not represented in the normalized layer — the recommended mechanism is one `Binary` holding an exact, versioned native-JSON snapshot, referenced from Provenance. It is an audit / migration / future-remapping safety net, never a substitute for the normalized facts.

## Build & validate

- Build the JSON with the app's own serializer (see the IG's `bun` generator `scripts/gen-example.ts` for a complete worked generator you can adapt).
- Validate against the profiles with the HL7 FHIR validator or by building the IG with your example added under `input/resources/`.
- Sanity-check the round trip by transforming your bundle with the reference transform (`viewer-src/transform.mjs`) — see `references/viewer.md`.
