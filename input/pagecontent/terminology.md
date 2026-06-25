# Terminology

## Project CodeSystem

The MVP project CodeSystem contains exactly eight concepts:

| Code | Meaning |
|---|---|
| `menstrual-bleeding` | Boolean core fact: whether the source reports bleeding at the source date or timestamp. |
| `menstrual-flow` | Observation code for the app-style flow category. |
| `symptom` | Observation code for a symptom fact; the specific symptom is in `valueCodeableConcept`. |
| `flow-none` | Explicit no-flow selection. |
| `flow-spotting` | Spotting category. |
| `flow-light` | Light category. |
| `flow-moderate` | Middle or moderate category. |
| `flow-heavy` | Highest or heavy category. |

The bleeding, flow, and symptom concepts are intentionally project-defined while the IG is proving out the cross-app minimum. `menstrual-bleeding` is not a diagnosis and is not a statement that the bleeding was clinically adjudicated as menstruation. Consumer-app “heavy” does not necessarily mean measured heavy menstrual bleeding, profuse vaginal bleeding, or any particular blood-loss threshold.

## Standard terminology

This guide prefers exact terminology over coding density. It uses:

- project concepts for the cross-app core facts, MVP flow scale, and generic symptom fact code;
- LOINC for the question or observation name when the source meaning fits;
- SNOMED CT for clinical findings and answer concepts when the meaning is exact;
- stable app/project concepts or `CodeableConcept.text` when a standard term is only approximate; and
- UCUM for quantitative units.

The source package includes `scripts/verify-terminology.ts`, which checks referenced LOINC and SNOMED CT codes against supplied licensed LOINC and SNOMED CT releases. The committed validation report records the current source references and should be regenerated with local terminology files before publication.

## Common symptoms starter set

Because this guide recommends standard terminology only when the meaning is exact enough, it also publishes a small starter ValueSet, [Common Period-Tracking Symptoms](ValueSet-common-tracker-symptoms.html), that applications can bootstrap from so independent apps tend to pick the same code for the same symptom when that code really fits.

This ValueSet is **non-normative and open**: it is not a required or closed binding. A symptom fact MAY carry any SNOMED CT finding whose meaning is exact or use the app-native pattern below. Its purpose is consistency, not restriction. The worked longitudinal example draws several symptom findings from this set and also demonstrates app-native symptom values.

## App-native and user-defined terms

Applications with mutable or user-defined symptom dictionaries SHOULD use a stable source CodeSystem URL under the application's control. The exported Bundle MAY contain a CodeSystem resource describing the relevant codes.

A custom term SHALL NOT be added to the shared project CodeSystem merely because one user or one application created it. A custom or app-specific term can be represented with:

- a stable app-native code and display;
- `CodeableConcept.text`; or
- both.

## Concept maps

No ConceptMap is required by the MVP. Mapping work can proceed independently and can be published later without changing the granular exchange pattern. Implementers SHALL not treat an unpublished or approximate mapping as equivalence.

## Licensing

This implementation guide does not redistribute LOINC or SNOMED CT terminology content beyond the small set of referenced codes and displays. Implementers are responsible for complying with the applicable terminology licenses and edition requirements in their jurisdiction.
