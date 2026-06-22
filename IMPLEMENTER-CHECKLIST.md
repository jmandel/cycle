# MVP implementer checklist

## Source extraction

- [ ] Extract from one immutable, user-approved snapshot.
- [ ] Scope to the selected local profile and date range before normalization.
- [ ] Preserve source application, version, schema version, and stable identifiers.
- [ ] Distinguish explicit negatives from defaults and missing categories.
- [ ] Keep predictions and cached episode state out of granular observed facts.

## FHIR construction

- [ ] Exactly one Patient in the Bundle.
- [ ] At least one source-application Device.
- [ ] One standalone Observation per independently meaningful fact.
- [ ] One daily panel per date with at least one fact or shared note.
- [ ] Use LOINC for supported observation names and SNOMED CT for exact findings.
- [ ] Use app-native coding/text rather than an approximate standard code.
- [ ] Use the seven project codes only for daily grouping and flow.
- [ ] Include Provenance.
- [ ] Include native Binary when claiming complete export and residual source data exist.

## Privacy and SHL

- [ ] Preview and encrypted payload come from the same snapshot.
- [ ] Generate encryption key and QR locally.
- [ ] Upload ciphertext only.
- [ ] No plaintext health data or keys in logs or analytics.
- [ ] Allow date/category selection and disclose native Binary inclusion.

## Validation

- [ ] SUSHI has zero errors.
- [ ] IG Publisher build completes.
- [ ] `scripts/check_mvp.py` passes.
- [ ] Terminology check passes against licensed distributions.
- [ ] Independent receiver opens and renders the SMART Health Link.
