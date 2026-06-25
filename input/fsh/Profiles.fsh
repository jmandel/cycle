Invariant: ptmvp-bundle-bleeding-core
Description: "A Period Tracking MVP Bundle SHALL contain at least one menstrual bleeding core fact."
Expression: "entry.resource.ofType(Observation).where(code.coding.where(system = 'https://cycle.fhir.me/CodeSystem/cycle' and code = 'menstrual-bleeding').exists() and value.exists()).exists()"
Severity: #error

Profile: PeriodTrackingBundle
Parent: Bundle
Id: period-tracking-bundle
Title: "Period Tracking MVP Bundle"
Description: "A self-contained FHIR R4 collection Bundle for transporting granular patient-generated period-tracking facts scoped to one person. Patient and Device resources are optional."
* obeys ptmvp-bundle-bleeding-core
* identifier MS
* type = #collection
* timestamp MS
* entry 1..* MS
* entry.fullUrl MS
* entry.resource 1..1 MS
* signature MS

Profile: PeriodTrackingFactObservation
Parent: Observation
Id: period-tracking-fact
Title: "Period Tracking Fact Observation"
Description: "Abstract base profile for one independently meaningful fact entered, selected, verified, or measured in a period-tracking application. Concrete facts may be day-scoped or timestamp-scoped at producer discretion; clients can group facts by local date for display."
* ^abstract = true
* status = #final
* category MS
* category from PtmvpFactCategoryVS (required)
* code 1..1 MS
* subject 0..1 MS
* effective[x] 1..1 MS
* effective[x] only dateTime
* effectiveDateTime 1..1 MS
* effectiveDateTime ^short = "Date or timestamp for the source fact"
* effectiveDateTime ^definition = "The date or time associated with the source fact. Producers MAY use date precision (for example, 2026-06-24) when the source stores a calendar-day fact, or full timestamp precision when the source stores a specific time. Producers SHALL NOT invent a time solely to satisfy this profile."
* issued MS
* value[x] 1..1 MS
* value[x] only Quantity or CodeableConcept or string or boolean
* interpretation MS
* bodySite MS
* method MS
* device 0..1 MS

Profile: MenstrualBleedingFactObservation
Parent: PeriodTrackingFactObservation
Id: menstrual-bleeding-fact
Title: "Menstrual Bleeding Fact Observation"
Description: "The required core fact: whether the source reports menstrual bleeding for the stated date or timestamp. Both true and false are meaningful only when explicitly recorded or reliably represented by the source."
* code = $CycleCS#menstrual-bleeding "Menstrual bleeding"
* value[x] only boolean
* valueBoolean 1..1 MS

Profile: MenstrualFlowFactObservation
Parent: PeriodTrackingFactObservation
Id: menstrual-flow-fact
Title: "Menstrual Flow Fact Observation"
Description: "Optional intensity layer for an app's uncalibrated menstrual-flow category. This layer does not replace the menstrual bleeding boolean core fact."
* code = $CycleCS#menstrual-flow "Patient-reported menstrual flow category"
* value[x] only CodeableConcept
* valueCodeableConcept 1..1 MS
* valueCodeableConcept from MenstrualFlowValueSet (required)

Profile: SymptomFactObservation
Parent: PeriodTrackingFactObservation
Id: symptom-fact
Title: "Symptom Fact Observation"
Description: "Optional symptom layer. The Observation code identifies the fact as a symptom report; the value identifies the specific symptom using an exact standard concept when available or an app-native concept when not."
* code = $CycleCS#symptom "Symptom"
* value[x] only CodeableConcept
* valueCodeableConcept 1..1 MS
* valueCodeableConcept from CommonTrackerSymptomsVS (preferred)

Profile: NumericPainSeverityFactObservation
Parent: PeriodTrackingFactObservation
Id: numeric-pain-severity-fact
Title: "Numeric Pain Severity Fact Observation"
Description: "Optional numeric pain layer for a source 0-10 patient-reported pain score. Do not map ordinal labels such as mild, severe, or unbearable into this profile unless the source actually stores a numeric 0-10 rating."
* code = $LNC#72514-3 "Pain severity - 0-10 verbal numeric rating [Score] - Reported"
* value[x] only Quantity
* valueQuantity 1..1 MS

Profile: BasalBodyTemperatureFactObservation
Parent: PeriodTrackingFactObservation
Id: basal-body-temperature-fact
Title: "Basal Body Temperature Fact Observation"
Description: "Optional basal body temperature layer for a source temperature measurement identified by the producer as basal."
* category 1..1 MS
* category = $ObsCat#vital-signs "Vital Signs"
* code = $LNC#8310-5 "Body temperature"
* value[x] only Quantity
* valueQuantity 1..1 MS
* method 1..1 MS
* method = $SCT#281660007
