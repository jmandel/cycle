# Scope and conformance principles

## Scope

This guide standardizes the smallest useful unit of exchange for menstrual period tracking: independently meaningful patient-generated facts scoped to one person and dated with `effectiveDateTime`.

It supports two conformance claims.

### Normalized MVP Export

A **Normalized MVP Export** SHALL:

- conform to the Period Tracking MVP Bundle profile;
- include at least one `cycle#menstrual-bleeding` Menstrual Bleeding Fact Observation;
- represent every selected or reliably source-represented bleeding state as a menstrual bleeding fact;
- represent every other selected, recognized optional layer as a concrete Period Tracking Fact Observation when this guide defines one, or as a base-compatible app-native fact when it does not;
- apply the missing-data rules below; and
- scope all included observations to the same person, whether or not a Patient resource is included.

### Complete MVP Export

A **Complete MVP Export** SHALL meet the Normalized MVP Export requirements and SHALL preserve every selected source datum that is not represented in the normalized layer. The recommended MVP mechanism is one `Binary` containing an exact, versioned native JSON snapshot.

The native archive is not a substitute for the normalized facts. It is an audit, migration, and future-remapping safety net.

## Universal core

The universal cross-app core is one independently meaningful fact per recorded source date or
timestamp: `cycle#menstrual-bleeding` with `valueBoolean`. `true` means the source reports bleeding
at that date or time. `false` means the source explicitly records no bleeding, or otherwise reliably
represents a user-verified no-bleeding state. Absence of this fact means not recorded or not
assessed.

## Granular-first requirement

An independently meaningful fact SHALL be a standalone Observation. Bleeding, flow intensity, cramps, pain severity, mood-like symptoms, and temperature are separate facts even when the source app stores them in one row or object.

Receivers can group normalized facts by the date portion of `effectiveDateTime` when they need a daily display row.

## Missingness

Implementers SHALL preserve these distinctions where the source supports them:

| Source state | MVP behavior |
|---|---|
| User entered or selected a value | Emit a fact Observation. |
| User explicitly selected “none” or “no” | Emit the corresponding explicit-negative fact, such as `menstrual-bleeding=false` or `flow-none`. |
| App created a row for another category and left this field at its default | Do not emit a negative fact. |
| Category was never opened or assessed | Do not emit a fact. |
| Source cannot distinguish default from explicit negative | Do not claim an explicit negative; retain the raw state in the native archive. |
| App prediction or inferred cycle state | Do not emit as a granular observed fact in the MVP. |

An empty day is not required. Absence of facts for a day means not recorded, not absent.

## Observation dates

Date-only source facts SHALL use `effectiveDateTime` at day precision, for example `"2026-05-14"`. Timed measurements SHOULD retain their source time and offset when known. Implementers SHALL NOT invent a time or timezone merely to create a full timestamp.

## Patient identity

The Patient resource is optional. Applications SHOULD share only identity fields selected or required for the intended clinical workflow. If a Patient resource or `Observation.subject` references are present, they SHOULD remain consistent with the Bundle's intended single-person scope. The viewer SHALL not assume that a Patient resource has been matched to an EHR patient.

## Source application

A Device resource is optional but recommended when the source application can identify itself without increasing risk. When present, the Device SHOULD include the application name and version used to generate the export, and facts MAY reference it through `Observation.device`.

## Predictions and summaries

Predictions and roll-up statistics are outside the required MVP exchange. The receiving viewer SHOULD calculate period episodes, cycle lengths, bleeding durations, medians, ranges, and coverage from the granular facts.

A future profile may carry precomputed summaries with `derivedFrom` references. Such summaries must never replace the granular inputs.
