# FHIR mapping reference

The authoritative model is the IG. Open these alongside this file:

- Mapping contract: https://cycle.fhir.me/mapping.html
- Scope & missing-data rules: https://cycle.fhir.me/scope.html
- Terminology: https://cycle.fhir.me/terminology.html
- Profiles (artifacts): https://cycle.fhir.me/artifacts.html
- Worked Bundle: `Bundle-period-tracking-longitudinal-example.json`, generated during the IG/site build and published with the rendered artifacts.

## Bundle shape

`period-tracking-bundle` is a FHIR R4 `collection` Bundle:

```
Bundle (type=collection; one-person scope)
├── Patient            optional
├── Device             optional source application (name + version)
├── Observation        menstrual-bleeding-fact ≥1
├── Observation        other concrete fact profiles as available
└── Binary             optional native-JSON snapshot (see "Complete export")
```

Each **fact** Observation: `status=final`; a `code`; `effectiveDateTime` (day precision for date-only facts, full timestamp when the source has one — never invent a time); optional `subject`; optional `device`; and exactly one `value[x]` (`Quantity | CodeableConcept | string | boolean`). The Bundle is intended to describe one person's period-tracking data even when no Patient reference is populated. The MVP uses independently meaningful facts; group by the date portion of `effectiveDateTime` in the viewer/client when you need daily rows.

Code system URLs:
`http://loinc.org` · `http://snomed.info/sct` · `http://unitsofmeasure.org` · `http://terminology.hl7.org/CodeSystem/observation-category` · project: `https://cycle.fhir.me/CodeSystem/cycle`.

## Fact-by-fact mapping

| Fact | `code` | `value[x]` | Notes |
|---|---|---|---|
| Bleeding (core) | `cycle#menstrual-bleeding` | `valueBoolean` = `true` or `false` | The universal bleeding fact. Emit this even when flow is present. Emit `false` only when the source explicitly records no bleeding or reliably represents user-verified no bleeding. |
| Flow intensity | `cycle#menstrual-flow` | `valueCodeableConcept` = `cycle#flow-none\|flow-spotting\|flow-light\|flow-moderate\|flow-heavy` | Optional ordinal *source* category. NEVER convert to mL. "heavy" = the app's top bucket, not clinical menorrhagia. |
| Pain, 0–10 | LOINC `72514-3` | `valueQuantity` `{ value, system: ucum, code: "{score}" }` | For a numeric scale. |
| Pain, ordinal | LOINC `38208-5`, or a stable app/project code | `valueCodeableConcept` (exact standard qualifier or app-native value) | For apps with mild/moderate/severe, not 0–10. Do not use a close-but-wrong qualifier. |
| Symptom | `cycle#symptom` | `valueCodeableConcept` = a SNOMED finding or app-native coding/`text` | One Observation per symptom. Starter concepts in the common-tracker-symptoms ValueSet only when exact. |
| Mood-like symptom | `cycle#symptom` | `valueCodeableConcept` = exact preferred concept such as SNOMED depressed mood, otherwise app-native value | Preserve the source mood label's meaning. |
| Basal body temperature | LOINC `8310-5` | `valueQuantity` `Cel` | `category` MUST be `vital-signs` (FHIR forces this for vital-sign codes). Add `method` SNOMED `281660007` (basal measurement). |

Pain associations the viewer understands (e.g. dyspareunia) are expressed as their own symptom facts (e.g. `cycle#symptom` + SNOMED `71315007` "Dyspareunia"). Intermenstrual / postcoital bleeding can be inferred by a receiver from bleeding timing and optional source context; it is not a separate required core code.

## Terminology choices

- **Core first.** Use `cycle#menstrual-bleeding` for the universal boolean bleeding fact. Use the project `cycle` CodeSystem for flow, UCUM for units, and LOINC/SNOMED CT only when they exactly preserve the source meaning.
- **Symptom starter set.** The IG publishes a small, **non-binding** `common-tracker-symptoms` ValueSet (cramp `431416001`, headache `25064002`, fatigue `84229001`, abdominal bloating `116289008`, depressed mood `366979004`, irritability `55929007`, stress `73595000`, dyspareunia `71315007`). Bootstrap from it where exact, but a stable app-native code is preferable to a close-but-wrong standard concept.
- **App-native and project concepts.** For app-specific or unmapped facts, emit a coding from a *stable URL you control* (and/or `CodeableConcept.text`). Don't bend a standard code to fit. Add concepts to the shared project CodeSystem only for meanings this IG intentionally standardizes across apps.

## Missing-data rules (do not skip)

From the IG `scope.md`:

| Source state | Emit |
|---|---|
| User entered/selected a value | the fact |
| User explicitly selected "none"/"no" | the explicit-negative fact (e.g. `menstrual-bleeding=false`, and `flow-none` if the source also records flow) |
| App left a field at its default (not user intent) | nothing |
| Category never opened/assessed | nothing |
| Source can't tell default from explicit-negative | nothing normalized; keep the raw state in the native archive |
| App prediction / inferred cycle state | nothing (predictions are out of scope) |

An empty day is simply absent. Do not create grouping resources for empty days.

## Predictions and summaries are out of scope

Do not emit predicted periods, fertile windows, or roll-up statistics (cycle length, medians, "heavy days") as facts. The *receiver* computes those from the granular facts (the IG viewer does). A future profile may carry precomputed summaries with `derivedFrom`; until then, keep them out.

## Complete export (optional)

A *Normalized* export is just the facts. A *Complete* export additionally preserves every selected source datum not represented in the normalized layer — the recommended mechanism is one `Binary` holding an exact, versioned native-JSON snapshot. It is an audit / migration / future-remapping safety net, never a substitute for the normalized facts.

## Build & validate

- Build the JSON with the app's own serializer (see the IG's `bun` generator `scripts/gen-example.ts` for a complete worked generator you can adapt).
- Validate against the profiles with the HL7 FHIR validator or by building the IG with your example added under `input/resources/`.
- Sanity-check the round trip by transforming your bundle with the reference transform (`viewer-src/transform.mjs`) — see `references/viewer.md`.
