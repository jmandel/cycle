# Specification

## Adoption layers

This guide is designed for incremental adoption. Start with the bleeding calendar. Add richer facts only when the source app actually stores them. Only Layer 0 is required; everything above it is optional and is carried with the same granular pattern.

| Layer | Name | What it carries |
|---|---|---|
| **Layer&nbsp;0** | **Bleeding calendar** | **Required.** One boolean bleeding fact per recorded source date or timestamp: `cycle#menstrual-bleeding` with `valueBoolean`. See [the bleeding fact](#normalized-mapping-contract) for what `true`, `false`, and absence mean. |
| **Layer&nbsp;1** | **Richer facts** | Optional. Flow, symptoms, numeric or ordinal pain, basal body temperature, and other source-coded facts. Emit them only when the source app really has the data. |
| **Layer&nbsp;2** | **Native archive** | Optional. An exact, versioned source-data snapshot carried as a FHIR `Binary` for audit, migration, and future remapping. See [Native archive](#native-archive). It never replaces the normalized facts. |

A conforming export only has to do Layer 0. See [Scope and conformance principles](#scope-and-conformance-principles).

## Scope and conformance principles

### Scope

This guide standardizes small, patient-generated facts about one person's period-tracking data. Each fact is a standalone Observation dated with `effectiveDateTime`. All Observations in a Bundle describe the same person; a Patient resource MAY be included but is not required.

### Conformance

A conforming export SHALL:

- use the [Period Tracking Bundle](StructureDefinition-period-tracking-bundle.html) profile;
- include at least one Layer 0 `cycle#menstrual-bleeding` fact;
- emit a Layer 0 bleeding fact for every source date or timestamp that records bleeding or explicitly records no bleeding; and
- follow the [missing-data rules](#missingness).

That is the whole bar: mapping dates and bleeding status is fully conformant. Layer 1 facts and the Layer 2 native archive are optional. When an export does include a richer fact, it SHALL use the matching [fact profile](artifacts.html) from this guide, or the base Period Tracking Fact profile with an app-native code when none fits.

### Missingness

Do not turn missing data into "no." Implementers SHALL preserve these distinctions where the source supports them:

| Source state | Behavior |
|---|---|
| User entered or selected a value | Emit a fact Observation. |
| User explicitly selected "none" or "no" | Emit the corresponding explicit-negative fact, such as `menstrual-bleeding=false` or `flow-none`. |
| App created a row for another category and left this field at its default | Do not emit a negative fact. |
| Category was never opened or assessed | Do not emit a fact. |
| Source cannot distinguish default from explicit negative | Do not claim an explicit negative; retain the raw state in the native archive. |
| App prediction or inferred cycle state | Do not emit as an observed fact (see [Predictions and summaries](#predictions-and-summaries)). |

Absence of a fact for a day means not recorded or not assessed, never an implied negative. An empty day needs no resource.

### Observation dates

Date-only source facts SHALL use `effectiveDateTime` at day precision, for example `"2026-05-14"`. Timed measurements SHOULD retain their source time and offset when known. Implementers SHALL NOT invent a time or timezone merely to create a full timestamp.

### Patient identity

The Patient resource is optional. Applications SHOULD share only identity fields selected or required for the intended clinical workflow. If a Patient resource or `Observation.subject` references are present, they SHOULD remain consistent with the Bundle's single-person scope. The viewer SHALL NOT assume that a Patient resource has been matched to an EHR patient.

### Source application

A Device resource is optional but recommended when the source application can identify itself without increasing risk. When present, the Device SHOULD include the application name and version used to generate the export, and facts MAY reference it through `Observation.device`.

### Predictions and summaries

Predictions and roll-up statistics are out of scope for the exchange. The receiving viewer SHOULD calculate period episodes, cycle lengths, bleeding durations, medians, ranges, and coverage from the granular facts. A future profile may carry precomputed summaries with `derivedFrom` references; such summaries must never replace the granular inputs.

## Data model

### Bundle contents

{% capture model_diagram %}{% include model.svg %}{% endcapture %}
<div class="ptmvp-diagram">
{{ model_diagram | remove_first: '<?xml version="1.0" encoding="us-ascii" standalone="no"?>' }}
</div>

FHIR defines a Bundle as a container for a collection of resources. These exports use `Bundle.type = collection` because the Bundle is a transportable set of independently meaningful resources rather than an attested clinical document.

### Why standalone facts

The source applications use radically different persistence patterns: wide daily rows, nested daily documents, date-keyed state, normalized event tables, and sparse date-to-tag joins. A shared exchange model should not reproduce any one database design.

So every meaningful fact is a standalone Observation that can be interpreted, displayed, filtered, or summarized on its own — first the Layer 0 boolean bleeding core, then Layer 1 facts such as flow, symptoms, pain, and temperature. Bleeding, flow intensity, cramps, pain severity, mood-like symptoms, and temperature are separate facts even when the source app stores them in one row or object. There is no daily grouping Observation; receivers group facts by the local date portion of `effectiveDateTime` when they need a daily display row, while timed facts such as basal body temperature retain their source timestamp.

### Fact shape

The abstract Period Tracking Fact profile permits four result forms:

- `valueCodeableConcept` for flow, symptoms, and ordinal source-coded facts;
- `valueQuantity` for numeric pain and temperature;
- `valueBoolean` for a source fact that is inherently true/false; and
- `valueString` for a source result that cannot yet be represented more precisely.

The preferred approach for a coded-but-unmapped result is still `valueCodeableConcept`, using an app-native coding and `CodeableConcept.text`. FHIR specifically permits text-only coded results when no appropriate code is available. Concrete fact profiles narrow this base shape where producers and consumers need a predictable recipe: menstrual bleeding, menstrual flow, symptom, numeric pain severity, and basal body temperature.

### Native archive

The optional Layer 2 Binary SHOULD contain the exact selected native JSON after any app-level profile and date filtering but before clinical normalization. It SHOULD include:

- source application and version;
- database or schema version;
- timezone context where known;
- raw field names and values;
- stable source identifiers; and
- enough vocabulary metadata to interpret custom codes.

`Binary.securityContext` SHOULD reference the Patient when a Patient resource is included. The Binary SHALL be encrypted together with the rest of the Bundle when distributed through a SMART Health Link. The native archive is an audit, migration, and future-remapping safety net — never a substitute for the normalized facts.

## Normalized mapping contract

The first row is the universal interoperable core that every producer emits and every viewer understands: a Layer 0 boolean bleeding fact at the source date or timestamp. The remaining rows are optional Layer 1 facts that add intensity, symptoms, pain, or temperature when the source app has those data.

The Layer 0 bleeding fact uses `cycle#menstrual-bleeding` with `valueBoolean`:

- `true` means the source reports bleeding at that date or time;
- `false` means the source explicitly records no bleeding, or otherwise reliably represents a user-verified no-bleeding state; and
- no fact means not recorded or not assessed.

In this table, `cycle#...` means the project [Period Tracking Codes](CodeSystem-cycle.html) CodeSystem.

| Clinical fact | Observation.code | Result | Notes |
|---|---|---|---|
| Bleeding (Layer 0 core) | `cycle#menstrual-bleeding` | `valueBoolean` true or false | The universal bleeding fact, with the meaning given above. |
| Menstrual flow | `cycle#menstrual-flow` | One of the five flow codes | Optional Layer 1 intensity fact. Ordinal source category; never convert to mL or hemorrhage severity. |
| Symptom | `cycle#symptom` | `valueCodeableConcept`: preferred starter ValueSet concept when exact; otherwise app-native coding and/or text | Optional Layer 1 symptom fact. One Observation per selected symptom. Do not force a nearby SNOMED finding. |
| Numeric pain | LOINC `72514-3` - Pain severity 0-10 verbal numeric rating | Quantity using UCUM `{score}` | Optional Layer 1 numeric pain fact. Use only for a true 0-10 rating. |
| Ordinal pain | LOINC `38208-5` - Pain severity - Reported, or a stable app/project code | Standard qualifier or app-native coded value | Optional app-native Layer 1 fact. Do not turn "unbearable" into a 10/10 score or a near-match qualifier. |
| Basal body temperature | LOINC `8310-5` - Body temperature | UCUM temperature Quantity | Optional Layer 1 temperature fact. |
| Mood-like symptoms | `cycle#symptom` | Preferred symptom concept such as SNOMED CT depressed mood when exact; otherwise app-native coding/text | Optional Layer 1 symptom fact. Preserve the original source label. |

### Common symptom starter codes

The symptom profile has a preferred, non-closed starter ValueSet, [Common Period-Tracking Symptoms](ValueSet-common-tracker-symptoms.html). Implementers SHOULD use exact SNOMED CT concepts from it when they fit, but a stable app-native code is better than a close-but-wrong standard code. This ValueSet is **non-normative and open**: it is not a required or closed binding, and a symptom fact MAY carry any SNOMED CT finding whose meaning is exact, or use the app-native pattern in [Coding rules](#coding-rules). The worked longitudinal example draws several symptom findings from this set and also demonstrates app-native symptom values. The starter ValueSet currently contains:

{% sql
select
  json_extract(c.value, '$.display') as Meaning,
  case json_extract(inc.value, '$.system')
    when 'http://snomed.info/sct' then 'SNOMED CT'
    when 'http://loinc.org' then 'LOINC'
    else json_extract(inc.value, '$.system')
  end as System,
  json_extract(c.value, '$.code') as Code
from Resources r,
  json_each(r.Json, '$.compose.include') inc,
  json_each(inc.value, '$.concept') c
where r.Type = 'ValueSet'
  and r.Id = 'common-tracker-symptoms'
order by c.key
%}

Additional app symptoms may remain local until a mapping is reviewed, and some may remain local permanently if no standard concept preserves the source meaning.

### Flow normalization

Map a source application's ordinal flow categories to the closest project code whose definition preserves the source meaning:

{% sql
with flow_codes as (
  select json_extract(c.value, '$.code') as code, c.key as ord
  from Resources vs,
    json_each(vs.Json, '$.compose.include') inc,
    json_each(inc.value, '$.concept') c
  where vs.Type = 'ValueSet'
    and vs.Id = 'menstrual-flow'
)
select
  fc.code as "Project code",
  concepts.Display,
  concepts.Definition as Meaning
from flow_codes fc
left join Concepts concepts on concepts.Code = fc.code
order by fc.ord
%}

A source with multiple simultaneous or ambiguous flow tags SHOULD retain those raw tags in the native archive and SHOULD NOT silently choose one normalized value.

Flow does not replace the boolean bleeding core. A flow-capable app emits both facts when it has a source flow value: `flow-none` is consistent with `menstrual-bleeding=false`, while `flow-spotting`, `flow-light`, `flow-moderate`, and `flow-heavy` are consistent with `menstrual-bleeding=true`. A binary app can emit only `menstrual-bleeding`.

### Coding rules

When an app-native code and a standard code are truly equivalent in the export context, both MAY appear in the same `CodeableConcept`, and the source coding SHOULD set `userSelected = true` when it directly reflects the user's choice. When equivalence is uncertain, retain only the source coding and text; do not add a nearby standard concept merely to increase coding density.

The app name and version are carried in Device. A stable source row, object, or link identifier SHOULD be retained in `Observation.identifier`. No standard equivalence is implied merely because a local coding is carried in a FHIR resource.

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

### Notes and functional impact

Diary text is not a normalized fact. A complete export MAY preserve notes in the optional native archive. Implementers MAY emit source-coded facts for structured items such as missed work or sleep disruption, but viewers are not required to interpret them.

## Terminology

### Project CodeSystem

The project CodeSystem contains the following concepts:

{% sql
select
  Code,
  Display,
  Definition as Meaning
from Concepts
where ResourceKey = (
  select Key from Resources where Type = 'CodeSystem' and Id = 'cycle'
)
order by Key
%}

The bleeding, flow, and symptom concepts are intentionally project-defined while the IG is proving out the cross-app minimum. `menstrual-bleeding` is not a diagnosis and is not a statement that the bleeding was clinically adjudicated as menstruation. Consumer-app "heavy" does not necessarily mean measured heavy menstrual bleeding, profuse vaginal bleeding, or any particular blood-loss threshold.

### Standard terminology

This guide prefers exact terminology over coding density. It uses:

- project concepts for the core facts, flow scale, and generic symptom fact code;
- LOINC for the question or observation name when the source meaning fits;
- SNOMED CT for clinical findings and answer concepts when the meaning is exact;
- stable app/project concepts or `CodeableConcept.text` when a standard term is only approximate; and
- UCUM for quantitative units.

When a standard term is only approximate, prefer a stable app-native code over a close-but-wrong standard concept; see [Coding rules](#coding-rules). The starter symptom ValueSet, [Common Period-Tracking Symptoms](ValueSet-common-tracker-symptoms.html), is a **non-binding** convenience for picking consistent codes where they fit; it is described under [Common symptom starter codes](#common-symptom-starter-codes).

The source package includes `scripts/verify-terminology.ts`, which checks referenced LOINC and SNOMED CT codes against supplied licensed LOINC and SNOMED CT releases. The committed validation report records the current source references and should be regenerated with local terminology files before publication.

### App-native and user-defined terms

Applications with mutable or user-defined symptom dictionaries SHOULD use a stable source CodeSystem URL under the application's control. The exported Bundle MAY contain a CodeSystem resource describing the relevant codes.

A custom term SHALL NOT be added to the shared project CodeSystem merely because one user or one application created it. A custom or app-specific term can be represented with a stable app-native code and display, `CodeableConcept.text`, or both.

### Concept maps

No ConceptMap is required. Mapping work can proceed independently and can be published later without changing the granular exchange pattern. Implementers SHALL NOT treat an unpublished or approximate mapping as equivalence.

### Licensing

This implementation guide does not redistribute LOINC or SNOMED CT terminology content beyond the small set of referenced codes and displays. Implementers are responsible for complying with the applicable terminology licenses and edition requirements in their jurisdiction.
