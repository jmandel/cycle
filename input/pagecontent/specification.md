# Specification

## Use case

Period-tracking apps store menstrual and cycle observations in many different ways: daily rows, sparse date maps, nested documents, event tables, symptom picklists, and app-specific flow scales. Clinicians need a smaller, trustworthy handoff: the dates the user recorded, whether bleeding was present, and optional details such as flow, pain, symptoms, and basal body temperature.

This guide defines a minimal FHIR R4 payload for that handoff. A producing app exports one person's patient-generated facts into a FHIR Bundle, encrypts that Bundle into a SMART Health Link, and a receiving viewer or scanner decrypts it locally and derives the display from the granular facts. The guide does not define a diagnosis, a menstrual-health score, an EHR import policy, or a required viewer UI.

## Adoption layers

Adoption is incremental. **Layer 0** is the compatibility floor: a boolean menstrual-bleeding fact at the source date or timestamp. A Layer 0-only export is conformant. **Layer 1** adds structured facts such as flow, symptoms, numeric pain severity, and basal body temperature when the source app actually stores them. Layer 1 adds detail but never replaces Layer 0.

## Data model

The payload is a FHIR `collection` Bundle: a transportable set of independently meaningful resources, not an attested clinical document. All Observations in the Bundle describe the same person; a Patient resource MAY be included but is not required. Device resources are optional and are useful when the source app can identify itself without increasing privacy risk.

Receivers group facts by the local date portion of `effectiveDateTime` when they need daily rows. The guide does not define a daily grouping Observation.

### Profiles and layers

These profiles are the exchange surface. The table below combines the adoption layer, profile role, and wire shape implementers need to recognize.

<div class="table-scroll">
<table class="cycle-table profile-layer-table">
  <colgroup>
    <col class="profile-layer-col-layer" />
    <col class="profile-layer-col-profile" />
    <col class="profile-layer-col-meaning" />
    <col class="profile-layer-col-result" />
  </colgroup>
  <thead>
    <tr>
      <th scope="col">Layer</th>
      <th scope="col">Profile</th>
      <th scope="col">Meaning</th>
      <th scope="col">Wire shape</th>
    </tr>
  </thead>
  <tbody>
    <tr class="profile-layer-support">
      <th scope="row" class="profile-layer-label">
        <strong>Base shape</strong>
      </th>
      <td><a href="StructureDefinition-period-tracking-fact.html">Period Tracking Fact</a></td>
      <td>The abstract Observation shape inherited by concrete fact profiles.</td>
      <td><code>status=final</code>, <code>effectiveDateTime</code>, optional <code>subject</code>, optional <code>device</code>, and exactly one <code>value[x]</code>.</td>
    </tr>
    <tr class="profile-layer-core">
      <th scope="row" class="profile-layer-label">
        <strong>Layer 0</strong>
        <span>Required core</span>
      </th>
      <td><a href="StructureDefinition-menstrual-bleeding.html">Menstrual Bleeding</a></td>
      <td>The compatibility floor: whether the source records menstrual bleeding for the stated date or timestamp.</td>
      <td><code>cycle#menstrual-bleeding</code> with <code>valueBoolean=true</code> or <code>false</code>.</td>
    </tr>
    <tr>
      <th scope="rowgroup" rowspan="4" class="profile-layer-label">
        <strong>Layer 1</strong>
        <span>Optional structured facts</span>
      </th>
      <td><a href="StructureDefinition-menstrual-flow.html">Menstrual Flow</a></td>
      <td>Source menstrual-flow intensity. This characterizes a bleeding record; it does not replace Layer 0.</td>
      <td><code>cycle#menstrual-flow</code> with <code>flow-none</code>, <code>flow-spotting</code>, <code>flow-light</code>, <code>flow-moderate</code>, or <code>flow-heavy</code>.</td>
    </tr>
    <tr>
      <td><a href="StructureDefinition-symptom.html">Symptom</a></td>
      <td>A symptom selection or finding recorded by the source.</td>
      <td><code>cycle#symptom</code> with <code>valueCodeableConcept</code> naming the symptom.</td>
    </tr>
    <tr>
      <td><a href="StructureDefinition-numeric-pain-severity.html">Numeric Pain Severity</a></td>
      <td>A true 0-10 numeric pain rating. Use this profile only when the source stores a numeric 0-10 score.</td>
      <td>LOINC <code>72514-3</code> with a UCUM <code>{score}</code> quantity.</td>
    </tr>
    <tr>
      <td><a href="StructureDefinition-basal-body-temperature.html">Basal Body Temperature</a></td>
      <td>A source temperature measurement identified by the producer as basal.</td>
      <td>LOINC <code>8310-5</code> with a UCUM temperature quantity.</td>
    </tr>
    <tr class="profile-layer-support">
      <th scope="row" class="profile-layer-label">
        <strong>Container</strong>
      </th>
      <td><a href="StructureDefinition-period-tracking-bundle.html">Period Tracking Bundle</a></td>
      <td>A FHIR <code>collection</code> Bundle scoped to one person.</td>
      <td>Contains at least one Layer 0 fact. Patient and Device resources are optional.</td>
    </tr>
  </tbody>
</table>
</div>

The bleeding fact is the universal core. A flow-capable app emits both the Layer 0 bleeding boolean and the Layer 1 flow fact when it has a source flow value. `flow-none` is consistent with `menstrual-bleeding=false`; spotting or greater is consistent with `menstrual-bleeding=true`.

### Bundle contents

The Bundle is a FHIR `collection` scoped to one person. It contains at least one
Layer 0 Menstrual Bleeding Observation, may contain Layer 1 Observations, and
may include optional Patient or Device resources when useful for the share.

### Terminology

This guide uses the project [Period Tracking Codes](CodeSystem-cycle.html) CodeSystem for the Layer 0 bleeding fact, the flow scale, and the generic symptom fact code. Use LOINC, SNOMED CT, and UCUM when the source meaning is exact enough. Do not use close-but-wrong standard concepts.

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

When an export includes a Layer 1 fact, it SHALL use the matching profile from this guide when one fits.

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
