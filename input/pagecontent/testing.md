# Implementation testing guide

This page is an implementer-facing verification checklist. It does not define a separate conformance claim; the conformance language is in [Scope and conformance principles](specification.html#scope-and-conformance-principles). Use these checks to show that a producer, receiver, or adapter actually satisfies that contract.

## Structural checks

- SUSHI compiles the FSH with zero errors.
- The IG Publisher validates all generated resources.
- Every normalized Observation conforms to the appropriate concrete fact profile.
- Recorded bleeding days include a `cycle#menstrual-bleeding` fact with `valueBoolean`.
- Flow facts, when present, are consistent with the bleeding core (`flow-none` with false; spotting or greater with true).
- The Bundle contains at least one menstrual bleeding core fact.
- If Patient or `Observation.subject` references are present, they are consistent with the intended single-person scope.
- Every populated Bundle `fullUrl` is unique.

## Adapter fixtures

Each source adapter SHOULD implement these fixtures:

1. untouched day;
2. explicit no-bleeding selection;
3. spotting-only day;
4. heavy flow plus pain and symptoms;
5. custom symptom without standard mapping;
6. timed basal body temperature;
7. source default that must not become a negative fact; and
8. app prediction that must not become an observed fact.

## Cross-app equivalence

Load equivalent synthetic histories into at least two applications with different persistence architectures. The normalized Bundles should contain clinically equivalent codes and values while retaining distinct source identifiers and native archives.

## Privacy check

Capture client network traffic and hosting-server logs. The test fails if any of the following appear outside the trusted client:

- plaintext FHIR JSON;
- plaintext native source JSON;
- menstrual dates or source free text;
- SMART Health Link decryption key;
- owner or management capability; or
- unencrypted patient labels.

## Viewer smoke test

A clinician should be able to identify observed period timing, flow, pain, symptoms, and missingness without reading raw JSON. Every derived display value should be traceable to the source facts used in its calculation.

## Included scripts

The source package includes:

- `scripts/verify-terminology.ts` — checks referenced LOINC and SNOMED CT codes against supplied licensed LOINC and SNOMED CT releases;
- `scripts/check-mvp.ts` — verifies the project CodeSystem, resource references, bleeding/flow consistency, and example Bundle integrity; and
- build scripts for SUSHI and the IG Publisher.
