Invariant: ptmvp-bundle-bleeding-core
Description: "A Period Tracking Bundle SHALL contain at least one menstrual bleeding core fact."
Expression: "entry.resource.ofType(Observation).where(code.coding.where(system = 'https://cycle.fhir.me/CodeSystem/cycle' and code = 'menstrual-bleeding').exists() and value.exists()).exists()"
Severity: #error

Profile: PeriodTrackingBundle
Parent: Bundle
Id: period-tracking-bundle
Title: "Period Tracking Bundle"
Description: "A self-contained FHIR R4 collection Bundle for transporting granular patient-generated period-tracking facts scoped to one person. It contains at least one Layer 0 menstrual bleeding fact. Patient and Device resources are optional."
* obeys ptmvp-bundle-bleeding-core
* identifier MS
* identifier ^short = "Optional export identifier"
* identifier ^definition = "A stable identifier for this exported collection when the producing app has one. It is not required for anonymous or one-off shares."
* type = #collection
* type ^short = "Bundle type is collection"
* type ^definition = "Period Tracking exports are self-contained collection Bundles, not transaction, batch, or document Bundles."
* timestamp MS
* timestamp ^short = "When the export Bundle was assembled"
* timestamp ^definition = "The time the producing system assembled this export Bundle."
* entry 1..* MS
* entry ^short = "Resources included in the export"
* entry ^definition = "The Bundle entries carrying the period-tracking Observations and any optional Patient, Device, or native-archive resources included by the producer."
* entry.fullUrl MS
* entry.fullUrl ^short = "Stable intra-Bundle reference URL"
* entry.fullUrl ^definition = "A fullUrl that allows entries in this self-contained Bundle to reference each other consistently."
* entry.resource 1..1 MS
* entry.resource ^short = "Included FHIR resource"
* entry.resource ^definition = "The FHIR resource included in this Bundle entry."
* signature MS
* signature ^short = "Optional FHIR Bundle signature"
* signature ^definition = "An optional FHIR Bundle signature when the producing system signs the export. SHLink encryption is handled outside the Bundle."

Profile: PeriodTrackingFact
Parent: Observation
Id: period-tracking-fact
Title: "Period Tracking Fact"
Description: "Abstract base profile for one independently meaningful fact entered, selected, verified, or measured in a period-tracking application. Concrete facts may be day-scoped or timestamp-scoped at producer discretion; clients can group facts by local date for display."
* ^abstract = true
* status = #final
* status ^short = "Only final facts are exported"
* status ^definition = "Period Tracking exports include finalized facts. Producers omit draft, preliminary, entered-in-error, and amended records from the shared Bundle."
* category from PtmvpFactCategoryVS (required)
* code 1..1 MS
* code ^short = "Period-tracking fact type"
* code ^definition = "Identifies the kind of fact represented by this Observation, such as menstrual bleeding, menstrual flow, symptom, numeric pain severity, or basal body temperature."
* subject 0..1 MS
* subject only Reference(Patient)
* subject ^short = "Optional person reference"
* subject ^definition = "Optional reference to the Patient resource for the person whose period-tracking data is represented. The Bundle is still scoped to one person when Patient resources and subject references are omitted."
* effective[x] 1..1 MS
* effective[x] only dateTime
* effectiveDateTime 1..1 MS
* effectiveDateTime ^short = "Date or timestamp for the source fact"
* effectiveDateTime ^definition = "The date or time associated with the source fact. Producers MAY use date precision (for example, 2026-06-24) when the source stores a calendar-day fact, or full timestamp precision when the source stores a specific time. Producers SHALL NOT invent a time solely to satisfy this profile."
* value[x] 1..1 MS
* value[x] only Quantity or CodeableConcept or string or boolean
* value[x] ^short = "Recorded fact value"
* value[x] ^definition = "The value recorded by the source application for this fact. Concrete profiles narrow this to the appropriate FHIR value type."
* device 0..1 MS
* device only Reference(Device)
* device ^short = "Optional source application or device"
* device ^definition = "Optional reference to a Device resource that identifies the source application, wearable, thermometer, or other system that produced or measured this fact."

Profile: MenstrualBleeding
Parent: PeriodTrackingFact
Id: menstrual-bleeding
Title: "Menstrual Bleeding"
Description: "Layer 0 required core fact: whether the source reports menstrual bleeding for the stated date or timestamp. Both true and false are meaningful only when explicitly recorded or reliably represented by the source."
* code = $CycleCS#menstrual-bleeding "Menstrual bleeding"
* code ^short = "Menstrual bleeding fact"
* code ^definition = "Identifies this Observation as the Layer 0 menstrual bleeding fact."
* value[x] only boolean
* valueBoolean 1..1 MS
* valueBoolean ^short = "Bleeding was or was not recorded"
* valueBoolean ^definition = "True means the source reports menstrual bleeding for the stated date or timestamp. False means the source explicitly records or reliably represents no menstrual bleeding for the stated date or timestamp. Missing data is not encoded as false."

Profile: MenstrualFlow
Parent: PeriodTrackingFact
Id: menstrual-flow
Title: "Menstrual Flow"
Description: "Layer 1 optional intensity fact for an app's uncalibrated menstrual-flow category. This fact does not replace the Layer 0 menstrual bleeding boolean core fact."
* code = $CycleCS#menstrual-flow "Patient-reported menstrual flow category"
* code ^short = "Menstrual flow intensity fact"
* code ^definition = "Identifies this Observation as a Layer 1 menstrual flow intensity fact."
* value[x] only CodeableConcept
* valueCodeableConcept 1..1 MS
* valueCodeableConcept ^short = "Source flow category"
* valueCodeableConcept ^definition = "The source application's ordinal flow category. These categories are not calibrated to volume and do not replace the Layer 0 menstrual bleeding boolean."
* valueCodeableConcept from MenstrualFlowValueSet (required)

Profile: Symptom
Parent: PeriodTrackingFact
Id: symptom
Title: "Symptom"
Description: "Layer 1 optional symptom fact. The Observation code identifies the fact as a symptom report; the value identifies the specific symptom using an exact standard concept when available or an app-native concept when not."
* code = $CycleCS#symptom "Symptom"
* code ^short = "Symptom fact"
* code ^definition = "Identifies this Observation as a Layer 1 symptom fact."
* value[x] only CodeableConcept
* valueCodeableConcept 1..1 MS
* valueCodeableConcept ^short = "Specific symptom"
* valueCodeableConcept ^definition = "The specific symptom represented by the source application, using an exact standard concept when available or an app-native CodeableConcept when not."
* valueCodeableConcept from CommonTrackerSymptomsVS (preferred)

Profile: NumericPainSeverity
Parent: PeriodTrackingFact
Id: numeric-pain-severity
Title: "Numeric Pain Severity"
Description: "Layer 1 optional numeric pain fact for a source 0-10 patient-reported pain score. Do not map ordinal labels such as mild, severe, or unbearable into this profile unless the source actually stores a numeric 0-10 rating."
* code = $LNC#72514-3 "Pain severity - 0-10 verbal numeric rating [Score] - Reported"
* code ^short = "Numeric pain severity fact"
* code ^definition = "Identifies this Observation as a patient-reported 0-10 numeric pain severity fact."
* value[x] only Quantity
* valueQuantity 1..1 MS
* valueQuantity ^short = "0-10 pain score"
* valueQuantity ^definition = "The numeric 0-10 pain score recorded by the source. Do not map ordinal labels into this profile unless the source actually stores a numeric 0-10 rating."

Profile: BasalBodyTemperature
Parent: PeriodTrackingFact
Id: basal-body-temperature
Title: "Basal Body Temperature"
Description: "Layer 1 optional basal body temperature fact for a source temperature measurement identified by the producer as basal."
* category 1..1
* category = $ObsCat#vital-signs "Vital Signs"
* code = $LNC#8310-5 "Body temperature"
* code ^short = "Basal body temperature fact"
* code ^definition = "Identifies this Observation as a basal body temperature measurement represented with the standard FHIR body temperature code."
* value[x] only Quantity
* valueQuantity 1..1 MS
* valueQuantity ^short = "Temperature measurement"
* valueQuantity ^definition = "The temperature measurement recorded by the source application and identified by the producer as basal."
