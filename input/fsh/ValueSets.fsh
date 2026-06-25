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
Description: "A small, non-normative starter set of period-tracking symptoms that applications commonly record, offered so implementers can bootstrap a consistent symptom vocabulary. It includes SNOMED CT findings where the fit is exact enough. It is NOT a closed or required binding: a fact's symptom value MAY use any SNOMED CT finding when the meaning is exact or the app-native escape hatch (CodeableConcept.text or a stable app CodeSystem) otherwise."
* ^experimental = true
* $SCT#431416001 "Menstrual cramp"
* $SCT#25064002 "Headache"
* $SCT#84229001 "Fatigue"
* $SCT#116289008 "Abdominal bloating"
* $SCT#366979004 "Depressed mood"
* $SCT#55929007 "Feeling irritable"
* $SCT#73595000 "Stress"
* $SCT#71315007 "Dyspareunia"

ValueSet: PtmvpFactCategoryVS
Id: ptmvp-fact-category
Title: "Period Tracking Fact Categories"
Description: "Allowed Observation.category values for a Period Tracking Fact. Patient-reported facts use 'survey'; a fact carrying a FHIR vital-sign code (for example basal body temperature, LOINC 8310-5) instead uses 'vital-signs' so it conforms to the mandatory FHIR vital-signs profile."
* ^experimental = false
* $ObsCat#survey "Survey"
* $ObsCat#vital-signs "Vital Signs"
