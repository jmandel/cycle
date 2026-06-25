# FHIR mapping reference

The authoritative model is the IG. Open these alongside this file:

- [Specification](specification.html)
- [Mapping contract](specification.html#normalized-mapping-contract)
- [Scope and missing-data rules](specification.html#scope-and-conformance-principles)
- [Terminology](specification.html#terminology)
- [Profiles and artifacts](artifacts.html)
- [Worked Bundle](Bundle-period-tracking-longitudinal-example.html), generated during the IG/site build and published with the rendered artifacts.

## Bundle shape

`period-tracking-bundle` is a FHIR R4 `collection` Bundle:

```
Bundle (type=collection; one-person scope)
├── Patient            optional
├── Device             optional source application (name + version)
├── Observation        menstrual-bleeding ≥1
├── Observation        other concrete fact profiles as available
└── Binary             optional native-JSON snapshot (see "Complete export")
```

Each **fact** Observation has:

- `status=final`;
- a `code`;
- `effectiveDateTime`, using day precision for date-only facts and a full timestamp when the source has one;
- optional `subject`;
- optional `device`; and
- exactly one `value[x]`.

Supported result forms are `Quantity`, `CodeableConcept`, `string`, and `boolean`. Never invent a time merely to create a full timestamp. The Bundle is intended to describe one person's period-tracking data even when no Patient reference is populated. This guide uses independently meaningful facts; group by the date portion of `effectiveDateTime` in the viewer/client when you need daily rows.

Code system URLs:

| Prefix | System |
|---|---|
| LOINC | `http://loinc.org` |
| SNOMED CT | `http://snomed.info/sct` |
| UCUM | `http://unitsofmeasure.org` |
| Observation category | `http://terminology.hl7.org/CodeSystem/observation-category` |
| `cycle` | `https://cycle.fhir.me/CodeSystem/cycle` |

## Fact-by-fact mapping

### Layer 0: required core

Every export emits the Layer 0 bleeding facts it can represent.

#### Bleeding

- Code: `cycle#menstrual-bleeding`
- Value: `valueBoolean` = `true` or `false`
- Emit this boolean even when a flow-intensity fact is also present.
- Emit `false` only when the source explicitly records no bleeding or reliably represents user-verified no bleeding.
- Absence of a bleeding fact means not recorded or not assessed, not "false."

### Layer 1: optional structured facts

Emit Layer 1 facts only when the source data supports them. These facts add detail without replacing the Layer 0 bleeding core.

#### Flow intensity

- Code: `cycle#menstrual-flow`
- Value: `valueCodeableConcept`
- Allowed values: `cycle#flow-none`, `cycle#flow-spotting`, `cycle#flow-light`, `cycle#flow-moderate`, `cycle#flow-heavy`
- Treat flow as an ordinal source-app category. Do not convert it to mL.
- `flow-heavy` means the app's top bucket, not clinical menorrhagia.

#### Symptoms

- Code: `cycle#symptom`
- Value: `valueCodeableConcept`
- Emit one Observation per symptom.
- Use a SNOMED CT finding when the meaning is exact, or use a stable app-native coding and/or `CodeableConcept.text` when it is not.
- The common-tracker-symptoms ValueSet is a starter set, not a closed or required binding.

#### Mood-like symptom labels

- Code: `cycle#symptom`
- Value: `valueCodeableConcept`
- Preserve the source mood label's meaning.
- Use a preferred concept such as SNOMED CT depressed mood only when exact; otherwise keep an app-native value.

#### Pain

Numeric 0-10 pain:

- Code: LOINC `72514-3`
- Value: `valueQuantity`
- Use only when the source really stores a numeric 0-10 rating.

```json
{
  "value": 6,
  "system": "http://unitsofmeasure.org",
  "code": "{score}"
}
```

Ordinal pain:

- Code: LOINC `38208-5`, or a stable app/project code when the LOINC meaning is not exact
- Value: `valueCodeableConcept`
- Use for source labels such as mild, moderate, or severe.
- Do not map ordinal labels to a close-but-wrong numeric or qualifier code.

Pain associations the viewer understands, such as dyspareunia, are expressed as their own symptom facts. For example: `cycle#symptom` plus SNOMED CT `71315007` "Dyspareunia."

#### Basal body temperature

- Code: LOINC `8310-5`
- Value: `valueQuantity` using UCUM `Cel`
- Category: `vital-signs` because FHIR requires vital-sign category behavior for vital-sign codes.

Intermenstrual or postcoital bleeding can be inferred by a receiver from bleeding timing and optional source context. They are not separate required core codes.

## Terminology choices

- **Core first.** Use `cycle#menstrual-bleeding` for the universal boolean bleeding fact. Use the project `cycle` CodeSystem for flow, UCUM for units, and LOINC/SNOMED CT only when they exactly preserve the source meaning.
- **Symptom starter set.** The IG publishes a small, **non-binding** `common-tracker-symptoms` ValueSet (cramp `431416001`, headache `25064002`, fatigue `84229001`, abdominal bloating `116289008`, depressed mood `366979004`, irritability `55929007`, stress `73595000`, dyspareunia `71315007`). Bootstrap from it where exact, but a stable app-native code is preferable to a close-but-wrong standard concept.
- **App-native and project concepts.** For app-specific or unmapped facts, emit a coding from a *stable URL you control* (and/or `CodeableConcept.text`). Don't bend a standard code to fit. Add concepts to the shared project CodeSystem only for meanings this IG intentionally standardizes across apps.

## Missing-data rules (do not skip)

From the [Specification](specification.html#missingness):

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

An export may optionally preserve every selected source datum not represented in the normalized facts. The recommended Layer 2 mechanism is one `Binary` holding an exact, versioned native-JSON snapshot. It is an audit / migration / future-remapping safety net, never a substitute for the normalized facts.

## Build & validate

- Build the JSON with the app's own serializer (see the IG's `bun` generator `scripts/gen-example.ts` for a complete worked generator you can adapt).
- Validate against the profiles with the HL7 FHIR validator or by building the IG with your example added under `input/resources/`.
- Sanity-check the round trip by transforming your bundle with the reference transform (`viewer-src/transform.mjs`) — see [Viewer integration](viewer-integration.html).
