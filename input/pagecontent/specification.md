# Specification

## Use case

Period-tracking apps store menstrual and cycle observations in many different ways: daily rows, sparse date maps, nested documents, event tables, custom symptom dictionaries, and app-specific flow scales. Clinicians need a smaller, trustworthy handoff: the dates the user recorded, whether bleeding was present, and optional details such as flow, pain, symptoms, and basal body temperature.

This guide defines a minimal FHIR R4 payload for that handoff. A producing app exports one person's patient-generated facts into a FHIR Bundle, encrypts that Bundle into a SMART Health Link, and a receiving viewer or scanner decrypts it locally and derives the display from the granular facts. The guide does not define a diagnosis, a menstrual-health score, an EHR import policy, or a required viewer UI.

## Adoption layers

Adoption is incremental. Layer 0 is the compatibility floor; higher layers add detail only when the source app actually stores it.

| Layer | Name | Compatibility meaning |
|---|---|---|
| **Layer&nbsp;0** | **Bleeding calendar** | Required. A boolean menstrual-bleeding fact at the source date or timestamp. A Layer 0-only export is conformant. |
| **Layer&nbsp;1** | **Structured facts** | Optional. Flow, symptoms, numeric pain severity, basal body temperature, and other source-coded observations. These add detail but never replace Layer 0. |

## Data model

The payload is a FHIR `collection` Bundle: a transportable set of independently meaningful resources, not an attested clinical document. All Observations in the Bundle describe the same person; a Patient resource MAY be included but is not required. Device resources are optional and are useful when the source app can identify itself without increasing privacy risk.

Receivers group facts by the local date portion of `effectiveDateTime` when they need daily rows. The guide does not define a daily grouping Observation.

### Profiles

These profiles are the exchange surface. The descriptions below are read from the generated profile metadata.

{% sql {
  "query": "select Title as Profile, Web, case Id when 'period-tracking-bundle' then 'Container' when 'period-tracking-fact' then 'Abstract fact' when 'menstrual-bleeding' then 'Layer 0' else 'Layer 1' end as Layer, Description as Role from Resources where Type = 'StructureDefinition' and Id in ('period-tracking-bundle','period-tracking-fact','menstrual-bleeding','menstrual-flow','symptom','numeric-pain-severity','basal-body-temperature') order by case Id when 'period-tracking-bundle' then 10 when 'period-tracking-fact' then 20 when 'menstrual-bleeding' then 30 when 'menstrual-flow' then 40 when 'symptom' then 50 when 'numeric-pain-severity' then 60 when 'basal-body-temperature' then 70 else 999 end",
  "columns": [
    { "source": "Profile", "type": "link", "target": "Web" },
    { "source": "Layer" },
    { "source": "Role" }
  ]
} %}

Every concrete fact profile inherits the base Period Tracking Fact shape: `status=final`, a code, an `effectiveDateTime`, optional `subject`, optional `device`, and exactly one `value[x]`.

### Layered fact model

| Layer | Profile | Meaning | Result |
|---|---|---|---|
| **Layer&nbsp;0: required core** | [Menstrual Bleeding](StructureDefinition-menstrual-bleeding.html) | Whether the source records menstrual bleeding at the associated date or timestamp. | `cycle#menstrual-bleeding` with `valueBoolean=true` or `false` |
| **Layer&nbsp;1: optional structured facts** | [Menstrual Flow](StructureDefinition-menstrual-flow.html) | Source flow category. This characterizes the bleeding record; it does not replace Layer 0. | `flow-none`, `flow-spotting`, `flow-light`, `flow-moderate`, or `flow-heavy` |
| **Layer&nbsp;1: optional structured facts** | [Symptom](StructureDefinition-symptom.html) | A symptom selection, finding, or app-native symptom. | `valueCodeableConcept` naming the symptom |
| **Layer&nbsp;1: optional structured facts** | [Numeric Pain Severity](StructureDefinition-numeric-pain-severity.html) | True 0-10 numeric pain rating. | UCUM `{score}` quantity |
| **Layer&nbsp;1: optional structured facts** | [Basal Body Temperature](StructureDefinition-basal-body-temperature.html) | Temperature measurement identified by the source as basal. | UCUM temperature quantity |

The bleeding fact is the universal core. A flow-capable app emits both the Layer 0 bleeding boolean and the Layer 1 flow fact when it has a source flow value. `flow-none` is consistent with `menstrual-bleeding=false`; spotting or greater is consistent with `menstrual-bleeding=true`.

### Bundle contents

{% capture model_diagram %}{% include model.svg %}{% endcapture %}
<div class="ptmvp-diagram">
{{ model_diagram | remove_first: '<?xml version="1.0" encoding="us-ascii" standalone="no"?>' }}
</div>

### Terminology

This guide uses the project [Period Tracking Codes](CodeSystem-cycle.html) CodeSystem for the Layer 0 bleeding fact, the flow scale, and the generic symptom fact code. Use LOINC, SNOMED CT, and UCUM when the source meaning is exact enough. When no standard concept preserves the source meaning, use a stable app-native coding and/or `CodeableConcept.text` rather than a close-but-wrong standard concept.

## SMART Health Links

The complete Period Tracking Bundle is one FHIR JSON file suitable for SMART Health Link distribution:

```text
application/fhir+json;fhirVersion=4.0.1
```

Period Tracking shares use SMART Health Links direct-file mode. A conforming share SHALL:

- include `U` in the SHLink `flag`;
- set `url` to a direct-file endpoint for one compact JWE;
- encrypt exactly one `application/fhir+json` Period Tracking Bundle; and
- let receivers retrieve the JWE by issuing a direct-file `GET` with `recipient` supplied as a query parameter.

The protocol details are the SMART Health Links details: compact JWE encryption, key placement, direct-file retrieval, recipient handling, and optional server controls. This guide constrains only the payload shape and the period-tracking sharing UX. For the full wire protocol, use the [SMART Health Links specification](https://build.fhir.org/ig/HL7/smart-health-cards-and-links/links-specification.html).

Producing applications MAY present either a bare `shlink:/...` value or a viewer-prefixed URL:

```text
<viewer>#shlink:/...
```

When a viewer prefix is used, the SHLink SHALL be in the fragment after `#`, never in query parameters or another server-visible URL part. SHL-aware scanners should extract the embedded `shlink:/...` value and may ignore the viewer prefix.

The reference viewers and worked SHLink on this site are examples, not required components of a conforming implementation.

## Conformance

Normative requirements are collected here so the explanatory sections above do not need to repeat them.

A conforming export SHALL:

- use the [Period Tracking Bundle](StructureDefinition-period-tracking-bundle.html) profile;
- include at least one Layer 0 [Menstrual Bleeding](StructureDefinition-menstrual-bleeding.html) fact;
- emit a Layer 0 bleeding fact for every source date or timestamp that records bleeding or explicitly records no bleeding;
- scope all included Observations to the same person, whether or not a Patient resource is included; and
- follow the missing-data, date, SHLink, and privacy rules on this page.

When an export includes a Layer 1 fact, it SHALL use the matching profile from this guide when one fits, or the base [Period Tracking Fact](StructureDefinition-period-tracking-fact.html) profile with an app-native code when none fits.

### Missing data

Do not turn missing data into "no."

| Source state | Behavior |
|---|---|
| User entered or selected a value | Emit a fact Observation. |
| User explicitly selected "none" or "no" | Emit the explicit-negative fact, such as `menstrual-bleeding=false` or `flow-none`. |
| App left a field at its default | Do not emit a negative fact. |
| Category was never opened or assessed | Do not emit a fact. |
| Source cannot distinguish default from explicit negative | Do not claim an explicit negative. |
| App prediction or inferred cycle state | Do not emit as an observed fact. |

Absence of a fact for a day means not recorded or not assessed, never an implied negative.

### Dates

Date-only source facts SHALL use `effectiveDateTime` at day precision, for example `"2026-05-14"`. Timed measurements SHOULD retain their source time and offset when known. Implementers SHALL NOT invent a time or timezone merely to create a full timestamp.

### Privacy

Plaintext FHIR SHOULD remain within the trusted application or browser context. Implementations SHALL NOT place decryption keys, owner capabilities, plaintext observations, or source free text in ordinary server logs, analytics events, crash reports, or URL query parameters.

The sharing UI SHOULD let the user choose the date range, normalized categories, identifying information, and link controls such as expiration or use limits where the host can enforce them. The recipient SHALL confirm patient identity before importing data into a clinical chart.
