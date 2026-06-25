# Data model

## Resource graph

{% include model.svg %}

FHIR defines a Bundle as a container for a collection of resources. The MVP uses `Bundle.type = collection` because it is a transportable set of independently meaningful resources rather than an attested clinical document.

## Why standalone facts

The source applications use radically different persistence patterns: wide daily rows, nested daily documents, date-keyed state, normalized event tables, and sparse date-to-tag joins. A shared exchange model should not reproduce any one database design.

A standalone Observation is used when a fact can be interpreted, displayed, filtered, or summarized on its own. This applies first to the universal boolean bleeding core, and then to optional layers such as flow, symptoms, pain, and temperature.

The MVP does not define a daily grouping Observation. Receivers can group facts by the local date portion of `effectiveDateTime` for visualization, while timed facts such as basal body temperature can retain their source timestamp.

## Fact shape

The abstract Period Tracking Fact Observation permits four result forms:

- `valueCodeableConcept` for flow, symptoms, and ordinal source-coded layers;
- `valueQuantity` for numeric pain and temperature;
- `valueBoolean` for a source fact that is inherently true/false; and
- `valueString` for a source result that cannot yet be represented more precisely.

The preferred approach for a coded-but-unmapped result is still `valueCodeableConcept`, using an app-native coding and `CodeableConcept.text`. FHIR specifically permits text-only coded results when no appropriate code is available.

Concrete MVP fact profiles narrow the base shape where producers and consumers need a predictable recipe: menstrual bleeding, menstrual flow, symptom, numeric pain severity, and basal body temperature.

## Source identity and fidelity

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

## Native archive

The optional Binary SHOULD contain the exact selected native JSON after any app-level profile and date filtering but before clinical normalization. It SHOULD include:

- source application and version;
- database or schema version;
- timezone context where known;
- raw field names and values;
- stable source identifiers; and
- enough vocabulary metadata to interpret custom codes.

`Binary.securityContext` SHOULD reference the Patient when a Patient resource is included. The Binary SHALL be encrypted together with the rest of the Bundle when distributed through a SMART Health Link.
