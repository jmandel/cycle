---
name: period-tracking-fhir-sharing
description: Add standards-based menstrual/cycle data sharing to a period-, fertility-, or cycle-tracking app using the Period Tracking MVP FHIR IG — export tracked data as a FHIR R4 Bundle, share it as an encrypted SMART Health Link (SHL), and render it in a privacy-preserving client-side viewer. Use this whenever you are adding FHIR export, "share with my doctor / clinician", QR-code or link sharing of cycle data, SMART Health Link / shlink support, an interoperability or data-portability feature, or a clinician-facing summary to any app that tracks periods, menstrual flow, symptoms, fertility (BBT/LH/cervical mucus), or contraception — even if the user only says "let me export my data" or "share my cycle history."
---

# Period Tracking FHIR Sharing

Help an app turn the cycle data it already stores into a **FHIR R4 Bundle**, share that bundle as an **encrypted SMART Health Link** the user controls, and (optionally) render it in a **client-side clinician viewer**. The authoritative model is the published **Period Tracking MVP Implementation Guide**:

> **IG home:** https://build.fhir.org/ig/jmandel/periodicity/

Always consult the IG for the normative details — this skill is the working method and the glue; the IG is the source of truth for profiles, codes, and conformance.

## Operating rule: drive from the app's real data

Map only what the app actually stores. Read the app's data model, storage, exports, UI, and tests **before** deciding what to map. Do not invent fields the app does not have, and do not emit app *predictions*, *derived caches*, or *unedited defaults* as clinical facts. When normalization is uncertain, preserve the native value (and optionally keep a full native snapshot — see "Complete export" below) rather than guessing.

This restraint is the whole point: the data is sensitive (reproductive, sexual, fertility, mental-health), and a clinician must be able to trust that every fact reflects something the user actually entered, selected, measured, or verified.

## Workflow

1. **Set criteria first.** Write a short success checklist before coding: which sharing flow (a downloaded file? a QR/link? a viewer link?), the privacy boundary (where plaintext may exist and where it must not), demo-data needs, viewer behavior, and verification steps. Note explicit non-goals.

2. **Inventory the app.** Identify stored daily facts (flow, bleeding/period status, pain, symptoms, mood, temperature, fertility signs, notes), custom/user-defined symptom labels, predicted/derived/defaulted fields, existing exports, the auth/ownership boundary, and demo-seed and test conventions. Reuse the app's existing repositories, serializers, and build tools.

3. **Classify every candidate field** into one of: `user-entered` (selected/entered/verified/measured/imported) → map it; `derived` (calculated from facts) → usually omit, or mark provenance; `prediction` (future/probabilistic) → **do not** emit as an observed fact; `default` (UI/schema default, not user intent) → do not emit; `configuration` (goals, reminders, prefs) → out of scope; `not-stored` → cannot map. Only `user-entered` becomes a clinical fact.

4. **Map to the IG model** (`references/fhir-mapping.md`). Build a `period-tracking-bundle` containing one Patient, a source-app Device, per-day `daily-tracking-panel` Observations that group the day's `period-tracking-fact` Observations via `hasMember`, and a Provenance. Use the common-core standard codes; reach for the app-native escape hatch only for genuinely app-specific concepts.

5. **Honor the missing-data rules** (in the IG `scope.md` and `references/fhir-mapping.md`). "User explicitly said none/no" (an explicit negative) is a *different fact* from "not recorded that day" (emit nothing). Never fabricate negatives from absence.

6. **Share as a SMART Health Link** (`references/smart-health-links.md`). Pick a ciphertext host that fits the app's architecture: a static object, the app's own backend, or the Kill the Clipboard companion server when the app has no natural SHLink host. Encrypt the bundle and produce a `shlink:/…` (usually behind a viewer prefix, often as a QR). The host only ever sees ciphertext; the key rides in the link fragment.

7. **Render it** (`references/viewer.md`). Either point at an existing viewer (the IG ships one) or embed a small client-side viewer that decrypts in the browser and computes the summary from the granular facts — never send decrypted FHIR back to a server.

8. **Verify end to end.** Validate the Bundle against the IG; round-trip encrypt→decrypt; confirm the viewer renders; confirm the host never receives plaintext or the key. Keep a journal of mapping decisions and deferred fields (`references/journal-templates.md`).

## The data model in one screen

- **Bundle** (`period-tracking-bundle`): a `collection` with `identifier` + `timestamp`, exactly one Patient, ≥1 source Device, ≥1 daily panel, ≥1 granular fact, ≥1 Provenance. Optionally a `Binary` native snapshot.
- **Daily panel** (`daily-tracking-panel`): `Observation`, code `https://fhir.me/cycle/CodeSystem/cycle#daily-tracking-panel`, `effectiveDateTime` = the calendar date, `hasMember` → the day's facts, optional `note` (free-text diary). A panel exists only for a day with ≥1 fact or a note.
- **Fact** (`period-tracking-fact`): one independently meaningful `Observation` — a question `code` + a `value` + `subject`/`performer` = Patient + `device`. Category `survey` (or `vital-signs` for temperature).

Common-core facts (full table in `references/fhir-mapping.md`):

| Fact | code | value |
|---|---|---|
| Menstrual flow | `cycle#menstrual-flow` | coded `flow-none\|spotting\|light\|moderate\|heavy` |
| Menstrual status | LOINC `8678-5` | SNOMED `289894009` present / `289895005` not-menstruating |
| Pain (0–10) | LOINC `72514-3` | Quantity `{score}` |
| Symptom | LOINC `75325-1` | a SNOMED finding (or app-native code/text) |
| Mood | LOINC `80296-7` | a SNOMED finding |
| Basal body temperature | LOINC `8310-5` | Quantity `Cel`, category `vital-signs` |

Flow intensity (`menstrual-flow`) and "is this a period" (`menstrual-status`) are **separate**: spotting without a period status is intermenstrual bleeding. The receiver derives episodes, cycle lengths, and medians from the facts — summaries do **not** travel in the bundle.

## Choosing how to share

Follow the IG packaging guidance in `input/pagecontent/smart-health-links.md` (published as `smart-health-links.html`). It defines the Period Tracking MVP share shape, lifetime expectations, and use-limit guidance. Use `references/smart-health-links.md` only for implementation notes, local scripts, and host choices such as static files, app backends, or the KTC companion server.

## References

Read these as needed; don't load them all up front.

- `references/fhir-mapping.md` — the concrete fact-by-fact mapping, terminology, flow/missing-data rules, and a worked bundle to copy from. **Read before building the export.**
- `input/pagecontent/smart-health-links.md` — the normative Period Tracking MVP SHLink packaging guidance. **Read before building sharing.**
- `references/smart-health-links.md` — implementation notes, viewer-prefix + QR details, and local scripts that support the packaging guidance. **Use after reading the packaging page.**
- `references/viewer.md` — how the reference client-side viewer works (decrypt → transform → render) and how to reuse or embed it. **Read before building a viewer.**
- `references/journal-templates.md` — lightweight plan / journal / mapping-issue templates to keep in the target repo.

## What "done" looks like

The app can demonstrate the patient→clinician path end to end: a FHIR Bundle built from real stored data, validated against the IG; an encrypted SHL the user can share (link or QR); a client-side render of the summary; and a verified privacy boundary (the host never sees plaintext or the key). Mapping decisions, intentionally omitted fields, and any incompatibilities are written down.
