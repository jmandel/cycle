# Conformance testing

An implementation should pass structural, semantic, privacy, and round-trip tests.

## Structural validation

- SUSHI compiles the FSH with zero errors.
- The IG Publisher validates all generated resources.
- Every fact conforms to Period Tracking Fact Observation.
- Every daily panel references at least one conforming fact.
- The Bundle contains exactly one Patient, at least one Device, at least one daily panel, at least one granular fact, and at least one Provenance resource.
- Every Bundle entry has a unique `fullUrl`.

## Semantic fixtures

Each source adapter SHOULD implement these fixtures:

1. untouched day;
2. note-only day;
3. explicit no-flow or not-menstruating selection;
4. spotting-only day;
5. heavy flow plus pain and symptoms;
6. custom symptom without standard mapping;
7. timed basal body temperature;
8. source default that must not become a negative fact; and
9. app prediction that must not become an observed fact.

## Cross-app equivalence

Load equivalent synthetic histories into at least two applications with different persistence architectures. The normalized Bundles should contain clinically equivalent codes and values while retaining distinct source identifiers and native archives.

## Privacy test

Capture client network traffic and hosting-server logs. The test fails if any of the following appear outside the trusted client:

- plaintext FHIR JSON;
- plaintext native source JSON;
- menstrual dates or diary text;
- SMART Health Link decryption key;
- owner or management capability; or
- unencrypted patient labels.

## Viewer test

A clinician should be able to identify observed period timing, flow, pain, symptoms, and missingness without reading raw JSON. Every derived display value should be traceable to the source facts used in its calculation.

## Included scripts

The source package includes:

- `scripts/verify_terminology.py` — checks referenced LOINC and SNOMED CT codes against supplied NDJSON distributions;
- `scripts/check_mvp.py` — verifies the seven-code limit, resource references, and example Bundle integrity; and
- build scripts for SUSHI and the IG Publisher.
