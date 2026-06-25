# Normalized mapping contract

The first row is the universal interoperable core that MVP producers emit and MVP viewers understand:
a boolean bleeding fact at the source date or timestamp. The remaining rows are optional layers that
add intensity, symptoms, pain, or temperature when the source app has those data.

| Clinical fact | Observation.code | Result | Notes |
|---|---|---|---|
| Bleeding (core) | `https://cycle.fhir.me/CodeSystem/cycle#menstrual-bleeding` | `valueBoolean` true or false | The universal bleeding fact. Emit `false` only when the source explicitly records no bleeding or otherwise reliably represents a user-verified no-bleeding state. |
| Menstrual flow | `https://cycle.fhir.me/CodeSystem/cycle#menstrual-flow` | One of the five MVP flow codes | Optional intensity layer. Ordinal source category; never convert to mL or hemorrhage severity. |
| Symptom | `https://cycle.fhir.me/CodeSystem/cycle#symptom` | `valueCodeableConcept`: preferred starter ValueSet concept when exact; otherwise app-native coding and/or text | One Observation per selected symptom. Do not force a nearby SNOMED finding. |
| Numeric pain | LOINC `72514-3` — Pain severity 0–10 verbal numeric rating | Quantity using UCUM `{score}` | Use only for a true 0–10 rating. |
| Ordinal pain | LOINC `38208-5` — Pain severity - Reported, or a stable app/project code | Standard qualifier or app-native coded value | Do not turn “unbearable” into a 10/10 score or a near-match qualifier. |
| Basal body temperature | LOINC `8310-5` — Body temperature | UCUM temperature Quantity | Add SNOMED CT `281660007` as method when the source establishes basal measurement. |
| Mood-like symptoms | `cycle#symptom` | Preferred symptom concept such as SNOMED CT depressed mood when exact; otherwise app-native coding/text | Preserve the original source label. |

## Standard symptom examples

The symptom profile has a preferred, non-closed starter ValueSet. Implementers SHOULD use exact SNOMED CT concepts from that set when they fit, but a stable app-native code is better than a close-but-wrong standard code. Examples verified in the terminology releases used for this draft include:

| Source meaning | Preferred coding |
|---|---|
| Menstrual cramp | `431416001` — Menstrual cramp (finding) |
| Headache | `25064002` — Headache (finding) |
| Depressed mood | `366979004` — Depressed mood (finding), only when the source meaning is exact |
| Stress | `73595000` — Stress (finding) |

Additional app symptoms may remain local until a mapping is reviewed, and some may remain local permanently if no standard concept preserves the source meaning.

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

Flow does not replace the boolean bleeding core. A flow-capable app emits both facts when it
has a source flow value: `flow-none` is consistent with `menstrual-bleeding=false`, while
`flow-spotting`, `flow-light`, `flow-moderate`, and `flow-heavy` are consistent with
`menstrual-bleeding=true`. A binary app can emit only `menstrual-bleeding`.

## Notes and functional impact

Diary text is not a normalized MVP fact. A complete export MAY preserve notes in the optional native archive. Implementers MAY emit source-coded facts for structured items such as missed work or sleep disruption, but MVP viewers are not required to interpret them.
