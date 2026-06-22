Invariant: ptmvp-bundle-patient
Description: "A Period Tracking MVP Bundle SHALL contain exactly one Patient resource."
Expression: "entry.resource.ofType(Patient).count() = 1"
Severity: #error

Invariant: ptmvp-bundle-device
Description: "A Period Tracking MVP Bundle SHALL contain at least one Device identifying a source application."
Expression: "entry.resource.ofType(Device).exists()"
Severity: #error

Invariant: ptmvp-bundle-observation
Description: "A Period Tracking MVP Bundle SHALL contain at least one Observation."
Expression: "entry.resource.ofType(Observation).exists()"
Severity: #error


Invariant: ptmvp-bundle-panel
Description: "A Period Tracking MVP Bundle SHALL contain at least one Daily Tracking Panel Observation."
Expression: "entry.resource.ofType(Observation).where(code.coding.where(system = 'https://fhir.me/cycle/CodeSystem/cycle' and code = 'daily-tracking-panel').exists()).exists()"
Severity: #error

Invariant: ptmvp-bundle-fact
Description: "A Period Tracking MVP Bundle SHALL contain at least one granular fact Observation in addition to its daily panels."
Expression: "entry.resource.ofType(Observation).where(code.coding.where(system = 'https://fhir.me/cycle/CodeSystem/cycle' and code = 'daily-tracking-panel').empty()).exists()"
Severity: #error

Invariant: ptmvp-bundle-provenance
Description: "A Period Tracking MVP Bundle SHALL contain at least one Provenance resource describing assembly of the export."
Expression: "entry.resource.ofType(Provenance).exists()"
Severity: #error

Invariant: ptmvp-panel-content
Description: "A Daily Tracking Panel SHALL contain at least one member fact or at least one diary note."
Expression: "hasMember.exists() or note.exists()"
Severity: #error

Profile: PeriodTrackingBundle
Parent: Bundle
Id: period-tracking-bundle
Title: "Period Tracking MVP Bundle"
Description: "A self-contained FHIR R4 collection Bundle for transporting granular patient-generated period-tracking facts, daily panels, source application identity, provenance, and an optional native JSON archive."
* obeys ptmvp-bundle-patient and ptmvp-bundle-device and ptmvp-bundle-observation and ptmvp-bundle-panel and ptmvp-bundle-fact and ptmvp-bundle-provenance
* identifier 1..1 MS
* type = #collection
* timestamp 1..1 MS
* total 0..0
* link 0..0
* entry 1..* MS
* entry.fullUrl 1..1 MS
* entry.resource 1..1 MS
* entry.search 0..0
* entry.request 0..0
* entry.response 0..0
* signature MS

Profile: PeriodTrackingFactObservation
Parent: Observation
Id: period-tracking-fact
Title: "Period Tracking Fact Observation"
Description: "One independently meaningful, granular fact entered, selected, verified, or measured in a period-tracking application. The MVP supports coded, quantitative, boolean, and textual results without requiring a distinct profile for every fact type."
* status = #final
* category 1..1 MS
* category from PtmvpFactCategoryVS (required)
* code 1..1 MS
* subject 1..1 MS
* subject only Reference(Patient)
* effective[x] 1..1 MS
* effective[x] only dateTime
* issued MS
* performer 1..1 MS
* performer only Reference(Patient)
* value[x] 1..1 MS
* value[x] only Quantity or CodeableConcept or string or boolean
* dataAbsentReason 0..0
* interpretation MS
* note MS
* bodySite MS
* method MS
* specimen 0..0
* device 1..1 MS
* device only Reference(Device)
* referenceRange 0..0
* hasMember 0..0
* derivedFrom 0..0
* component 0..0

Profile: DailyTrackingPanelObservation
Parent: Observation
Id: daily-tracking-panel
Title: "Daily Tracking Panel Observation"
Description: "Groups the independently meaningful fact Observations associated with one source calendar date. A missing member means not recorded, not absent. A free-text diary note may be carried in Observation.note, including on a note-only day."
* obeys ptmvp-panel-content
* status = #final
* category 1..1 MS
* category = $ObsCat#survey "Survey"
* code = $CycleCS#daily-tracking-panel "Daily tracking panel"
* subject 1..1 MS
* subject only Reference(Patient)
* effective[x] 1..1 MS
* effective[x] only dateTime
* issued MS
* performer 1..1 MS
* performer only Reference(Patient)
* value[x] 0..0
* dataAbsentReason 0..0
* interpretation 0..0
* note MS
* bodySite 0..0
* method 0..0
* specimen 0..0
* device 1..1 MS
* device only Reference(Device)
* referenceRange 0..0
* hasMember 0..* MS
* hasMember only Reference(PeriodTrackingFactObservation)
* derivedFrom 0..0
* component 0..0
