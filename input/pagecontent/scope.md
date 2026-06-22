# Scope and conformance principles

## Scope

This guide standardizes the smallest useful unit of exchange for menstrual period tracking: independently meaningful patient-generated facts organized by source calendar date.

It supports two conformance claims.

### Normalized MVP Export

A **Normalized MVP Export** SHALL:

- conform to the Period Tracking MVP Bundle profile;
- include one Patient and at least one source-application Device;
- represent every selected, recognized core fact as a Period Tracking Fact Observation;
- group same-day facts in Daily Tracking Panel Observations;
- apply the missing-data rules below; and
- identify the transformation using at least one Provenance resource.

### Complete MVP Export

A **Complete MVP Export** SHALL meet the Normalized MVP Export requirements and SHALL preserve every selected source datum that is not represented in the normalized layer. The recommended MVP mechanism is one `Binary` containing an exact, versioned native JSON snapshot.

The native archive is not a substitute for the normalized facts. It is an audit, migration, and future-remapping safety net.

## Granular-first requirement

An independently meaningful fact SHALL be a standalone Observation. Flow, menstrual status, cramps, pain severity, mood, and temperature are separate facts even when the source app stores them in one row or object.

The daily panel SHALL use `Observation.hasMember` to group those facts. The MVP does not use `Observation.component` because the normalized facts are independently interpretable and may need to be searched, displayed, or summarized separately.

## Missingness

Implementers SHALL preserve these distinctions where the source supports them:

| Source state | MVP behavior |
|---|---|
| User entered or selected a value | Emit a fact Observation. |
| User explicitly selected “none” or “no” | Emit the corresponding explicit-negative fact. |
| App created a row for another category and left this field at its default | Do not emit a negative fact. |
| Category was never opened or assessed | Do not emit a fact. |
| Source cannot distinguish default from explicit negative | Do not claim an explicit negative; retain the raw state in the native archive. |
| App prediction or inferred cycle state | Do not emit as a granular observed fact in the MVP. |

An empty day is not required. A Daily Tracking Panel is created only for a date that has at least one exported fact or a shared diary note.

## Observation dates

Date-only source facts SHALL use `effectiveDateTime` at day precision, for example `"2026-05-14"`. Timed measurements SHOULD retain their source time and offset when known. Implementers SHALL NOT invent a time or timezone merely to create a full timestamp.

## Patient identity

The Patient may be minimally identified. Applications SHOULD share only identity fields selected or required for the intended clinical workflow. The viewer SHALL not assume that the Patient resource has been matched to an EHR patient.

## Source application

Each fact and daily panel SHALL reference a Device identifying the source application. The Device SHOULD include the application name and version used to generate the export.

## Predictions and summaries

Predictions and roll-up statistics are outside the required MVP exchange. The receiving viewer SHOULD calculate period episodes, cycle lengths, bleeding durations, medians, ranges, and coverage from the granular facts.

A future profile may carry precomputed summaries with `derivedFrom` references. Such summaries must never replace the granular inputs.
