# Clinical display contract

A receiving application can remain lightweight. It does not need to display raw FHIR by default or understand the native Binary.

## Required MVP view

A conforming MVP viewer SHOULD provide:

1. **Context header** — patient-selected identity, source app, date range, and “patient-generated/self-reported” label.
2. **Cycle-aligned rows** — observed period days and flow intensity across recent cycles.
3. **Pain and symptom overlay** — numeric pain when available and a restrained set of recurring symptoms.
4. **Exact-day detail** — calendar date, source facts, source labels, and diary note.
5. **Data completeness statement** — dates with records and categories with observations; never infer symptom absence from missing data.
6. **Copy-ready note** — a descriptive documentation snippet that remains editable.

## Viewer-derived measures

The viewer MAY calculate:

- observed period episodes;
- intervals between observed starts;
- bleeding duration;
- median and range of cycle intervals;
- counts of heavy-rated days;
- pain days and peak numeric pain; and
- symptom timing relative to observed menstruation.

The calculation method, included dates, and missing-data assumptions SHOULD be visible or inspectable. Derived results are display artifacts in version 0.1.0 and are not required to be added to the exchanged Bundle.

## Presentation restraint

The default screen should use no more than:

- five headline measures;
- six recent cycle rows;
- four neutral “patterns to review”; and
- three symptom tracks.

Avoid diagnostic labels, composite menstrual-health scores, or converting ordinal flow to blood-loss volume.

## Suggested documentation text

```text
Reviewed patient-generated period tracking data from [source app] covering
[start] through [end]. Observed cycle interval was median [X] days
(range [A–B]); bleeding duration was median [Y] days. The patient selected
“heavy” flow on [N] days, recorded pain up to [P]/10, and reported
[symptoms]. Missing observations were treated as not recorded, not absent.
App predictions were excluded from this summary.
```

The viewer SHALL label the output as descriptive and patient-generated. It SHALL NOT create a diagnosis or assert causality.

## Illustrative screen

The following synthetic mock-up shows the intended visual density and hierarchy. It is not a required rendering.

![Synthetic clinician-facing period tracking summary](clinician-summary-mockup.png)
