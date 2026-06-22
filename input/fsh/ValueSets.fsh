ValueSet: MenstrualFlowValueSet
Id: menstrual-flow
Title: "Menstrual Flow"
Description: "Uncalibrated, patient-reported ordinal flow categories used by period-tracking applications."
* ^experimental = true
* include $CycleCS#flow-none
* include $CycleCS#flow-spotting
* include $CycleCS#flow-light
* include $CycleCS#flow-moderate
* include $CycleCS#flow-heavy

ValueSet: CommonTrackerSymptomsVS
Id: common-tracker-symptoms
Title: "Common Period-Tracking Symptoms"
Description: "A small, non-normative starter set of SNOMED CT findings that period-tracking applications commonly record, offered so implementers can bootstrap a consistent symptom vocabulary. It is NOT a closed or required binding: a fact's symptom value MAY use any SNOMED CT finding when the meaning is exact, or the app-native escape hatch (CodeableConcept.text or a stable app CodeSystem) otherwise."
* ^experimental = true
* $SCT#431416001 "Menstrual cramp (finding)"
* $SCT#25064002 "Headache (finding)"
* $SCT#84229001 "Fatigue (finding)"
* $SCT#116289008 "Abdominal bloating (finding)"
* $SCT#366979004 "Low mood (finding)"
* $SCT#24199005 "Irritability (finding)"
* $SCT#73595000 "Stress (finding)"
* $SCT#71315007 "Dyspareunia (finding)"

ValueSet: PtmvpFactCategoryVS
Id: ptmvp-fact-category
Title: "Period Tracking Fact Categories"
Description: "Allowed Observation.category values for a Period Tracking Fact. Patient-reported facts use 'survey'; a fact carrying a FHIR vital-sign code (for example basal body temperature, LOINC 8310-5) instead uses 'vital-signs' so it conforms to the mandatory FHIR vital-signs profile."
* ^experimental = false
* $ObsCat#survey "Survey"
* $ObsCat#vital-signs "Vital Signs"
