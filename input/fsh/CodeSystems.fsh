CodeSystem: PeriodTrackingMvpCodeSystem
Id: cycle
Title: "Period Tracking MVP Codes"
Description: "The seven provisional concepts required by the MVP. These cover the daily grouping construct and the source-style ordinal menstrual-flow scale; all other normalized concepts use standard terminology or app-native codes."
* ^caseSensitive = true
* ^content = #complete
* ^experimental = true
* #daily-tracking-panel "Daily tracking panel" "Groups independently meaningful facts associated with one source calendar date."
* #menstrual-flow "Patient-reported menstrual flow category" "An uncalibrated ordinal menstrual-flow category selected in a tracking application."
* #flow-none "None" "The user explicitly selected no menstrual flow."
* #flow-spotting "Spotting" "The user selected the application's spotting flow category."
* #flow-light "Light" "The user selected the application's light flow category."
* #flow-moderate "Moderate" "The user selected the application's middle or moderate flow category."
* #flow-heavy "Heavy" "The user selected the application's highest or heavy flow category. This does not assert measured blood loss or clinical hemorrhage."
