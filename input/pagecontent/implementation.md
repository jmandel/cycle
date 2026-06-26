# Implementation

Use this page when adding cycle.fhir.me support to a period-, fertility-, or cycle-tracking app. It is the working checklist for product teams and AI agents: inspect the app's real data, map only true stored facts, package them as an encrypted SMART Health Link, and verify the viewer/privacy path end to end.

The [Specification](specification.html) is the source of truth for profiles, codes, and conformance. This page explains how to apply it in an app. It is also packaged for agents as [`skill.zip`](skill.zip); inside that zip, this page becomes `SKILL.md` and the core rendered spec markdown is included under `spec/`.

## Workflow

1. **Set success criteria before coding.** Decide what the demo must prove: date range, categories included, sharing flow, host controls, viewer or scanner target, privacy boundary, sample data, and validation steps.
2. **Confirm product-shaping choices.** Ask for decisions that affect the implementation: viewer-prefixed link versus bare SHLink, ciphertext host, revocation/expiry/use-limit promises, whether to include the native archive, and which sensitive categories are in scope.
3. **Inventory the app.** Read the storage model, serializers, exports, UI, demo data, and tests before mapping. Identify stored bleeding states, flow, symptoms, pain, temperature, custom dictionaries, predictions, defaults, and derived summaries.
4. **Classify every candidate field.** Export user-entered, selected, verified, measured, or imported facts. Do not export predictions, derived caches, untouched defaults, reminders, goals, or data the app does not store.
5. **Build the FHIR Bundle.** Use the [Period Tracking Bundle](StructureDefinition-period-tracking-bundle.html), include at least one Layer 0 [Menstrual Bleeding](StructureDefinition-menstrual-bleeding.html) fact, and add Layer 1 profiles only when the source has those facts.
6. **Apply missing-data rules.** An explicit "none/no" is a fact. An untouched default or absent row is not. Never fabricate negatives from missing data.
7. **Encrypt and share.** Package the Bundle as a SMART Health Link direct-file share. Prefer a viewer-prefixed URL for ordinary phone-camera UX, but keep the `shlink:/...` value in the fragment after `#`.
8. **Render locally.** A viewer or provider scanner decrypts client-side and computes summaries from granular facts. Do not send decrypted FHIR back to a server.
9. **Verify end to end.** Validate the Bundle, round-trip encrypt/decrypt, scan or open the link, render the viewer, and confirm the host never receives plaintext or the key.

## FHIR mapping

Start with the [adoption layers](specification.html#adoption-layers): Layer 0 is required; Layer 1 and Layer 2 are optional.

The minimal compatible export is a FHIR `collection` Bundle containing at least one menstrual bleeding fact:

- `Observation.code` = `cycle#menstrual-bleeding`
- `Observation.valueBoolean` = `true` or `false`
- `Observation.effectiveDateTime` = the source date or timestamp
- `Observation.status` = `final`

Layer 1 facts use the matching concrete profiles when they fit:

| Source fact | Profile | When to emit |
|---|---|---|
| Flow intensity | [Menstrual Flow](StructureDefinition-menstrual-flow.html) | The app stores a source flow category. Also emit the Layer 0 bleeding boolean. |
| Symptom | [Symptom](StructureDefinition-symptom.html) | The app stores a symptom selection, finding, or app-native symptom code. |
| Numeric pain | [Numeric Pain Severity](StructureDefinition-numeric-pain-severity.html) | The app stores a true 0-10 numeric pain score. |
| Basal body temperature | [Basal Body Temperature](StructureDefinition-basal-body-temperature.html) | The app stores a temperature measurement identified as basal. |

Use standard codes when the source meaning is exact enough. If it is not, use a stable app-native coding and/or `CodeableConcept.text` rather than a close-but-wrong standard concept. See [Core facts](specification.html#core-facts) and the generated profile pages for the formal constraints.

## Sharing and hosting

Period Tracking shares use SMART Health Links direct-file mode:

- `flag` includes `U`;
- `url` points to one compact JWE;
- the encrypted payload is one `application/fhir+json` Period Tracking Bundle; and
- a receiver retrieves with `GET <url>?recipient=...`.

A viewer-prefixed link is usually the best user-facing QR/copy target:

```text
https://example-viewer/#shlink:/...
```

The SHLink must stay after `#` so the viewer host never receives the key. SHL-aware scanners can scan either a viewer-prefixed QR or a bare `shlink:/...` QR and process the embedded SHLink with their own display logic.

Choose a host based on the controls the product can honestly promise. A static object can publish and delete ciphertext, but cannot count opens, enforce passcodes, or prove use limits. Use an application backend or a deployable blind SHLink service when the product needs enforceable expiration, revocation, use limits, passcodes, or access visibility.

## Viewer and display

The included viewers are examples, not required components. A conforming producer may use this site's viewer prefix, host its own viewer, integrate a viewer into the app, or produce a bare SHLink for workflows that already have SHL-aware scanners.

A viewer should:

- parse the SHLink from the fragment or scanned QR;
- fetch and decrypt the JWE locally;
- validate that the payload is a Period Tracking Bundle;
- derive cycles, bleeding spans, intervals, and medians from Layer 0 facts; and
- show Layer 1 details as optional overlays rather than treating them as required.

When patient name or birth date is present, a viewer may display it for identity checking. It must still treat the data as patient-generated and require a receiving clinician or system to confirm chart identity before import.

## Testing and journal

Keep a short implementation journal in the target app repo. Record:

- which source fields were mapped and why;
- which fields were intentionally omitted;
- how explicit negatives are distinguished from missing data;
- host and viewer choices;
- privacy boundary checks; and
- validation results.

Minimum verification:

- Bundle validates against this IG.
- Every exported Observation comes from user-entered, selected, verified, measured, or imported data.
- No prediction or untouched default is exported as an observed fact.
- The encrypted SHLink opens from QR and copy/share paths.
- The host cannot see plaintext FHIR or the decryption key.
- The viewer renders from the same granular facts in the Bundle.
