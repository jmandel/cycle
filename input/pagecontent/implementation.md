# Implementation

Use this page when adding cycle.fhir.me support to a period-, fertility-, or cycle-tracking app. It is the working checklist for product teams and AI agents: inspect the app's real data, map only true stored facts, package them as an encrypted SMART Health Link, and verify the viewer/privacy path end to end.

The [Specification](specification.html) is the source of truth for profiles, codes, and conformance. This page explains how to apply it in an app. It is also packaged for agents as [`skill.zip`](skill.zip); inside that zip, this page becomes `SKILL.md` and the core rendered spec markdown is included under `spec/`.

## Operating rule: drive from the app's real data

Map only what the app actually stores. Read the app's data model, storage, exports, UI, and tests before deciding what to map. Do not invent fields the app does not have, and do not emit app predictions, derived caches, or unedited defaults as clinical facts. When normalization is uncertain, keep the source value in app-controlled terminology or omit the normalized fact rather than guessing.

This restraint is the point: the data is sensitive, and a clinician must be able to trust that every fact reflects something the user actually entered, selected, measured, imported, or verified.

## Recommended "Share with SMART Link" UX

Use **"Share with SMART Link"** as the working feature name when it fits the app. Other labels are fine, but the feature should make the user-facing task clear: create an encrypted link or QR code for selected cycle data.

A consistent share flow has four parts:

1. **Choose scope.** Let the user choose the person/account, date range, and data categories. Layer 0 bleeding facts are the core of a compatible share. Layer 1 details such as flow, symptoms, pain, and basal temperature are included only when selected and available.
2. **Review before sharing.** Show a plain-language preview of the date range, included data types, excluded data types when relevant, identity details if present, and when the link stops working. State that anyone with the link can open it until it is stopped or expires.
3. **Share the live link.** Mint one live SHLink and present it through the available handoff controls: on-screen QR, copy link, and native share. These controls all use the identical string.
4. **Manage sharing.** Show whether the link is active, how the user can stop it, and any host-enforced controls such as expiry, use limit, passcode, or access log. Do not show controls the host cannot enforce.

The preview can be brief. For example: "This SMART Link includes bleeding days, flow, symptoms, and pain from Jan 1-Mar 31, 2026. It does not include notes. Anyone with the link can open it until you stop sharing."

## Workflow

1. **Create the implementation checklist.** Before coding, record the app-specific answer for each required item:
   - **Feature entry point** — where the app offers **"Share with SMART Link"** or an equivalent label, and what supporting copy explains the encrypted link/QR.
   - **Scope controls** — how the user selects the person/account, date range, and data categories.
   - **Plain-language preview** — where the app shows what will be included, what will be excluded, who can open the link, and when sharing stops.
   - **Layer 0 source** — which stored field(s) become menstrual-bleeding `true` / `false`, and how the app distinguishes explicit "no bleeding" from missing data or untouched defaults.
   - **Layer 1 source** — which flow, symptom, pain, and basal-temperature facts are mapped, and which source fields are intentionally omitted.
   - **Live SHLink host** — app backend or deployable blind service such as [shlep](https://github.com/jmandel/shlep), plus the controls the host really enforces: revocation, expiry, use-limit, passcode, and access log visibility.
   - **Handoff controls** — one live SHLink rendered through QR, copy, and native-share controls for the identical string. Prefer a viewer-prefixed link for broad phone-camera UX; use a bare `shlink:/...` QR only for workflows that already have SHL-aware scanners.
   - **Stop-sharing behavior** — how the user disables the live QR/link, and which automatic stop conditions apply, such as expiry or use-limit exhaustion.
   - **Receiver path** — reference viewer, app-hosted viewer, embedded viewer, or provider scanner.
   - **Privacy and validation evidence** — Bundle validation, QR scan/open, viewer rendering, host access without plaintext or key, and revoke/expiry/use-limit behavior when advertised.
2. **Resolve only missing product values.** Ask for whatever is needed to fill the checklist above. Do not substitute a file download or ad hoc export for the live SHLink handoff.
3. **Create one source snapshot.** Use one immutable, user-approved snapshot as the input to the share review screen, normalization, encryption, and handoff controls. Apply the selected person, date range, and category scope before normalization so the review screen and encrypted payload describe the same data.
4. **Inventory the app.** Read the storage model, serializers, exports, UI, demo data, and tests before mapping. Identify stored bleeding states, flow, symptoms, pain, temperature, custom dictionaries, predictions, defaults, derived summaries, source application metadata, schema versions, and stable source identifiers.
5. **Classify every candidate field.** Export `user-entered` data: selected, entered, verified, measured, or imported facts. Usually omit `derived` data; never export `prediction`, `default`, `configuration`, or `not-stored` data as observed facts.
6. **Build the FHIR Bundle.** Use the [Period Tracking Bundle](StructureDefinition-period-tracking-bundle.html), include at least one Layer 0 [Menstrual Bleeding](StructureDefinition-menstrual-bleeding.html) fact, and add Layer 1 profiles only when the source has those facts.
7. **Apply missing-data rules.** An explicit "none/no" is a fact. An untouched default or absent row is not. Never fabricate negatives from missing data.
8. **Encrypt and present the share widget.** Package the Bundle as a SMART Health Link direct-file share, mint a live SHLink, and present the identical string through QR, copy, and native-share controls when the platform supports them. Prefer a viewer-prefixed URL for ordinary phone-camera UX, but keep the `shlink:/...` value in the fragment after `#`. The same widget should also provide a way to stop the live link or explain when it will stop automatically.
9. **Render locally.** A viewer or provider scanner decrypts client-side and computes summaries from granular facts. Do not send decrypted FHIR back to a server.
10. **Verify end to end.** Validate the Bundle, round-trip encrypt/decrypt, scan or open the link, render the viewer, and confirm the host never receives plaintext or the key.

## FHIR mapping

Start with the [adoption layers](specification.html#adoption-layers): Layer 0 is required; Layer 1 is optional.

The minimal compatible export is a FHIR `collection` Bundle containing at least one menstrual bleeding fact:

- `Observation.code` = `cycle#menstrual-bleeding`
- `Observation.valueBoolean` = `true` or `false`
- `Observation.effectiveDateTime` = the source date or timestamp
- `Observation.status` = `final`

Patient and Device resources are optional. Include them only when the user and product scope support it. When source application identity is useful and not over-identifying, a Device resource can preserve source app, version, schema, or stable source identifiers for traceability.

Layer 1 facts use the matching concrete profiles when they fit:

| Source fact | Profile | When to emit |
|---|---|---|
| Flow intensity | [Menstrual Flow](StructureDefinition-menstrual-flow.html) | The app stores a source flow category. Also emit the Layer 0 bleeding boolean. |
| Symptom | [Symptom](StructureDefinition-symptom.html) | The app stores a symptom selection, finding, or app-native symptom code. |
| Numeric pain | [Numeric Pain Severity](StructureDefinition-numeric-pain-severity.html) | The app stores a true 0-10 numeric pain score. |
| Basal body temperature | [Basal Body Temperature](StructureDefinition-basal-body-temperature.html) | The app stores a temperature measurement identified as basal. |

Use standard codes when the source meaning is exact enough. If it is not, use a stable app-native coding and/or `CodeableConcept.text` rather than a close-but-wrong standard concept. See the [layered fact model](specification.html#layered-fact-model) and the generated profile pages for the formal constraints.

## Sharing and hosting

Period Tracking shares use SMART Health Links direct-file mode:

- `flag` includes `U`;
- `url` points to one compact JWE;
- the encrypted payload is one `application/fhir+json` Period Tracking Bundle; and
- a receiver retrieves with `GET <url>?recipient=...`.

Use the [SMART Health Links specification](https://build.fhir.org/ig/HL7/smart-health-cards-and-links/links-specification.html) and a reviewed SHL/JWE implementation for the protocol details. This implementation guide should not be treated as a crypto recipe.

A viewer-prefixed link is usually the best user-facing QR/copy target:

```text
https://example-viewer/#shlink:/...
```

The SHLink must stay after `#` so the viewer host never receives the key. SHL-aware scanners can scan either a viewer-prefixed QR or a bare `shlink:/...` QR and process the embedded SHLink with their own display logic.

For product shares, start from the assumption that the user needs a live, managed, revocable share presented as a QR. Do not make a downloaded file the product handoff. The share should keep working through the SHLink until the host policy stops it, and the app should only surface controls the host actually enforces.

The practical choice is whether to build SHLink hosting controls into your own backend or deploy a reusable blind SHLink service.

| Choice | What it provides | What you own | Use when |
|---|---|---|---|
| **Build it into your backend** | Direct-file and/or manifest endpoints; expiry, use count, passcode, revoke, and access log behavior you implement. | Storage, share IDs, manage tokens, authorization, rate limiting, CORS, audit logging, and tests. | The app already has a backend and the team wants first-party operational control. |
| **Deploy shlep** | Existing blind SHLink data plane and control plane: file hosting, expiry, max-use, passcode, pause/resume, revoke, and access log. | Operating the service and object store; integrating share creation and manage-token handling into the app. | Client-only, static, or mobile apps with no natural backend, or teams that want a reusable SHLink service instead of building this feature from scratch. |

Either way, the privacy boundary holds: the host stores only ciphertext; the key stays client-side.

**shlep** is a deployable blind SHLink service for apps that can encrypt a Bundle but do not have a natural backend for managed ciphertext hosting. It implements the data plane this guide needs (`GET /shl/{id}?recipient=...` -> compact JWE, plus the manifest rail) and a capability-token control plane: create shares, add/replace/delete files, set expiry and max-use, set/clear a passcode, pause/resume, revoke, and read an access log over ciphertext and a hashed manage token. It never sees plaintext or the content key.

- Source and API notes: [github.com/jmandel/shlep](https://github.com/jmandel/shlep)
- Backends: any object store, including S3, R2, GCS, Azure Blob, or MinIO.
- Deployment posture: you deploy and operate it; there is no public hosted instance for production health data.

If you do not deploy shlep, you are implementing both the share-minting client path and the server/storage path yourself. The client-side crypto and link construction are small and reusable: use shlep's `src/crypto.ts` (compact JWE `dir`/A256GCM, WebCrypto only) and `src/client.ts` (encrypt + compose the `shlink:/`) directly or translated. Your backend then hosts the `.jwe` behind the controls the product promises, and your app renders the resulting `shlink:/<payload>` or `<viewer>#shlink:/<payload>` as the QR/copy/share target.

The user-facing share widget should provide one minted live SHLink through all handoff paths:

- on-screen QR;
- copy of the identical string;
- native share of the identical string when the platform supports it;
- plain-language summary of what's inside, the date range, and who can open it; and
- a visible way to stop sharing that actually makes the QR/link stop resolving, unless the product uses an automatic stop condition such as expiry or use-limit exhaustion and explains that clearly.

Only surface controls the host enforces. Do not show "2 opens left" if the host cannot count retrievals, and do not imply auto-expiry unless the host stops serving at expiry.

## Viewer and display

The included viewers are examples, not required components. A conforming producer may use this site's viewer prefix, host its own viewer, integrate a viewer into the app, or render a bare SHLink QR for workflows that already have SHL-aware scanners.

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
- The share review screen and encrypted Bundle are produced from the same user-approved snapshot and date/category scope.
- The encrypted SHLink opens from QR and copy/share paths.
- The host cannot see plaintext FHIR or the decryption key.
- The viewer renders from the same granular facts in the Bundle.
- For this repository, `bun scripts/build-sitegen-site.ts` passes before publishing changed IG content.
