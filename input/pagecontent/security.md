# Security and privacy

Period tracking data may reveal sexual, reproductive, fertility, pregnancy, medication, and mental-health information. Implementations should minimize both content and metadata.

## Patient control

The sharing application SHOULD let the user choose:

- date range;
- normalized categories;
- whether notes are included;
- whether the native archive is included;
- link expiration;
- passcode protection when supported; and
- identifying information in the Patient resource.

Sensitive categories should default off when they are outside the immediate clinical purpose.

## Plaintext handling

Plaintext FHIR and native JSON SHOULD remain within the trusted application process or browser context. Implementations SHALL NOT place decryption keys, owner capabilities, plaintext observations, or diary text in ordinary server logs, analytics events, crash reports, or URL query parameters.

## Native Binary

The optional native Binary may contain more information than the normalized clinical view. The consent preview SHALL disclose its inclusion. A “complete export” control should not silently include categories the user did not select for sharing.

## Metadata

A blind ciphertext host still observes network and operational metadata such as IP address, timing, file size, and access frequency. Deployments SHOULD minimize retained metadata and document retention behavior.

## Identity matching

The recipient SHALL confirm patient identity before importing data into a clinical chart. The presence of a Patient resource in the Bundle does not itself establish a verified match.

## Provenance and trust

Provenance records who or what transformed the source data. It does not make the patient-generated facts independently verified. The clinical interface should distinguish self-reported, app-derived, and clinician-verified information whenever those categories are mixed.
