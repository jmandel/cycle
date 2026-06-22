# Normalized mapping contract

The following mappings are the interoperable core that MVP viewers are expected to understand.

| Clinical fact | Observation.code | Result | Notes |
|---|---|---|---|
| Menstrual status | LOINC `8678-5` — Menstrual status - Reported | SNOMED CT `289894009` menstrual bleeding present, or `289895005` not currently menstruating | Emit the negative only when explicitly reported or verified. |
| Menstrual flow | `https://fhir.me/cycle/CodeSystem/cycle#menstrual-flow` | One of the five MVP flow codes | Ordinal source category; never convert to mL or hemorrhage severity. |
| Symptom | LOINC `75325-1` — Symptom | SNOMED CT finding when exact; otherwise app-native coding and/or text | One Observation per selected symptom. |
| Numeric pain | LOINC `72514-3` — Pain severity 0–10 verbal numeric rating | Quantity using UCUM `{score}` | Use only for a true 0–10 rating. |
| Ordinal pain | LOINC `38208-5` — Pain severity - Reported | Standard qualifier or app-native coded value | Do not turn “unbearable” into a 10/10 score. |
| Basal body temperature | LOINC `8310-5` — Body temperature | UCUM temperature Quantity | Add SNOMED CT `281660007` as method when the source establishes basal measurement. |
| Mood | LOINC `80296-7` — Patient Mood | SNOMED CT finding when exact; otherwise app-native coding/text | Preserve the original source label. |
| Diary note | Daily panel `note` | Free text | A note applies to the source date unless the source gives narrower context. |

## Standard symptom examples

The MVP does not define a required symptom ValueSet. Implementers SHOULD use exact SNOMED CT concepts when reviewed mappings are available. Examples verified in the terminology releases used for this draft include:

| Source meaning | SNOMED CT |
|---|---|
| Menstrual cramp | `431416001` — Menstrual cramp (finding) |
| Headache | `25064002` — Headache (finding) |
| Stress | `73595000` — Stress (finding) |

Additional app symptoms may remain local until a mapping is reviewed.

## Multiple codings

When an app-native code and a standard code are truly equivalent in the export context, both MAY appear in the same `CodeableConcept`. The source coding SHOULD set `userSelected = true` when it directly reflects the user's choice.

When equivalence is uncertain, retain only the source coding and text. Do not add a nearby standard concept merely to increase coding density.

## Flow normalization

Map a source application's ordinal flow categories to the project codes as follows:

| Source label | MVP code |
|---|---|
| no flow / none, explicitly selected | `flow-none` |
| spotting | `flow-spotting` |
| light | `flow-light` |
| medium / moderate | `flow-moderate` |
| heavy | `flow-heavy` |

A source with multiple simultaneous or ambiguous flow tags SHOULD retain those raw tags in the native archive and SHOULD NOT silently choose one normalized value.

## Notes and functional impact

Diary text is carried in the panel note for the MVP. Implementers MAY additionally emit a source-coded fact when a structured item such as missed work or sleep disruption exists, but MVP viewers are not required to interpret it.
