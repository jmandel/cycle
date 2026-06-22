Instance: period-tracking-patient-example
InstanceOf: Patient
Usage: #example
Title: "Example Patient"
Description: "A synthetic patient used only for the worked MVP export."
* identifier.system = "https://example.org/mrn"
* identifier.value = "PT-MVP-001"
* name.use = #usual
* name.family = "Example"
* name.given = "Jordan"
* birthDate = "1990-07-11"
* text.status = #generated
* text.div = "<div xmlns=\"http://www.w3.org/1999/xhtml\"><p><b>Jordan Example</b>, born 11 July 1990. Synthetic example only.</p></div>"

Instance: period-tracking-app-example
InstanceOf: Device
Usage: #example
Title: "Example Source App"
Description: "Identifies the period-tracking application that produced the export."
* status = #active
* deviceName[0].name = "MVP Reference Tracker"
* deviceName[0].type = #user-friendly-name
* type.text = "Period-tracking application"
* version[0].value = "0.1.0"
* text.status = #generated
* text.div = "<div xmlns=\"http://www.w3.org/1999/xhtml\"><p>Source application: <b>MVP Reference Tracker 0.1.0</b>.</p></div>"

Instance: example-app-symptom-code-system
InstanceOf: CodeSystem
Usage: #example
Title: "Example App Symptom Dictionary"
Description: "An illustrative app-native dictionary. Real applications SHOULD use a stable URL under their control and preserve stable source identifiers."
* url = $ExampleSymptoms
* version = "1"
* name = "ExampleAppSymptoms"
* title = "Example App Symptoms"
* status = #active
* experimental = true
* date = "2026-06-22"
* publisher = "Example only"
* content = #complete
* caseSensitive = true
* concept[0].code = #pulling-sensation
* concept[0].display = "Pulling sensation"
* concept[0].definition = "A user-defined symptom retained in its source vocabulary because no reviewed standard mapping was established."
* text.status = #generated
* text.div = "<div xmlns=\"http://www.w3.org/1999/xhtml\"><p>Example app-native symptom dictionary containing <code>pulling-sensation</code>.</p></div>"

Instance: status-present-2026-05-14
InstanceOf: PeriodTrackingFactObservation
Usage: #example
Title: "Menstrual Bleeding Present — 14 May 2026"
* identifier.system = "https://example.org/mvp-reference-tracker/fact"
* identifier.value = "2026-05-14-period-status"
* category = $ObsCat#survey "Survey"
* code = $LNC#8678-5 "Menstrual status - Reported"
* subject = Reference(period-tracking-patient-example)
* effectiveDateTime = "2026-05-14"
* performer = Reference(period-tracking-patient-example)
* valueCodeableConcept = $SCT#289894009 "Menstrual bleeding present (finding)"
* device = Reference(period-tracking-app-example)
* text.status = #generated
* text.div = "<div xmlns=\"http://www.w3.org/1999/xhtml\"><p>Menstrual bleeding was explicitly reported as present on 14 May 2026.</p></div>"

Instance: flow-heavy-2026-05-14
InstanceOf: PeriodTrackingFactObservation
Usage: #example
Title: "Heavy Patient-Rated Flow — 14 May 2026"
* identifier.system = "https://example.org/mvp-reference-tracker/fact"
* identifier.value = "2026-05-14-flow"
* category = $ObsCat#survey "Survey"
* code = $CycleCS#menstrual-flow "Patient-reported menstrual flow category"
* subject = Reference(period-tracking-patient-example)
* effectiveDateTime = "2026-05-14"
* performer = Reference(period-tracking-patient-example)
* valueCodeableConcept = $CycleCS#flow-heavy "Heavy"
* device = Reference(period-tracking-app-example)
* note.text = "Uncalibrated source-app ordinal category; not a measured blood-loss volume."
* text.status = #generated
* text.div = "<div xmlns=\"http://www.w3.org/1999/xhtml\"><p>The patient selected the app's <b>heavy</b> menstrual-flow category on 14 May 2026.</p></div>"

Instance: cramps-2026-05-14
InstanceOf: PeriodTrackingFactObservation
Usage: #example
Title: "Menstrual Cramps — 14 May 2026"
* identifier.system = "https://example.org/mvp-reference-tracker/fact"
* identifier.value = "2026-05-14-cramps"
* category = $ObsCat#survey "Survey"
* code = $LNC#75325-1 "Symptom"
* subject = Reference(period-tracking-patient-example)
* effectiveDateTime = "2026-05-14"
* performer = Reference(period-tracking-patient-example)
* valueCodeableConcept = $SCT#431416001 "Menstrual cramp (finding)"
* device = Reference(period-tracking-app-example)
* text.status = #generated
* text.div = "<div xmlns=\"http://www.w3.org/1999/xhtml\"><p>Menstrual cramps were reported on 14 May 2026.</p></div>"

Instance: pain-7-2026-05-14
InstanceOf: PeriodTrackingFactObservation
Usage: #example
Title: "Pain Rating 7 of 10 — 14 May 2026"
* identifier.system = "https://example.org/mvp-reference-tracker/fact"
* identifier.value = "2026-05-14-pain-score"
* category = $ObsCat#survey "Survey"
* code = $LNC#72514-3 "Pain severity - 0-10 verbal numeric rating [Score] - Reported"
* subject = Reference(period-tracking-patient-example)
* effectiveDateTime = "2026-05-14"
* performer = Reference(period-tracking-patient-example)
* valueQuantity = 7 '{score}' "score"
* device = Reference(period-tracking-app-example)
* text.status = #generated
* text.div = "<div xmlns=\"http://www.w3.org/1999/xhtml\"><p>Patient-reported pain severity: <b>7/10</b> on 14 May 2026.</p></div>"

Instance: temperature-2026-05-14
InstanceOf: PeriodTrackingFactObservation
Usage: #example
Title: "Basal Body Temperature — 14 May 2026"
* identifier.system = "https://example.org/mvp-reference-tracker/fact"
* identifier.value = "2026-05-14-temperature"
* category = $ObsCat#vital-signs "Vital Signs"
* code = $LNC#8310-5 "Body temperature"
* subject = Reference(period-tracking-patient-example)
* effectiveDateTime = "2026-05-14T06:45:00-05:00"
* performer = Reference(period-tracking-patient-example)
* valueQuantity = 36.6 'Cel' "degree Celsius"
* method = $SCT#281660007 "Basal body temperature measurement for detection of ovulation (procedure)"
* device = Reference(period-tracking-app-example)
* text.status = #generated
* text.div = "<div xmlns=\"http://www.w3.org/1999/xhtml\"><p>Basal body temperature: <b>36.6 °C</b> at 06:45 local time on 14 May 2026.</p></div>"

Instance: mood-stressed-2026-05-14
InstanceOf: PeriodTrackingFactObservation
Usage: #example
Title: "Stress Recorded — 14 May 2026"
* identifier.system = "https://example.org/mvp-reference-tracker/fact"
* identifier.value = "2026-05-14-mood-stressed"
* category = $ObsCat#survey "Survey"
* code = $LNC#80296-7 "Patient Mood"
* subject = Reference(period-tracking-patient-example)
* effectiveDateTime = "2026-05-14"
* performer = Reference(period-tracking-patient-example)
* valueCodeableConcept = $SCT#73595000 "Stress (finding)"
* device = Reference(period-tracking-app-example)
* text.status = #generated
* text.div = "<div xmlns=\"http://www.w3.org/1999/xhtml\"><p>The patient recorded feeling stressed on 14 May 2026.</p></div>"

Instance: custom-symptom-2026-05-14
InstanceOf: PeriodTrackingFactObservation
Usage: #example
Title: "App-Native Custom Symptom — 14 May 2026"
* identifier.system = "https://example.org/mvp-reference-tracker/fact"
* identifier.value = "2026-05-14-custom-symptom"
* category = $ObsCat#survey "Survey"
* code = $LNC#75325-1 "Symptom"
* subject = Reference(period-tracking-patient-example)
* effectiveDateTime = "2026-05-14"
* performer = Reference(period-tracking-patient-example)
* valueCodeableConcept.coding.system = $ExampleSymptoms
* valueCodeableConcept.coding.code = #pulling-sensation
* valueCodeableConcept.coding.display = "Pulling sensation"
* valueCodeableConcept.coding.userSelected = true
* valueCodeableConcept.text = "Pulling sensation"
* device = Reference(period-tracking-app-example)
* text.status = #generated
* text.div = "<div xmlns=\"http://www.w3.org/1999/xhtml\"><p>App-native symptom: <b>Pulling sensation</b>. No standard mapping was asserted.</p></div>"

Instance: day-panel-2026-05-14
InstanceOf: DailyTrackingPanelObservation
Usage: #example
Title: "Daily Tracking Panel — 14 May 2026"
* identifier.system = "https://example.org/mvp-reference-tracker/day"
* identifier.value = "2026-05-14"
* subject = Reference(period-tracking-patient-example)
* effectiveDateTime = "2026-05-14"
* performer = Reference(period-tracking-patient-example)
* device = Reference(period-tracking-app-example)
* hasMember[0] = Reference(status-present-2026-05-14)
* hasMember[1] = Reference(flow-heavy-2026-05-14)
* hasMember[2] = Reference(cramps-2026-05-14)
* hasMember[3] = Reference(pain-7-2026-05-14)
* hasMember[4] = Reference(temperature-2026-05-14)
* hasMember[5] = Reference(mood-stressed-2026-05-14)
* hasMember[6] = Reference(custom-symptom-2026-05-14)
* note.text = "Needed to leave work early."
* text.status = #generated
* text.div = "<div xmlns=\"http://www.w3.org/1999/xhtml\"><p><b>14 May 2026:</b> menstrual bleeding present; heavy patient-rated flow; cramps; pain 7/10; basal temperature 36.6 °C; stress; custom pulling sensation. Diary note: Needed to leave work early.</p></div>"

Instance: status-present-2026-05-15
InstanceOf: PeriodTrackingFactObservation
Usage: #example
Title: "Menstrual Bleeding Present — 15 May 2026"
* identifier.system = "https://example.org/mvp-reference-tracker/fact"
* identifier.value = "2026-05-15-period-status"
* category = $ObsCat#survey "Survey"
* code = $LNC#8678-5 "Menstrual status - Reported"
* subject = Reference(period-tracking-patient-example)
* effectiveDateTime = "2026-05-15"
* performer = Reference(period-tracking-patient-example)
* valueCodeableConcept = $SCT#289894009 "Menstrual bleeding present (finding)"
* device = Reference(period-tracking-app-example)
* text.status = #generated
* text.div = "<div xmlns=\"http://www.w3.org/1999/xhtml\"><p>Menstrual bleeding was explicitly reported as present on 15 May 2026.</p></div>"

Instance: flow-moderate-2026-05-15
InstanceOf: PeriodTrackingFactObservation
Usage: #example
Title: "Moderate Patient-Rated Flow — 15 May 2026"
* identifier.system = "https://example.org/mvp-reference-tracker/fact"
* identifier.value = "2026-05-15-flow"
* category = $ObsCat#survey "Survey"
* code = $CycleCS#menstrual-flow "Patient-reported menstrual flow category"
* subject = Reference(period-tracking-patient-example)
* effectiveDateTime = "2026-05-15"
* performer = Reference(period-tracking-patient-example)
* valueCodeableConcept = $CycleCS#flow-moderate "Moderate"
* device = Reference(period-tracking-app-example)
* text.status = #generated
* text.div = "<div xmlns=\"http://www.w3.org/1999/xhtml\"><p>The patient selected the app's <b>moderate</b> menstrual-flow category on 15 May 2026.</p></div>"

Instance: headache-2026-05-15
InstanceOf: PeriodTrackingFactObservation
Usage: #example
Title: "Headache — 15 May 2026"
* identifier.system = "https://example.org/mvp-reference-tracker/fact"
* identifier.value = "2026-05-15-headache"
* category = $ObsCat#survey "Survey"
* code = $LNC#75325-1 "Symptom"
* subject = Reference(period-tracking-patient-example)
* effectiveDateTime = "2026-05-15"
* performer = Reference(period-tracking-patient-example)
* valueCodeableConcept = $SCT#25064002 "Headache (finding)"
* device = Reference(period-tracking-app-example)
* text.status = #generated
* text.div = "<div xmlns=\"http://www.w3.org/1999/xhtml\"><p>Headache was reported on 15 May 2026.</p></div>"

Instance: pain-4-2026-05-15
InstanceOf: PeriodTrackingFactObservation
Usage: #example
Title: "Pain Rating 4 of 10 — 15 May 2026"
* identifier.system = "https://example.org/mvp-reference-tracker/fact"
* identifier.value = "2026-05-15-pain-score"
* category = $ObsCat#survey "Survey"
* code = $LNC#72514-3 "Pain severity - 0-10 verbal numeric rating [Score] - Reported"
* subject = Reference(period-tracking-patient-example)
* effectiveDateTime = "2026-05-15"
* performer = Reference(period-tracking-patient-example)
* valueQuantity = 4 '{score}' "score"
* device = Reference(period-tracking-app-example)
* text.status = #generated
* text.div = "<div xmlns=\"http://www.w3.org/1999/xhtml\"><p>Patient-reported pain severity: <b>4/10</b> on 15 May 2026.</p></div>"

Instance: day-panel-2026-05-15
InstanceOf: DailyTrackingPanelObservation
Usage: #example
Title: "Daily Tracking Panel — 15 May 2026"
* identifier.system = "https://example.org/mvp-reference-tracker/day"
* identifier.value = "2026-05-15"
* subject = Reference(period-tracking-patient-example)
* effectiveDateTime = "2026-05-15"
* performer = Reference(period-tracking-patient-example)
* device = Reference(period-tracking-app-example)
* hasMember[0] = Reference(status-present-2026-05-15)
* hasMember[1] = Reference(flow-moderate-2026-05-15)
* hasMember[2] = Reference(headache-2026-05-15)
* hasMember[3] = Reference(pain-4-2026-05-15)
* text.status = #generated
* text.div = "<div xmlns=\"http://www.w3.org/1999/xhtml\"><p><b>15 May 2026:</b> menstrual bleeding present; moderate patient-rated flow; headache; pain 4/10.</p></div>"

Instance: status-absent-2026-05-20
InstanceOf: PeriodTrackingFactObservation
Usage: #example
Title: "Explicitly Not Menstruating — 20 May 2026"
* identifier.system = "https://example.org/mvp-reference-tracker/fact"
* identifier.value = "2026-05-20-period-status"
* category = $ObsCat#survey "Survey"
* code = $LNC#8678-5 "Menstrual status - Reported"
* subject = Reference(period-tracking-patient-example)
* effectiveDateTime = "2026-05-20"
* performer = Reference(period-tracking-patient-example)
* valueCodeableConcept = $SCT#289895005 "Not currently menstruating (finding)"
* device = Reference(period-tracking-app-example)
* note.text = "Exported because the user explicitly verified the negative state; untouched defaults are not exported."
* text.status = #generated
* text.div = "<div xmlns=\"http://www.w3.org/1999/xhtml\"><p>The patient explicitly reported that they were not currently menstruating on 20 May 2026.</p></div>"

Instance: day-panel-2026-05-20
InstanceOf: DailyTrackingPanelObservation
Usage: #example
Title: "Daily Tracking Panel — 20 May 2026"
* identifier.system = "https://example.org/mvp-reference-tracker/day"
* identifier.value = "2026-05-20"
* subject = Reference(period-tracking-patient-example)
* effectiveDateTime = "2026-05-20"
* performer = Reference(period-tracking-patient-example)
* device = Reference(period-tracking-app-example)
* hasMember[0] = Reference(status-absent-2026-05-20)
* note.text = "Explicitly verified no menstrual bleeding."
* text.status = #generated
* text.div = "<div xmlns=\"http://www.w3.org/1999/xhtml\"><p><b>20 May 2026:</b> explicitly not menstruating.</p></div>"

Instance: ordinal-pain-moderate-example
InstanceOf: PeriodTrackingFactObservation
Usage: #example
Title: "Ordinal Moderate Pain Example"
Description: "Illustrates an application that records an ordinal category rather than a true 0–10 score."
* identifier.system = "https://example.org/menstrudel/log-fact"
* identifier.value = "2026-05-16-pain-ordinal"
* category = $ObsCat#survey "Survey"
* code = $LNC#38208-5 "Pain severity - Reported"
* subject = Reference(period-tracking-patient-example)
* effectiveDateTime = "2026-05-16"
* performer = Reference(period-tracking-patient-example)
* valueCodeableConcept = $SCT#6736007 "Moderate (severity modifier) (qualifier value)"
* device = Reference(period-tracking-app-example)
* text.status = #generated
* text.div = "<div xmlns=\"http://www.w3.org/1999/xhtml\"><p>Ordinal patient-reported pain severity: <b>moderate</b>.</p></div>"

Instance: flow-none-example
InstanceOf: PeriodTrackingFactObservation
Usage: #example
Title: "Explicit No Flow Example"
Description: "Illustrates a source UI in which the user explicitly selected the no-flow category; an untouched default must not be exported this way."
* identifier.system = "https://example.org/app/fact"
* identifier.value = "2026-05-20-flow-none"
* category = $ObsCat#survey "Survey"
* code = $CycleCS#menstrual-flow "Patient-reported menstrual flow category"
* subject = Reference(period-tracking-patient-example)
* effectiveDateTime = "2026-05-20"
* performer = Reference(period-tracking-patient-example)
* valueCodeableConcept = $CycleCS#flow-none "None"
* device = Reference(period-tracking-app-example)
* text.status = #generated
* text.div = "<div xmlns=\"http://www.w3.org/1999/xhtml\"><p>The patient explicitly selected <b>no menstrual flow</b> on 20 May 2026.</p></div>"

Instance: flow-spotting-example
InstanceOf: PeriodTrackingFactObservation
Usage: #example
Title: "Spotting Flow Example"
* identifier.system = "https://example.org/app/fact"
* identifier.value = "2026-05-21-flow-spotting"
* category = $ObsCat#survey "Survey"
* code = $CycleCS#menstrual-flow "Patient-reported menstrual flow category"
* subject = Reference(period-tracking-patient-example)
* effectiveDateTime = "2026-05-21"
* performer = Reference(period-tracking-patient-example)
* valueCodeableConcept = $CycleCS#flow-spotting "Spotting"
* device = Reference(period-tracking-app-example)
* text.status = #generated
* text.div = "<div xmlns=\"http://www.w3.org/1999/xhtml\"><p>The patient selected the app's <b>spotting</b> flow category.</p></div>"

Instance: flow-light-example
InstanceOf: PeriodTrackingFactObservation
Usage: #example
Title: "Light Flow Example"
* identifier.system = "https://example.org/app/fact"
* identifier.value = "2026-05-22-flow-light"
* category = $ObsCat#survey "Survey"
* code = $CycleCS#menstrual-flow "Patient-reported menstrual flow category"
* subject = Reference(period-tracking-patient-example)
* effectiveDateTime = "2026-05-22"
* performer = Reference(period-tracking-patient-example)
* valueCodeableConcept = $CycleCS#flow-light "Light"
* device = Reference(period-tracking-app-example)
* text.status = #generated
* text.div = "<div xmlns=\"http://www.w3.org/1999/xhtml\"><p>The patient selected the app's <b>light</b> flow category.</p></div>"

Instance: note-only-day-example
InstanceOf: DailyTrackingPanelObservation
Usage: #example
Title: "Note-Only Daily Panel Example"
Description: "Illustrates a diary note on a day when no normalized structured fact was recorded."
* identifier.system = "https://example.org/app/day"
* identifier.value = "2026-05-23-note-only"
* subject = Reference(period-tracking-patient-example)
* effectiveDateTime = "2026-05-23"
* performer = Reference(period-tracking-patient-example)
* device = Reference(period-tracking-app-example)
* note.text = "Felt unusually tired; no other categories completed."
* text.status = #generated
* text.div = "<div xmlns=\"http://www.w3.org/1999/xhtml\"><p><b>23 May 2026:</b> diary note only — Felt unusually tired; no other categories completed.</p></div>"

Instance: native-source-json-example
InstanceOf: Binary
Usage: #example
Title: "Optional Native JSON Archive"
Description: "A compact illustrative native export retained as an audit and migration safety net. Clinical viewers need not process it."
* contentType = #application/json
* securityContext = Reference(period-tracking-patient-example)
* data = "eyJzb3VyY2VBcHAiOiJNVlAgUmVmZXJlbmNlIFRyYWNrZXIiLCJhcHBWZXJzaW9uIjoiMC4xLjAiLCJzY2hlbWFWZXJzaW9uIjoxLCJ0aW1lem9uZSI6IkFtZXJpY2EvQ2hpY2FnbyIsImRheXMiOlt7ImRhdGUiOiIyMDI2LTA1LTE0IiwicGVyaW9kU3RhdHVzIjoicHJlc2VudCIsImZsb3ciOiJoZWF2eSIsInN5bXB0b21zIjpbeyJjb2RlIjoiY3JhbXBzIn0seyJjb2RlIjoicHVsbGluZy1zZW5zYXRpb24iLCJjdXN0b20iOnRydWV9XSwicGFpblNjb3JlIjo3LCJ0ZW1wZXJhdHVyZSI6eyJ2YWx1ZSI6MzYuNiwidW5pdCI6IkNlbCIsInRpbWUiOiIwNjo0NSIsImJhc2FsIjp0cnVlfSwibW9vZCI6WyJzdHJlc3NlZCJdLCJub3RlIjoiTmVlZGVkIHRvIGxlYXZlIHdvcmsgZWFybHkuIn0seyJkYXRlIjoiMjAyNi0wNS0xNSIsInBlcmlvZFN0YXR1cyI6InByZXNlbnQiLCJmbG93IjoibW9kZXJhdGUiLCJzeW1wdG9tcyI6W3siY29kZSI6ImhlYWRhY2hlIn1dLCJwYWluU2NvcmUiOjR9LHsiZGF0ZSI6IjIwMjYtMDUtMjAiLCJwZXJpb2RTdGF0dXMiOiJhYnNlbnQiLCJub3RlIjoiRXhwbGljaXRseSB2ZXJpZmllZCBubyBtZW5zdHJ1YWwgYmxlZWRpbmcuIn1dfQ=="

Instance: export-provenance-example
InstanceOf: Provenance
Usage: #example
Title: "Example Export Provenance"
Description: "Records that the source application transformed local patient-generated data into the normalized MVP resources."
* target[0] = Reference(day-panel-2026-05-14)
* target[1] = Reference(status-present-2026-05-14)
* target[2] = Reference(flow-heavy-2026-05-14)
* target[3] = Reference(cramps-2026-05-14)
* target[4] = Reference(pain-7-2026-05-14)
* target[5] = Reference(temperature-2026-05-14)
* target[6] = Reference(mood-stressed-2026-05-14)
* target[7] = Reference(custom-symptom-2026-05-14)
* target[8] = Reference(day-panel-2026-05-15)
* target[9] = Reference(status-present-2026-05-15)
* target[10] = Reference(flow-moderate-2026-05-15)
* target[11] = Reference(headache-2026-05-15)
* target[12] = Reference(pain-4-2026-05-15)
* target[13] = Reference(day-panel-2026-05-20)
* target[14] = Reference(status-absent-2026-05-20)
* recorded = "2026-06-22T15:30:00-05:00"
* agent.type = $ProvParticipant#assembler "Assembler"
* agent.who = Reference(period-tracking-app-example)
* entity.role = #source
* entity.what = Reference(native-source-json-example)
* text.status = #generated
* text.div = "<div xmlns=\"http://www.w3.org/1999/xhtml\"><p>MVP Reference Tracker 0.1.0 assembled the normalized resources from the attached native source snapshot on 22 June 2026.</p></div>"

Instance: period-tracking-bundle-example
InstanceOf: PeriodTrackingBundle
Usage: #example
Title: "Period Tracking MVP Export Bundle"
Description: "A complete worked example containing a patient, source app, app-native vocabulary, granular facts, daily panels, provenance, and an optional native source archive."
* identifier.system = "https://example.org/period-tracking-export"
* identifier.value = "export-2026-06-22-001"
* timestamp = "2026-06-22T15:30:00-05:00"
* entry[0].fullUrl = "https://example.org/fhir/Patient/period-tracking-patient-example"
* entry[0].resource = period-tracking-patient-example
* entry[1].fullUrl = "https://example.org/fhir/Device/period-tracking-app-example"
* entry[1].resource = period-tracking-app-example
* entry[2].fullUrl = "https://example.org/fhir/CodeSystem/example-app-symptom-code-system"
* entry[2].resource = example-app-symptom-code-system
* entry[3].fullUrl = "https://example.org/fhir/Observation/status-present-2026-05-14"
* entry[3].resource = status-present-2026-05-14
* entry[4].fullUrl = "https://example.org/fhir/Observation/flow-heavy-2026-05-14"
* entry[4].resource = flow-heavy-2026-05-14
* entry[5].fullUrl = "https://example.org/fhir/Observation/cramps-2026-05-14"
* entry[5].resource = cramps-2026-05-14
* entry[6].fullUrl = "https://example.org/fhir/Observation/pain-7-2026-05-14"
* entry[6].resource = pain-7-2026-05-14
* entry[7].fullUrl = "https://example.org/fhir/Observation/temperature-2026-05-14"
* entry[7].resource = temperature-2026-05-14
* entry[8].fullUrl = "https://example.org/fhir/Observation/mood-stressed-2026-05-14"
* entry[8].resource = mood-stressed-2026-05-14
* entry[9].fullUrl = "https://example.org/fhir/Observation/custom-symptom-2026-05-14"
* entry[9].resource = custom-symptom-2026-05-14
* entry[10].fullUrl = "https://example.org/fhir/Observation/day-panel-2026-05-14"
* entry[10].resource = day-panel-2026-05-14
* entry[11].fullUrl = "https://example.org/fhir/Observation/status-present-2026-05-15"
* entry[11].resource = status-present-2026-05-15
* entry[12].fullUrl = "https://example.org/fhir/Observation/flow-moderate-2026-05-15"
* entry[12].resource = flow-moderate-2026-05-15
* entry[13].fullUrl = "https://example.org/fhir/Observation/headache-2026-05-15"
* entry[13].resource = headache-2026-05-15
* entry[14].fullUrl = "https://example.org/fhir/Observation/pain-4-2026-05-15"
* entry[14].resource = pain-4-2026-05-15
* entry[15].fullUrl = "https://example.org/fhir/Observation/day-panel-2026-05-15"
* entry[15].resource = day-panel-2026-05-15
* entry[16].fullUrl = "https://example.org/fhir/Observation/status-absent-2026-05-20"
* entry[16].resource = status-absent-2026-05-20
* entry[17].fullUrl = "https://example.org/fhir/Observation/day-panel-2026-05-20"
* entry[17].resource = day-panel-2026-05-20
* entry[18].fullUrl = "https://example.org/fhir/Binary/native-source-json-example"
* entry[18].resource = native-source-json-example
* entry[19].fullUrl = "https://example.org/fhir/Provenance/export-provenance-example"
* entry[19].resource = export-provenance-example
