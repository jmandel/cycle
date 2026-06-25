# Specification

## Adoption layers

This guide is designed for incremental adoption. Start with the bleeding calendar. Add richer facts only when the source app actually stores them.

| Layer | Name | Compatibility meaning |
|---|---|---|
| **Layer 0** | **Bleeding calendar** | Required. Each recorded date or timestamp says whether menstrual bleeding was present: `cycle#menstrual-bleeding` with `valueBoolean=true` or `false`. |
| **Layer 1** | **Optional structured facts** | Optional details such as flow, symptoms, numeric pain severity, and basal body temperature. Add them only when the source app really has the data. |
| **Layer 2** | **Native archive** | Optional exact source-data snapshot, carried as a FHIR `Binary`. This helps audit, migration, and future remapping. It does not replace Layer 0 or Layer 1. |

A **Normalized MVP Export** includes Layer 0 and may include Layer 1. A **Complete MVP Export** is a Normalized MVP Export plus Layer 2.

## Scope and conformance principles

### Scope

This guide standardizes small, patient-generated facts about one person's period tracking data. Each fact is dated with `effectiveDateTime`.

It supports two conformance claims.

### Normalized MVP Export

A **Normalized MVP Export** SHALL:

- use the Period Tracking MVP Bundle profile;
- include at least one Layer 0 bleeding fact;
- emit a Layer 0 bleeding fact for every date or timestamp where the source records bleeding or explicitly records no bleeding;
- add Layer 1 facts for selected flow, symptom, pain, and temperature data when the source has them;
- use the specific fact profile from this guide when one fits, otherwise use the base Period Tracking Fact profile with an app-native code; and
- follow the missing-data rules below.

All included Observations are about the same person. A Patient resource may be included, but it is not required.

### Complete MVP Export

A **Complete MVP Export** SHALL meet the Normalized MVP Export requirements and SHALL preserve every selected source datum that is not represented in Layer 0 or Layer 1. The recommended Layer 2 mechanism is one `Binary` containing an exact, versioned native JSON snapshot.

The native archive is not a substitute for the normalized facts. It is an audit, migration, and future-remapping safety net.

### Universal core

The universal cross-app core is the Layer 0 bleeding calendar: one fact per recorded source date or timestamp, using `cycle#menstrual-bleeding` with `valueBoolean`.

- `true` means the source reports bleeding at that date or time.
- `false` means the source explicitly records no bleeding, or otherwise reliably represents a user-verified no-bleeding state.
- No fact means not recorded or not assessed.

### Granular-first requirement

Each meaningful fact SHALL be a standalone Observation. Bleeding, flow intensity, cramps, pain severity, mood-like symptoms, and temperature are separate facts even when the source app stores them in one row or object.

Receivers can group normalized facts by the date portion of `effectiveDateTime` when they need a daily display row.

### Missingness

Do not turn missing data into "no." Implementers SHALL preserve these distinctions where the source supports them:

| Source state | MVP behavior |
|---|---|
| User entered or selected a value | Emit a fact Observation. |
| User explicitly selected "none" or "no" | Emit the corresponding explicit-negative fact, such as `menstrual-bleeding=false` or `flow-none`. |
| App created a row for another category and left this field at its default | Do not emit a negative fact. |
| Category was never opened or assessed | Do not emit a fact. |
| Source cannot distinguish default from explicit negative | Do not claim an explicit negative; retain the raw state in the native archive. |
| App prediction or inferred cycle state | Do not emit as a granular observed fact in the MVP. |

An empty day is not required. Absence of facts for a day means not recorded, not absent.

### Observation dates

Date-only source facts SHALL use `effectiveDateTime` at day precision, for example `"2026-05-14"`. Timed measurements SHOULD retain their source time and offset when known. Implementers SHALL NOT invent a time or timezone merely to create a full timestamp.

### Patient identity

The Patient resource is optional. Applications SHOULD share only identity fields selected or required for the intended clinical workflow. If a Patient resource or `Observation.subject` references are present, they SHOULD remain consistent with the Bundle's intended single-person scope. The viewer SHALL not assume that a Patient resource has been matched to an EHR patient.

### Source application

A Device resource is optional but recommended when the source application can identify itself without increasing risk. When present, the Device SHOULD include the application name and version used to generate the export, and facts MAY reference it through `Observation.device`.

### Predictions and summaries

Predictions and roll-up statistics are outside the required MVP exchange. The receiving viewer SHOULD calculate period episodes, cycle lengths, bleeding durations, medians, ranges, and coverage from the granular facts.

A future profile may carry precomputed summaries with `derivedFrom` references. Such summaries must never replace the granular inputs.

## Data model

### Resource graph

{% capture model_diagram %}{% include model.svg %}{% endcapture %}
<div class="ptmvp-diagram">
{{ model_diagram | remove_first: '<?xml version="1.0" encoding="us-ascii" standalone="no"?>' }}
</div>

FHIR defines a Bundle as a container for a collection of resources. The MVP uses `Bundle.type = collection` because it is a transportable set of independently meaningful resources rather than an attested clinical document.

### Why standalone facts

The source applications use radically different persistence patterns: wide daily rows, nested daily documents, date-keyed state, normalized event tables, and sparse date-to-tag joins. A shared exchange model should not reproduce any one database design.

A standalone Observation is used when a fact can be interpreted, displayed, filtered, or summarized on its own. This applies first to the Layer 0 boolean bleeding core, and then to Layer 1 facts such as flow, symptoms, pain, and temperature.

The MVP does not define a daily grouping Observation. Receivers can group facts by the local date portion of `effectiveDateTime` for visualization, while timed facts such as basal body temperature can retain their source timestamp.

### Fact shape

The abstract Period Tracking Fact Observation permits four result forms:

- `valueCodeableConcept` for flow, symptoms, and ordinal source-coded facts;
- `valueQuantity` for numeric pain and temperature;
- `valueBoolean` for a source fact that is inherently true/false; and
- `valueString` for a source result that cannot yet be represented more precisely.

The preferred approach for a coded-but-unmapped result is still `valueCodeableConcept`, using an app-native coding and `CodeableConcept.text`. FHIR specifically permits text-only coded results when no appropriate code is available.

Concrete MVP fact profiles narrow the base shape where producers and consumers need a predictable recipe: menstrual bleeding, menstrual flow, symptom, numeric pain severity, and basal body temperature.

### Source identity and fidelity

The app name and version are carried in Device. A source row, object, or link identifier SHOULD be retained in `Observation.identifier` when stable. App-native codes MAY appear alongside standard codes in one CodeableConcept.

Example:

```json
{
  "code": {
    "coding": [{
      "system": "http://loinc.org",
      "code": "75325-1",
      "display": "Symptom"
    }]
  },
  "valueCodeableConcept": {
    "coding": [{
      "system": "https://example.org/fhir/CodeSystem/my-app-symptoms",
      "code": "97",
      "display": "Pulling sensation",
      "userSelected": true
    }],
    "text": "Pulling sensation"
  }
}
```

No standard equivalence is implied merely because a local coding is carried in a FHIR resource.

### Native archive

The optional Layer 2 Binary SHOULD contain the exact selected native JSON after any app-level profile and date filtering but before clinical normalization. It SHOULD include:

- source application and version;
- database or schema version;
- timezone context where known;
- raw field names and values;
- stable source identifiers; and
- enough vocabulary metadata to interpret custom codes.

`Binary.securityContext` SHOULD reference the Patient when a Patient resource is included. The Binary SHALL be encrypted together with the rest of the Bundle when distributed through a SMART Health Link.

## Normalized mapping contract

The first row is the universal interoperable core that MVP producers emit and MVP viewers understand: a Layer 0 boolean bleeding fact at the source date or timestamp. The remaining rows are optional Layer 1 facts that add intensity, symptoms, pain, or temperature when the source app has those data.

In this table, `cycle#...` means the project [Period Tracking MVP Codes](CodeSystem-cycle.html) CodeSystem.

| Clinical fact | Observation.code | Result | Notes |
|---|---|---|---|
| Bleeding (Layer 0 core) | `cycle#menstrual-bleeding` | `valueBoolean` true or false | The universal bleeding fact. Emit `false` only when the source explicitly records no bleeding or otherwise reliably represents a user-verified no-bleeding state. |
| Menstrual flow | `cycle#menstrual-flow` | One of the five MVP flow codes | Optional Layer 1 intensity fact. Ordinal source category; never convert to mL or hemorrhage severity. |
| Symptom | `cycle#symptom` | `valueCodeableConcept`: preferred starter ValueSet concept when exact; otherwise app-native coding and/or text | Optional Layer 1 symptom fact. One Observation per selected symptom. Do not force a nearby SNOMED finding. |
| Numeric pain | LOINC `72514-3` - Pain severity 0-10 verbal numeric rating | Quantity using UCUM `{score}` | Optional Layer 1 numeric pain fact. Use only for a true 0-10 rating. |
| Ordinal pain | LOINC `38208-5` - Pain severity - Reported, or a stable app/project code | Standard qualifier or app-native coded value | Optional app-native Layer 1 fact. Do not turn "unbearable" into a 10/10 score or a near-match qualifier. |
| Basal body temperature | LOINC `8310-5` - Body temperature | UCUM temperature Quantity | Optional Layer 1 temperature fact. Add SNOMED CT `281660007` as method when the source establishes basal measurement. |
| Mood-like symptoms | `cycle#symptom` | Preferred symptom concept such as SNOMED CT depressed mood when exact; otherwise app-native coding/text | Optional Layer 1 symptom fact. Preserve the original source label. |

### Standard symptom examples

The symptom profile has a preferred, non-closed starter ValueSet. Implementers SHOULD use exact SNOMED CT concepts from that set when they fit, but a stable app-native code is better than a close-but-wrong standard code. Examples verified in the terminology releases used for this draft include:

| Source meaning | Preferred coding |
|---|---|
| Menstrual cramp | `431416001` - Menstrual cramp (finding) |
| Headache | `25064002` - Headache (finding) |
| Depressed mood | `366979004` - Depressed mood (finding), only when the source meaning is exact |
| Stress | `73595000` - Stress (finding) |

Additional app symptoms may remain local until a mapping is reviewed, and some may remain local permanently if no standard concept preserves the source meaning.

### Multiple codings

When an app-native code and a standard code are truly equivalent in the export context, both MAY appear in the same `CodeableConcept`. The source coding SHOULD set `userSelected = true` when it directly reflects the user's choice.

When equivalence is uncertain, retain only the source coding and text. Do not add a nearby standard concept merely to increase coding density.

### Flow normalization

Map a source application's ordinal flow categories to the project codes as follows:

| Source label | MVP code |
|---|---|
| no flow / none, explicitly selected | `flow-none` |
| spotting | `flow-spotting` |
| light | `flow-light` |
| medium / moderate | `flow-moderate` |
| heavy | `flow-heavy` |

A source with multiple simultaneous or ambiguous flow tags SHOULD retain those raw tags in the native archive and SHOULD NOT silently choose one normalized value.

Flow does not replace the boolean bleeding core. A flow-capable app emits both facts when it has a source flow value: `flow-none` is consistent with `menstrual-bleeding=false`, while `flow-spotting`, `flow-light`, `flow-moderate`, and `flow-heavy` are consistent with `menstrual-bleeding=true`. A binary app can emit only `menstrual-bleeding`.

### Notes and functional impact

Diary text is not a normalized MVP fact. A complete export MAY preserve notes in the optional native archive. Implementers MAY emit source-coded facts for structured items such as missed work or sleep disruption, but MVP viewers are not required to interpret them.

## Terminology

### Project CodeSystem

The MVP project CodeSystem contains exactly eight concepts:

| Code | Meaning |
|---|---|
| `menstrual-bleeding` | Layer 0 boolean core fact: whether the source reports bleeding at the source date or timestamp. |
| `menstrual-flow` | Observation code for the app-style flow category. |
| `symptom` | Observation code for a symptom fact; the specific symptom is in `valueCodeableConcept`. |
| `flow-none` | Explicit no-flow selection. |
| `flow-spotting` | Spotting category. |
| `flow-light` | Light category. |
| `flow-moderate` | Middle or moderate category. |
| `flow-heavy` | Highest or heavy category. |

The bleeding, flow, and symptom concepts are intentionally project-defined while the IG is proving out the cross-app minimum. `menstrual-bleeding` is not a diagnosis and is not a statement that the bleeding was clinically adjudicated as menstruation. Consumer-app "heavy" does not necessarily mean measured heavy menstrual bleeding, profuse vaginal bleeding, or any particular blood-loss threshold.

### Standard terminology

This guide prefers exact terminology over coding density. It uses:

- project concepts for the cross-app core facts, MVP flow scale, and generic symptom fact code;
- LOINC for the question or observation name when the source meaning fits;
- SNOMED CT for clinical findings and answer concepts when the meaning is exact;
- stable app/project concepts or `CodeableConcept.text` when a standard term is only approximate; and
- UCUM for quantitative units.

The source package includes `scripts/verify-terminology.ts`, which checks referenced LOINC and SNOMED CT codes against supplied licensed LOINC and SNOMED CT releases. The committed validation report records the current source references and should be regenerated with local terminology files before publication.

### Common symptoms starter set

Because this guide recommends standard terminology only when the meaning is exact enough, it also publishes a small starter ValueSet, [Common Period-Tracking Symptoms](ValueSet-common-tracker-symptoms.html), that applications can bootstrap from so independent apps tend to pick the same code for the same symptom when that code really fits.

This ValueSet is **non-normative and open**: it is not a required or closed binding. A symptom fact MAY carry any SNOMED CT finding whose meaning is exact or use the app-native pattern below. Its purpose is consistency, not restriction. The worked longitudinal example draws several symptom findings from this set and also demonstrates app-native symptom values.

### App-native and user-defined terms

Applications with mutable or user-defined symptom dictionaries SHOULD use a stable source CodeSystem URL under the application's control. The exported Bundle MAY contain a CodeSystem resource describing the relevant codes.

A custom term SHALL NOT be added to the shared project CodeSystem merely because one user or one application created it. A custom or app-specific term can be represented with:

- a stable app-native code and display;
- `CodeableConcept.text`; or
- both.

### Concept maps

No ConceptMap is required by the MVP. Mapping work can proceed independently and can be published later without changing the granular exchange pattern. Implementers SHALL not treat an unpublished or approximate mapping as equivalence.

### Licensing

This implementation guide does not redistribute LOINC or SNOMED CT terminology content beyond the small set of referenced codes and displays. Implementers are responsible for complying with the applicable terminology licenses and edition requirements in their jurisdiction.
