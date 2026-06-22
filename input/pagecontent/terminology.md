# Terminology

## Project CodeSystem

The MVP project CodeSystem contains exactly seven concepts:

| Code | Meaning |
|---|---|
| `daily-tracking-panel` | Groups facts associated with one source calendar date. |
| `menstrual-flow` | Observation code for the app-style flow category. |
| `flow-none` | Explicit no-flow selection. |
| `flow-spotting` | Spotting category. |
| `flow-light` | Light category. |
| `flow-moderate` | Middle or moderate category. |
| `flow-heavy` | Highest or heavy category. |

The flow values are intentionally project-defined. Consumer-app “heavy” does not necessarily mean measured heavy menstrual bleeding, profuse vaginal bleeding, or any particular blood-loss threshold.

## Standard terminology

This guide uses:

- LOINC for the question or observation name;
- SNOMED CT for clinical findings and answer concepts when the meaning is exact; and
- UCUM for quantitative units.

The initial code set was checked against LOINC 2.77 and the supplied SNOMED CT 2023-09-01 distribution. The validation report is included with the source package.

## Common symptoms starter set

Because this guide recommends SNOMED CT findings for symptoms "when the meaning is exact," it also publishes a small starter ValueSet, [Common Period-Tracking Symptoms](ValueSet-common-tracker-symptoms.html), that applications can bootstrap from so independent apps tend to pick the same code for the same symptom.

This ValueSet is **non-normative and open**: it is not a required or closed binding. A symptom fact MAY carry any SNOMED CT finding whose meaning is exact, or fall back to the app-native escape hatch below. Its purpose is consistency, not restriction. The worked longitudinal example draws its symptom findings from this set.

## App-native and user-defined terms

Applications with mutable or user-defined symptom dictionaries SHOULD use a stable source CodeSystem URL under the application's control. The exported Bundle MAY contain a CodeSystem resource describing the relevant codes.

A custom term SHALL NOT be added to the shared project CodeSystem merely because one user or one application created it. A custom term can be represented with:

- a stable app-native code and display;
- `CodeableConcept.text`; or
- both.

## Concept maps

No ConceptMap is required by the MVP. Mapping work can proceed independently and can be published later without changing the granular exchange pattern. Implementers SHALL not treat an unpublished or approximate mapping as equivalence.

## Licensing

This implementation guide does not redistribute LOINC or SNOMED CT terminology content beyond the small set of referenced codes and displays. Implementers are responsible for complying with the applicable terminology licenses and edition requirements in their jurisdiction.
