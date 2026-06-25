# SMART Health Links reference

A SMART Health Link (SHL) lets a user share the FHIR Bundle as an **encrypted file plus a key**, where the hosting server only ever sees ciphertext. The key travels inside the link (in the URL fragment), so a blind host — your CDN, an object store, or a third party — can never read the cycle data.

This page is a condensed, self-contained reference for the SHL wire format plus the sharing-UX and host guidance this IG adds. For the normative protocol, defer to the **SMART Health Links specification** (HL7 SMART Health Cards & Links IG) — the source markdown is [links-specification.md](https://github.com/HL7/smart-health-cards-and-links/blob/main/input/pagecontent/links-specification.md). For Period Tracking packaging specifics (share shape, lifetime, use-limit), see [SMART Health Links packaging](smart-health-links.html).

## How a SMART Health Link works

An SHL is a small JSON payload, base64url-encoded after `shlink:/`, that points a receiver at **encrypted file(s)** and carries the **decryption key in the link fragment** so the host stays blind. The shareable form can be the bare `shlink:/<b64url>` or a viewer launch URL such as `<viewer>#shlink:/<b64url>`. Prefer a viewer-prefixed form for broad patient-to-clinician sharing because it opens cleanly from ordinary QR scanners and browsers; SHL-aware provider scanners can scan either form and extract the embedded `shlink:/...`. When a viewer prefix is used, the `#` fragment (key included) never reaches a server.

### `shlink:/` payload

`shlink:/` + base64url(minified JSON), with these fields:

| field | req | meaning |
|---|---|---|
| `url` | ✓ | where the encrypted content lives. SHALL carry **≥256 bits of entropy** in its unguessable part (e.g. 32 random bytes → 43 base64url chars) and be **≤128 chars** total. |
| `key` | ✓ | base64url of **32 random bytes** — the AES-256 content key (43 chars). |
| `flag` | | zero or more of `L` (long-term, re-resolvable), `P` (passcode required), `U` (direct file). **`U` SHALL NOT combine with `P`.** |
| `label` | | human label, **≤80 chars**. |
| `exp` | | expiry, epoch seconds — an advisory staleness hint; real enforcement is the host's. |
| `v` | | version int, default 1. |

### Encryption

Each file is a **compact JWE**. For a Period Tracking Bundle, the protected header uses direct key management, AES-256-GCM content encryption, and the FHIR JSON payload media type:

```json
{
  "alg": "dir",
  "enc": "A256GCM",
  "cty": "application/fhir+json"
}
```

Generate a **fresh random 96-bit IV from a CSPRNG for every encryption**, cap a single key at ~2³² messages, then rotate keys — the simplest correct discipline is a **fresh key per share**, so each key encrypts one file.

Optional `zip:"DEF"` (raw DEFLATE before encrypt) shrinks a bundle dramatically (our ~640 KB example → ~20 KB) and the IG demo uses it — but modern `jose` dropped JWE `zip`, so DEF is a common failure point for third-party receivers. **Default to uncompressed** for links to unknown viewers; use DEF only when you control the receiver. The IG viewer inflates DEF.

### Retrieving the content

`recipient` (a display string naming who is opening the link) is **required** on every retrieval. SHL has two retrieval rails.

**Manifest rail.** This is the default rail, and it is required for multi-file links, passcodes, or any server-enforced control. The receiver sends:

```http
POST {url}
```

```json
{
  "recipient": "Display name",
  "passcode": "optional",
  "embeddedLengthMax": 1048576
}
```

The host returns a manifest:

```json
{
  "files": [
    {
      "contentType": "application/fhir+json",
      "embedded": "compact-jwe-or-omitted",
      "location": "short-lived-url-or-omitted"
    }
  ]
}
```

Each file's **`contentType` is the *decrypted* payload type**, such as `application/fhir+json`, `application/smart-health-card`, or `application/smart-api-access`. It is **not** `application/jose`; that is only the HTTP type of a JWE body. Small files come back inline as `embedded`; larger ones come back as a short-lived `location` URL the receiver then fetches.

**Direct-file rail.** This rail is selected when `flag` contains `U`. The receiver fetches:

```http
GET {url}?recipient=Display%20name
```

The response body is the compact JWE, with:

```http
Content-Type: application/jose
```

Direct-file SHLinks are **single-file, and SHALL NOT carry a passcode**. Because a `GET` needs no server logic, a plain static object can satisfy the wire format for demos or unmanaged snapshots: it returns the bytes and ignores the `recipient` query. That is also its ceiling. A dumb host cannot read `recipient`, count opens, or enforce `exp`, and it must send permissive CORS so a browser viewer can fetch cross-origin. Treat static hosting as a demo convenience, not the product default for revocable period-tracking shares. Our demo uses this rail: `example.jwe` is a static GitHub Pages file with `flag:"U"`.

Either way the receiver decrypts the JWE with `key` and parses the payload.

### Passcode (`flag` `P`)

A host-enforced second factor: the receiver supplies it in the manifest `POST`, and the host withholds the ciphertext unless it matches. The host SHALL bound incorrect attempts. On a wrong passcode, return `401` with a body such as:

```json
{
  "remainingAttempts": 2
}
```

Disable the link once the attempt budget is spent. Passcode is manifest-only and incompatible with the `U` rail.

## Sharing UX — present and manage the link

Treat a share as a **live, revocable object the user owns**, not a one-off export. Its lifecycle is **create → present → deliver → manage → take down**, and the sharing UI has two jobs. The rules below hold across app architectures (static, backed, client-only, mobile).

### Present the link — checklist

The shareable string is either a bare `shlink:/eyJ...` or a **viewer URL + fragment**:

```text
<viewer>#shlink:/eyJ...
```

The viewer-prefixed form is the preferred default for general QR/copy UX; the bare form is still fully valid when the receiver expects a raw SHLink. SHL-aware scanners should process either by extracting the `shlink:/...`. The `#` fragment is never sent to the server, so a viewer-prefixed link keeps the key out of logs. This IG's reference viewer uses the [view.html](view.html) prefix.

- [ ] **MUST render an on-screen QR** of that full string — error-correction level M, sized to scan from a phone, label visible (optionally the SMART logo). Prefer a viewer-prefixed link for ordinary phone-camera launch into a browser viewer. Use a bare `shlink:/...` when the receiving workflow explicitly expects the raw SHLink. A provider's dedicated scanner should extract and process either form. *The QR is the primary in-person handoff and the step implementers most often skip — it is not optional.*
- [ ] **MUST offer copy-to-clipboard** of the identical string.
- [ ] **SHOULD offer the native share sheet** (`navigator.share()` / OS share) for remote delivery — message, email, paste into a portal.
- [ ] **SHOULD state in plain language** what's inside (data types + date range), that it's encrypted, and that anyone with the link can open it.

The QR and the copied/shared text are byte-identical: one minted link, two channels (scan vs. send).

### Manage the link — checklist

Because this is reproductive data, the user must stay in control after the link leaves their screen.

- [ ] **MUST provide a visible "Stop sharing / Take it down" action** that actually makes the link stop resolving — delete the ciphertext, disable the endpoint, or revoke server-side. Every architecture must support a real take-down.
- [ ] **MUST retain a handle to each live share** (the host URL / link id) so it can be revoked later. A fire-and-forget upload you cannot delete is not acceptable.
- [ ] **SHOULD show lifetime/expiry**, and where the host can count opens, **opens-remaining / use-limit**.
- [ ] **SHOULD list active shares** with status (created · last opened · expires · revoked).

Two automatic take-down triggers, both host-enforced and surfaced here: **after N opens** (needs a counting host) and **on expiry** (a countdown that is only real if the host stops serving at `exp`). The always-available manual trigger is **user revokes now**.

### Honesty rule

**Only surface a control the host actually enforces.** Don't show "2 opens left" if the host cannot count retrievals; don't imply auto-expiry unless the host stops serving at expiry. The link itself carries only an advisory `exp` — enforcement (expiry, use-count, revocation) is the *host's* job.

## Choosing an enforcement host

For product shares, start from the assumption that the user needs a managed, revocable share. A static object can demonstrate the direct-file wire format, but it is not a good implementation target for period-tracking products because it cannot enforce use limits, passcodes, expiry, or access logs.

The practical choice is whether to build the SHLink hosting controls into your own backend or deploy a reusable blind SHLink service.

| Choice | What it provides | What you own | Use when |
|---|---|---|---|
| **Build it into your backend** | Direct-file and/or manifest endpoints; expiry, use count, passcode, revoke, and access log behavior you implement. | Storage, share IDs, manage tokens, authorization, rate limiting, CORS, audit logging, and tests. | The app already has a backend and the team wants first-party operational control. |
| **Deploy shlep** | Existing blind SHLink data plane and control plane: file hosting, expiry, max-use, passcode, pause/resume, revoke, and access log. | Operating the service and object store; integrating share creation and manage-token handling into the app. | Client-only, static, or mobile apps with no natural backend, or teams that want a reusable SHLink service instead of building this feature from scratch. |

Either way, the privacy boundary holds: the host stores only ciphertext; the key stays client-side.

**shlep — a deployable blind SHLink service.** Use [shlep](https://github.com/jmandel/shlep) when the app can encrypt a Bundle but has no natural backend to host the ciphertext. It implements the SHLink data plane this guide needs (`GET /shl/{id}?recipient=…` → compact JWE; plus the manifest rail) and a capability-token control plane: create shares, add/replace/delete files, set expiry and max-use, set/clear a passcode, pause/resume, revoke, and read an access log — over ciphertext + a hashed manage token, never plaintext or the content key.

- Source + spec: [github.com/jmandel/shlep](https://github.com/jmandel/shlep) (`docs/api-design.md`; a running instance self-documents at `GET /llms.txt`).
- Backends: any object store — S3, R2, GCS, Azure Blob, MinIO.

You deploy and operate it (no public hosted instance) — the right posture for production health data: you control retention, monitoring, and how manage tokens are issued.

## Implementing it yourself (no service)

If you'd rather not run a service, the client side is small. Use shlep's reference client crypto — `src/crypto.ts` (compact JWE `dir`/A256GCM, WebCrypto only) and `src/client.ts` (encrypt + compose the `shlink:/`) in [github.com/jmandel/shlep](https://github.com/jmandel/shlep) — directly or translated. For direct-file mode you then host the `.jwe` and hand out a bare `shlink:/<payload>` or `<viewer>#shlink:/<payload>`.

The IG's own `viewer-src/jwe.mjs` is the viewer's **decrypt** path; `scripts/gen-shl.ts` is **editorial demo tooling** that pins a fixed key+IV only to keep the published example byte-stable — do not copy that pattern for real encryption.

## Receiver notes

- **Recipient flow:** scan/paste → extract `shlink:/` → decode → retrieve with `recipient` → fetch JWE → decrypt with `key` → FHIR. Always send `recipient`; expect one-time/expiring links not to re-resolve.
- **Receiver hygiene:** fetch payload URLs through a hardened, SSRF-resistant retrieval path and treat decrypted content as untrusted input. Label the rendering clearly as patient-generated, not clinically attested.
