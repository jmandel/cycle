# SMART Health Links reference

A SMART Health Link (SHL) lets a user share the FHIR Bundle as an **encrypted file plus a key**, where the hosting server only ever sees ciphertext. The key travels inside the link (in the URL fragment), so a blind host — your CDN, an object store, or a third party — can never read the cycle data.

The normative Period Tracking MVP packaging guidance lives in `input/pagecontent/smart-health-links.md` and is published at https://build.fhir.org/ig/jmandel/periodicity/smart-health-links.html. Follow that page for the required share shape, lifetime, and use-limit rules; this reference is implementation support.
Spec: SMART Health Links (smarthealthit.org / HL7).

## The `shlink:/` payload

A link is `shlink:/` + base64url(minified JSON):

| field | meaning |
|---|---|
| `url` | where the encrypted content lives. For Period Tracking MVP, see the packaging page. ≤128 chars. |
| `key` | base64url of **32 random bytes** — the AES-256 key. (43 chars.) |
| `flag` | optional letters defined by SMART Health Links. For Period Tracking MVP requirements, see the packaging page. |
| `label` | optional ≤80-char human label. |
| `exp` | optional expiry, **epoch seconds** (advisory staleness hint). |
| `v` | optional version int, default 1. |

Encryption: **compact JWE, `alg:"dir"`, `enc:"A256GCM"`**, `cty` header = `application/fhir+json`. A fresh 12-byte IV per encryption. Optional `zip:"DEF"` (raw DEFLATE before encrypt).

**DEFLATE caveat:** `zip:"DEF"` shrinks a bundle dramatically (our ~640 KB example → ~20 KB), and the IG demo uses it. But modern `jose` dropped JWE `zip` support, so DEF is a common failure point for third-party receivers. **Default to uncompressed** for links you'll send to unknown viewers; use DEF only for large bundles when you control or trust the receiver. The IG reference viewer inflates DEF.

## Retrieval implementation note

For a direct-file SHLink, the receiver does `GET <url>?recipient=<org>` and the body is the JWE (`Content-Type: application/jose`). `recipient` is required. The receiver then decrypts the JWE with `key` and parses the FHIR Bundle.

## Viewer prefix & QR

The shareable form is a **viewer URL + fragment**: `https://viewer.example/#shlink:/eyJ…`. The `#` fragment is never sent to the server (so the key never leaks into logs). A bare `shlink:/…` works only with SHL-aware scanners; the prefixed form opens from any phone camera. Encode that URL as a **QR (error-correction level M)**, optionally with the SMART logo. Parsers accept either bare or prefixed (extract the `shlink:/` substring).

The project's own viewer prefix: `https://periodicity.fhir.me/#shlink:/…`.

## Hosting implementation notes

### (a) Static file, no backend
Encrypt client-side, write the JWE as a static object to your web host / CDN / S3 / GCS / Azure (permissive CORS), and point `url` at it. Cheapest, nothing to run.
*Trade-offs:* no server-enforced use counting, no access log, `exp` is only advisory unless you delete or rotate the object.
*Use when:* you just need to publish a snapshot the user can hand to a clinician.

### (b) Your own backend — still direct file
Serve the JWE from a backend endpoint that behaves like a direct-file SHLink data URL: `GET <url>?recipient=...` returns `application/jose`. The backend can enforce expiry, use limits, deletion, rate limits, and basic audit while keeping the Period Tracking MVP SHLink shape unchanged.
*Trade-offs:* you run a process + storage.
*Use when:* clinic check-in flows, tighter operational control, or production where no third party should be in the path.

### (c) ktc.joshuamandel.com companion server
Use the ktc.joshuamandel.com SHLink companion server when the app can build and encrypt a Period Tracking MVP Bundle but does not have a natural backend to host the encrypted SHLink target file.

- Hosted prototype: https://ktc.joshuamandel.com
- Code and deployment pattern: https://github.com/jmandel/kill-the-clipboard-skill
- Server API notes: https://github.com/jmandel/kill-the-clipboard-skill/blob/main/server/README.md

ktc.joshuamandel.com is useful because it already implements the direct-file SHLink data-plane shape this guide needs: `GET /shl/{id}?recipient=...` returns the compact JWE as `application/jose`. Its control plane can create managed links, upload or replace ciphertext, set expiry and max-use limits, pause/revoke/re-arm links, and expose access logs. The server stores ciphertext and opaque control metadata; it does not need plaintext FHIR or the SHLink decryption key.

*Trade-offs:* another service is in the operational path. The public hosted instance is prototype-grade and has no production SLA; use it for demos or MVP integration work. For production health data, either self-host the companion server codebase with your own retention/monitoring controls or implement the same direct-file API pattern in the app's own backend.
*Use when:* the app is client-only, static-hosted, mobile-only, or otherwise lacks an existing server that can enforce expiry, revocation, use limits, or access logging for encrypted SHLink files.

The privacy boundary holds in all three: the host stores only ciphertext; the key stays client-side.

## Implementing it yourself (no library)

If you'd rather not pull in a library, the whole client side is small — see the IG's `viewer-src/jwe.mjs` (compact JWE `dir`/A256GCM with optional `zip:DEF`, WebCrypto only) and `scripts/gen-shl.ts` (encrypt a bundle, build the `shlink:/`). For direct-file mode you then just host the `.jwe` and hand out `<viewer>#shlink:/<payload>`.

## Receiver notes

- **Recipient flow:** scan/paste → extract `shlink:/` → decode → `GET <url>?recipient=...` → fetch JWE → decrypt with `key` → FHIR. Always send `recipient`; expect one-time/expiring links not to re-resolve.
- **Receiver hygiene:** fetch payload URLs through a hardened, SSRF-resistant retrieval path and treat decrypted content as untrusted input. Label the rendering clearly as patient-generated, not clinically attested.
