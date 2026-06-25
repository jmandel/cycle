CodeSystem: PeriodTrackingMvpCodeSystem
Id: cycle
Title: "Period Tracking MVP Codes"
Description: "The eight provisional concepts required by the MVP. These cover the universal bleeding core fact, the optional source-style ordinal menstrual-flow scale, and the generic symptom fact code."
* ^caseSensitive = true
* ^content = #complete
* ^experimental = true
* #menstrual-bleeding "Menstrual bleeding" "Whether the source reports menstrual bleeding at the associated date or timestamp. This is the universal bleeding core fact; true and false are both meaningful only when explicitly recorded or reliably represented by the source."
* #menstrual-flow "Patient-reported menstrual flow category" "An uncalibrated ordinal menstrual-flow category selected in a tracking application."
* #symptom "Symptom" "A symptom reported, selected, or otherwise represented by a tracking application. The specific symptom is carried in Observation.valueCodeableConcept."
* #flow-none "None" "The user explicitly selected no menstrual flow."
* #flow-spotting "Spotting" "The user selected the application's spotting flow category."
* #flow-light "Light" "The user selected the application's light flow category."
* #flow-moderate "Moderate" "The user selected the application's middle or moderate flow category."
* #flow-heavy "Heavy" "The user selected the application's highest or heavy flow category. This does not assert measured blood loss or clinical hemorrhage."
