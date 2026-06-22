# Adapter guidance for the five surveyed applications

The common output is intentionally independent of native persistence design. Each adapter should create an immutable, profile-scoped snapshot before normalization.

## Ovumcy Web

**Native model:** one wide `DailyLog` row per user and date, with period fields, flow, symptoms, mood, temperature, fertility fields, sexual activity, factors, and notes.

**MVP adapter:**

- create one daily panel for each selected `DailyLog` that produces at least one fact or note;
- map `IsPeriod` only when the application can establish that it is an entered assertion rather than a row default;
- map `Flow` to the MVP flow values;
- resolve `SymptomIDs` through `SymptomType` and use SNOMED CT only for reviewed exact mappings;
- map nonzero BBT to LOINC body temperature with basal method;
- place the daily note on the panel; and
- retain uncertainty, cycle factors, fertility detail, and all unnormalized fields in the native Binary.

`CycleStart`, cached period dates, and configured typical lengths are not granular observed facts in the MVP.

## drip

**Native model:** one Realm `CycleDay` object per date with optional nested category objects.

**MVP adapter:**

- absence of a category object means not recorded;
- map bleeding integers 0–3 to spotting, light, moderate, and heavy;
- retain every `exclude` flag in the native Binary; it does not negate the observation;
- map pain presence flags to separate symptom facts;
- map a real numeric pain score only if a later source version collects one;
- preserve temperature time when present; and
- do not export cached `isCycleStart` or predictions as observed facts.

The adapter should translate numeric source enums through the exact schema-version vocabulary rather than interpreting bare integers externally.

## Oky

**Native model:** encrypted, user-keyed Redux state with date-keyed daily cards, tri-state verified period dates, notes, and separately persisted prediction state.

**MVP adapter:**

- run only after redux-persist rehydration and migration;
- scope extraction to the current local profile before reading any dates;
- normalize both legacy single-string and current array card shapes;
- map `periodDay = true` to menstrual bleeding present and `periodDay = false` to explicitly not menstruating;
- do not emit a status for `periodDay = null` or an absent key;
- map flow, body symptoms, and mood from daily cards; and
- exclude prediction state from granular facts while preserving it in the native Binary if selected.

The server-side snapshot is not a complete source for Oky diary cards and notes; the sharing adapter must run in the app.

## Menstrudel

**Native model:** normalized SQLite tables for daily period logs and symptoms plus independent timed tables for pills, contraception, sexual activity, and menstrual products. Period episodes are materialized from daily flow logs.

**MVP adapter:**

- treat `period_logs` and linked symptoms as canonical granular inputs;
- map every non-null flow value, including explicit `none` when it was actually selected;
- preserve null pain as not recorded and numeric zero as explicit no pain;
- map ordinal pain using LOINC `38208-5` and a standard or native coded value;
- do not export the materialized `periods` table as raw fact; and
- retain pill, contraception, sexual activity, product events, and the materialized period table in the native Binary for MVP completeness.

## Mensinator

**Native model:** sparse period-date rows, date-to-symptom links, a mutable symptom dictionary, and separate ovulation dates. Flow is represented by ordinary symptom dictionary entries.

**MVP adapter:**

- a period-date row maps to menstrual bleeding present;
- absence of a period row does not map to not menstruating;
- map the original built-in Heavy, Medium, and Light flow dictionary entries only when their identities remain unambiguous;
- if more than one flow tag appears on a date, preserve the ambiguity in native data rather than choosing a value;
- map each non-flow symptom link to a separate symptom Observation; and
- preserve inactive dictionary entries and full names in the native Binary.

Period group IDs and runtime predictions are not granular observed facts.

## Shared adapter interface

```text
readSelectedNativeSnapshot(scope)
    → immutable native JSON

normalizeCoreFacts(snapshot)
    → Patient + Device + facts + daily panels

assembleBundle(normalized, optionalNativeBinary, provenance)
    → PeriodTrackingBundle
```

The preview presented to the user should be generated from the same immutable snapshot that is encrypted and shared.
