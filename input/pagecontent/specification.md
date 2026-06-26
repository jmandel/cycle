# Specification

## Use case

Period-tracking apps store menstrual and cycle observations in many different ways: daily rows, sparse date maps, nested documents, event tables, custom symptom dictionaries, and app-specific flow scales. Clinicians, meanwhile, need a small, trustworthy picture of what the user actually recorded: dates, bleeding yes/no, and optional details such as flow, pain, symptoms, and basal body temperature.

This guide defines a minimal FHIR R4 payload for that handoff. A producing app exports one person's patient-generated facts into a FHIR Bundle, encrypts that Bundle into a SMART Health Link, and a receiving viewer or scanner decrypts it locally and derives the display from the granular facts. The guide does not define a diagnosis, a menstrual-health score, an EHR import policy, or a required viewer UI.

## Adoption layers

Start with the bleeding calendar. Add richer facts only when the source app actually stores them.

| Layer | Name | What it means |
|---|---|---|
| **Layer&nbsp;0** | **Bleeding calendar** | Required. One boolean bleeding fact per source date or timestamp the app can represent: `cycle#menstrual-bleeding` with `valueBoolean=true` or `false`. |
| **Layer&nbsp;1** | **Structured facts** | Optional. Flow, symptoms, numeric pain severity, basal body temperature, and other source-coded observations. These add detail but never replace Layer 0. |
| **Layer&nbsp;2** | **Native archive** | Optional. A FHIR `Binary` containing the exact selected native JSON for audit, migration, and future remapping. It never replaces normalized facts. |

An export that only carries Layer 0 is conformant. Layer 1 and Layer 2 are incremental.

## Scope and conformance principles

This guide standardizes small, patient-generated facts about one person's period-tracking data. Each fact is a standalone Observation dated with `effectiveDateTime`. All Observations in a Bundle describe the same person; a Patient resource MAY be included but is not required.

A conforming export SHALL:

- use the [Period Tracking Bundle](StructureDefinition-period-tracking-bundle.html) profile;
- include at least one Layer 0 [Menstrual Bleeding](StructureDefinition-menstrual-bleeding.html) fact;
- emit a Layer 0 bleeding fact for every source date or timestamp that records bleeding or explicitly records no bleeding; and
- follow the missing-data rules below.

When an export includes a Layer 1 fact, it SHALL use the matching profile from this guide when one fits, or the base [Period Tracking Fact](StructureDefinition-period-tracking-fact.html) profile with an app-native code when none fits.

### Missingness

Do not turn missing data into "no."

| Source state | Behavior |
|---|---|
| User entered or selected a value | Emit a fact Observation. |
| User explicitly selected "none" or "no" | Emit the explicit-negative fact, such as `menstrual-bleeding=false` or `flow-none`. |
| App left a field at its default | Do not emit a negative fact. |
| Category was never opened or assessed | Do not emit a fact. |
| Source cannot distinguish default from explicit negative | Do not claim an explicit negative; preserve the source state in the native archive if included. |
| App prediction or inferred cycle state | Do not emit as an observed fact. |

Absence of a fact for a day means not recorded or not assessed, never an implied negative.

### Dates

Date-only source facts SHALL use `effectiveDateTime` at day precision, for example `"2026-05-14"`. Timed measurements SHOULD retain their source time and offset when known. Implementers SHALL NOT invent a time or timezone merely to create a full timestamp.

## Data model

### Bundle contents

{% capture model_diagram %}{% include model.svg %}{% endcapture %}
<div class="ptmvp-diagram">
{{ model_diagram | remove_first: '<?xml version="1.0" encoding="us-ascii" standalone="no"?>' }}
</div>

The Bundle is a FHIR `collection`: a transportable set of independently meaningful resources rather than an attested clinical document. Patient and Device resources are optional. A Device is useful when the source app can identify itself without increasing privacy risk.

Receivers group facts by the local date portion of `effectiveDateTime` when they need daily rows. The guide does not define a daily grouping Observation.

### Profiles

These profiles are the exchange surface. The descriptions below are read from the generated profile metadata.

{% sql {
  "query": "select Title as Profile, Web, sdType as Resource, Description as Role from Resources where Type = 'StructureDefinition' and Id in ('period-tracking-bundle','period-tracking-fact','menstrual-bleeding','menstrual-flow','symptom','numeric-pain-severity','basal-body-temperature') order by case Id when 'period-tracking-bundle' then 10 when 'period-tracking-fact' then 20 when 'menstrual-bleeding' then 30 when 'menstrual-flow' then 40 when 'symptom' then 50 when 'numeric-pain-severity' then 60 when 'basal-body-temperature' then 70 else 999 end",
  "columns": [
    { "source": "Profile", "type": "link", "target": "Web" },
    { "source": "Resource" },
    { "source": "Role" }
  ]
} %}

Every concrete fact profile inherits the base Period Tracking Fact shape: `status=final`, a code, an `effectiveDateTime`, optional `subject`, optional `device`, and exactly one `value[x]`.

### Core facts

| Fact | Profile | Observation.code | Result |
|---|---|---|---|
| Bleeding core | [Menstrual Bleeding](StructureDefinition-menstrual-bleeding.html) | `cycle#menstrual-bleeding` | `valueBoolean=true` or `false` |
| Flow intensity | [Menstrual Flow](StructureDefinition-menstrual-flow.html) | `cycle#menstrual-flow` | `flow-none`, `flow-spotting`, `flow-light`, `flow-moderate`, or `flow-heavy` |
| Symptom | [Symptom](StructureDefinition-symptom.html) | `cycle#symptom` | `valueCodeableConcept` naming the symptom |
| Numeric pain | [Numeric Pain Severity](StructureDefinition-numeric-pain-severity.html) | LOINC `72514-3` | UCUM `{score}` quantity for a true 0-10 rating |
| Basal body temperature | [Basal Body Temperature](StructureDefinition-basal-body-temperature.html) | LOINC `8310-5` | UCUM temperature quantity |

The bleeding fact is the universal core. A flow-capable app emits both the bleeding boolean and the flow fact when it has a source flow value. `flow-none` is consistent with `menstrual-bleeding=false`; spotting or greater is consistent with `menstrual-bleeding=true`.

### Native archive

The optional Layer 2 Binary SHOULD contain the exact selected native JSON after any app-level filtering but before clinical normalization. It is a safety net for audit, migration, and future remapping. It may contain more sensitive data than the normalized facts, so the consent preview SHOULD disclose whether it is included.

## SMART Health Link packaging

The complete Period Tracking Bundle is one FHIR JSON file suitable for SMART Health Link distribution. Use:

```text
application/fhir+json;fhirVersion=4.0.1
```

Period Tracking shares use SMART Health Links direct-file mode. A conforming share SHALL:

- include `U` in the SHLink `flag`;
- set `url` to a direct-file endpoint for one compact JWE;
- encrypt exactly one `application/fhir+json` Period Tracking Bundle; and
- let receivers retrieve the JWE by issuing a direct-file `GET` with `recipient` supplied as a query parameter.

Producing applications MAY present either a bare `shlink:/...` value or a viewer-prefixed URL such as:

```text
<viewer>#shlink:/...
```

When a viewer prefix is used, the SHLink SHALL be in the fragment after `#`, never in query parameters or another server-visible URL part. SHL-aware scanners should extract the embedded `shlink:/...` value and may ignore the viewer prefix.

The reference viewers and worked SHLink on this site are examples, not required components of a conforming implementation.

## Security and privacy

Period tracking data may reveal sexual, reproductive, fertility, pregnancy, medication, and mental-health information. Implementations should minimize both content and metadata.

Plaintext FHIR and native JSON SHOULD remain within the trusted application or browser context. Implementations SHALL NOT place decryption keys, owner capabilities, plaintext observations, or source free text in ordinary server logs, analytics events, crash reports, or URL query parameters.

The sharing UI SHOULD let the user choose the date range, normalized categories, identifying information, whether the native archive is included, and link controls such as expiration or use limits where the host can enforce them. The recipient SHALL confirm patient identity before importing data into a clinical chart.

## Terminology

This guide uses:

- the project [Period Tracking Codes](CodeSystem-cycle.html) CodeSystem for the Layer 0 bleeding fact, flow scale, and generic symptom fact code;
- [Menstrual Flow](ValueSet-menstrual-flow.html) for the five uncalibrated flow categories;
- [Common Period-Tracking Symptoms](ValueSet-common-tracker-symptoms.html) as a non-binding starter set for exact symptom matches;
- LOINC for observation names when the source meaning fits;
- SNOMED CT for clinical findings and answer concepts when the meaning is exact; and
- UCUM for quantitative units.

When no standard concept preserves the source meaning, use a stable app-native coding and/or `CodeableConcept.text`. Do not add a close-but-wrong standard concept merely to increase coding density.
