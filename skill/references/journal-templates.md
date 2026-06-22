# Journal & planning templates

Keep a light paper trail in the **target app's** repo so mapping decisions are reviewable and reversible. Match the repo's existing doc conventions; these are starting points, not mandates.

## `period-fhir-plan.md`

```markdown
# Period Tracking FHIR support — plan

Goal: <one sentence — what sharing flow we're enabling and for whom>

## Success criteria
- [ ] App data inventory complete (fields classified)
- [ ] FHIR Bundle built from real stored data, validates against the IG
- [ ] Missing-data rules applied (explicit-negative vs not-recorded)
- [ ] Sharing flow works (SHL: <static file | backend | hosted demo>)
- [ ] Client-side viewer renders the summary
- [ ] Privacy boundary verified (host never sees plaintext or key)
- [ ] Demo data seeded (if in scope)
- [ ] Incompatibilities / deferred fields documented

## Non-goals
- <e.g. predictions, summaries, two-way sync>
```

## `period-fhir-journal.md` (append-only)

```markdown
## <date> <short title>
- Read: <files/areas inspected>
- Learned: <how the app stores the relevant data>
- Decisions: <what to map / omit / preserve natively, and why>
- Changed: <code touched>
- Verified: <command + result, or screenshot>
- Open: <unresolved questions / blockers>
```

## `period-fhir-mapping-issues.md` (one entry per concept)

```markdown
### <concept, e.g. "flow intensity">
- Source location: <table/column/model field>
- Source semantics: <what the value actually means; default vs explicit>
- Classification: user-entered | derived | prediction | default | configuration | not-stored
- FHIR treatment: <code + value, per the IG mapping>
- Native preservation: <kept in Binary snapshot? y/n>
- Decision: <final mapping or "deferred: reason">
- Residual risk: <how a clinician might misread it>
```

## Change-management rule

Do not silently drop local data the user expects to keep. For every field, record whether it is **normalized** (mapped to a fact), **native-preserved** (in the Binary snapshot), **deferred**, or **out of scope** — and why. Absence in the export should always be a documented decision, never an accident.
