# Data model

## Resource graph

```text
PeriodTrackingBundle (Bundle.type = collection)
 ├── Patient                                  exactly one
 ├── Device                                   one or more source apps/devices
 ├── DailyTrackingPanelObservation            one per exported source day
 │    ├── hasMember → PeriodTrackingFactObservation
 │    ├── hasMember → PeriodTrackingFactObservation
 │    └── note → optional diary narrative
 ├── PeriodTrackingFactObservation            one per independent fact
 ├── CodeSystem                                optional app-native dictionary
 ├── Provenance                                required export provenance
 └── Binary                                    optional exact native JSON archive
```

FHIR defines a Bundle as a container for a collection of resources. The MVP uses `Bundle.type = collection` because it is a transportable set of independently meaningful resources rather than an attested clinical document.

## Why standalone facts

The source applications use radically different persistence patterns: wide daily rows, nested daily documents, date-keyed state, normalized event tables, and sparse date-to-tag joins. A shared exchange model should not reproduce any one database design.

A standalone Observation is used when a fact can be interpreted, displayed, filtered, or summarized on its own. This applies to menstrual status, flow, symptoms, pain, temperature, and mood.

`Observation.hasMember` groups those facts into a daily panel without taking away their independent identity. This follows the FHIR distinction between a grouping relationship and components that do not have independent meaning outside their parent Observation.

## Fact shape

The Period Tracking Fact Observation permits four result forms:

- `valueCodeableConcept` for status, flow, symptoms, mood, and ordinal severity;
- `valueQuantity` for numeric pain and temperature;
- `valueBoolean` for a source fact that is inherently true/false; and
- `valueString` for a source result that cannot yet be represented more precisely.

The preferred approach for a coded-but-unmapped result is still `valueCodeableConcept`, using an app-native coding and `CodeableConcept.text`. FHIR specifically permits text-only coded results when no appropriate code is available.

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

`Binary.securityContext` SHOULD reference the Patient. The Binary SHALL be encrypted together with the rest of the Bundle when distributed through a SMART Health Link.
