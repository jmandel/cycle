# SMART Health Link packaging

The complete Period Tracking Bundle is one FHIR JSON file suitable for SMART Health Link distribution.

## Content type

Use:

```text
application/fhir+json;fhirVersion=4.0.1
```

## Encryption boundary

The sharing application SHOULD:

1. build the final Bundle locally;
2. serialize exactly the Bundle shown in the user's preview;
3. generate the SMART Health Link encryption key locally;
4. encrypt the FHIR JSON using the SMART Health Link JWE requirements;
5. upload only ciphertext to the file host; and
6. construct and render the `shlink:/` URI and QR code locally, either bare or behind an optional viewer launch URL.

The file host does not need the decryption key and should not receive plaintext FHIR, native JSON, patient labels, or source free text.

## Direct-file SHLinks

Period Tracking shares use SMART Health Links direct-file mode.

A conforming share SHALL:

- include `U` in the SHLink `flag`;
- set `url` to a direct-file endpoint for one compact JWE;
- encrypt exactly one `application/fhir+json` Period Tracking Bundle; and
- let receivers retrieve the JWE by issuing a direct-file `GET` with `recipient` supplied as a query parameter.

This guide does not define a manifest-based Period Tracking share. If an implementation chooses another SMART Health Links pattern, it is outside this guide's constrained exchange profile.

The SMART Health Links specification requires compact JWE using direct key management and A256GCM, with the payload content type identified in the protected header. The payload SHOULD be compressed with raw DEFLATE before encryption, signalled by `"zip":"DEF"` in the JWE protected header; recipients SHALL accept both compressed and uncompressed payloads. The worked example below compresses a ~700 KB Bundle to a ~23 KB encrypted file this way.

## Link lifetime and use limits

Period-tracking SHLinks should be scoped to the intended clinical handoff.

For an in-person QR or same-day handoff, sharing applications SHOULD create short-lived links, for example 5-15 minutes. For scheduled or asynchronous review, sharing applications SHOULD prefer a bounded lifetime such as 24-48 hours.

When the file is served by a backend, the server SHOULD support deletion, expiry, or a small maximum-use count and return 404 after the link is no longer active. When the JWE is hosted as a static object, `exp` is only a receiver-visible staleness hint; enforced expiry requires deleting or rotating the object.

## Recipient behavior

The receiving application SHALL decrypt the file before parsing FHIR. It SHOULD validate the Bundle against this guide, retain the original encrypted payload or hash for audit when appropriate, and clearly indicate that ordinary FHIR JSON is patient-generated rather than cryptographically attested clinical data.

## Viewer launch URLs

The interoperable artifact is the `shlink:/...` value and the encrypted JWE it references. A viewer URL is launch metadata, not part of the clinical payload.

Producing applications SHOULD choose the launch shape deliberately based on the expected receiver. For general patient-to-clinician sharing, a viewer-prefixed QR or link is usually the more robust default because ordinary phone cameras and browsers know how to open it. SHL-aware provider scanners can scan either form and extract the embedded `shlink:/...`.

Producing applications MAY therefore:

- present a bare `shlink:/...` QR or copyable link when the receiving channel expects the raw SHLink value;
- prefix the SHLink with this guide's reference viewer, for example `view#shlink:/...`;
- host their own copy of the reference viewer and use that as the prefix; or
- provide a completely separate viewer, scanner, or EHR-integrated receiving app.

When a viewer prefix is used, the `shlink:/...` value SHALL appear in the URL fragment after `#`. It SHALL NOT be placed in query parameters or another server-visible part of the URL, because the SHLink carries the decryption key.

A dedicated provider scanner or receiving application SHOULD treat the viewer prefix, if present, as advisory launch metadata only. It can scan any QR containing a conformant Period Tracking SHLink, extract the embedded `shlink:/...` value, retrieve and decrypt the JWE, validate the Bundle, and display it with the provider's preferred visualization, logic, and settings. This works the same for bare `shlink:/...` values and for viewer-prefixed links.

## Reference viewer and worked SMART Health Link

The published site includes self-contained reference clinician viewers, starting with **[view.html](view.html)** and including side-by-side variants **[view2.html](view2.html)** and **[view3.html](view3.html)**, plus a worked SMART Health Link that exercises one complete path end to end. These viewers are example/default receivers, not required components of conforming implementations.

- The **[longitudinal example Bundle](Bundle-period-tracking-longitudinal-example.html)** — a synthetic seven-cycle copper-IUD case built from the Layer 0 bleeding core plus Layer 1 structured facts — is the cleartext.
- It is encrypted to the direct-file SHL payload published at [`view-assets/example.jwe`](view-assets/example.jwe) (with `zip:DEF`), and one viewer-prefixed sample link is published at [`view-assets/shlink.txt`](view-assets/shlink.txt).
- Opening the URL in [`view-assets/shlink.txt`](view-assets/shlink.txt), or pasting it into [`view.html`](view.html), prepopulates the viewer with the SHLink. The recipient then enters or accepts the visible name field and clicks Open; the viewer sends that value as the SHLink `recipient`, decrypts the file **in the browser**, runs the application-independent transform, derives the cycle/bleeding/pain/symptom analytics from the granular facts (no precomputed summaries travel in the Bundle), and renders a clinician-facing readout.

The reference viewer accepts a full link as a URL fragment, `view#shlink:/...`, and its paste box also accepts a bare `shlink:/...`. Other viewers and provider scanner apps can use the same SHLink payload while applying their own display logic. The decryption key in the published demo is intentionally public because the data is synthetic; a real share keeps the key only in the `shlink:/` URI fragment. The viewer is a reference for receivers and is **not** a substitute for clinical judgement.
