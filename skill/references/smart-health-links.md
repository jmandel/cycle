# SMART Health Links reference

A SMART Health Link (SHL) lets a user share the FHIR Bundle as an **encrypted file plus a key**, where the hosting server only ever sees ciphertext. The key travels inside the link (in the URL fragment), so a blind host — your CDN, an object store, or a third party — can never read the cycle data.

IG packaging guidance: https://build.fhir.org/ig/jmandel/periodicity/smart-health-links.html
Spec: SMART Health Links (smarthealthit.org / HL7). Reference implementation: **kill-the-clipboard** — https://github.com/jmandel/kill-the-clipboard-skill (MIT).

## The `shlink:/` payload

A link is `shlink:/` + base64url(minified JSON):

| field | meaning |
|---|---|
| `url` | where the encrypted content lives (a manifest endpoint, or — with flag `U` — the file itself). ≤128 chars. |
| `key` | base64url of **32 random bytes** — the AES-256 key. (43 chars.) |
| `flag` | optional letters, alphabetical: `L` long-term/updateable, `P` passcode required, `U` direct-file. **`U` and `P` are mutually exclusive.** |
| `label` | optional ≤80-char human label. |
| `exp` | optional expiry, **epoch seconds** (advisory staleness hint). |
| `v` | optional version int, default 1. |

Encryption: **compact JWE, `alg:"dir"`, `enc:"A256GCM"`**, `cty` header = `application/fhir+json`. A fresh 12-byte IV per encryption. Optional `zip:"DEF"` (raw DEFLATE before encrypt).

**DEFLATE caveat:** `zip:"DEF"` shrinks a bundle dramatically (our ~640 KB example → ~20 KB), and the IG demo uses it. But modern `jose` dropped JWE `zip` support, so DEF is a common failure point for third-party receivers. **Default to uncompressed** for links you'll send to unknown viewers; use DEF only for large bundles when you control or trust the receiver. (Our viewer and the ktc readers always inflate, so DEF is safe within this ecosystem.)

## Retrieval modes

- **Direct file (flag `U`):** receiver does `GET <url>?recipient=<org>` and the body is the JWE (`Content-Type: application/jose`). `recipient` is required. No passcode, minimal management.
- **Manifest (no `U`):** receiver does `POST <url>` with `{recipient, passcode?, embeddedLengthMax?}` and gets a manifest whose `files[]` carry `contentType` + either `embedded` (inline JWE) or `location` (short-lived signed URL). Supports passcodes, expiry, one-time use, and updateable content.

Either way the receiver then decrypts the JWE with `key` and parses the FHIR.

## Viewer prefix & QR

The shareable form is a **viewer URL + fragment**: `https://viewer.example/#shlink:/eyJ…`. The `#` fragment is never sent to the server (so the key never leaks into logs). A bare `shlink:/…` works only with SHL-aware scanners; the prefixed form opens from any phone camera. Encode that URL as a **QR (error-correction level M)**, optionally with the SMART logo. Parsers accept either bare or prefixed (extract the `shlink:/` substring).

The IG's own viewer prefix (GitHub Pages): `https://jmandel.github.io/periodicity/viewer.html#shlink:/…`.

## Three hosting patterns — pick by architecture

### (a) Static file, no backend  — flag `U`
Encrypt client-side, write the JWE as a static object to your web host / CDN / S3 / GCS / Azure (permissive CORS), and point `url` at it. Cheapest, nothing to run.
*Trade-offs:* no passcode, no real revocation (delete/rotate the object), no access log, `exp` is only advisory.
*Use when:* you just need to publish a snapshot the user can hand to a clinician.

### (b) Your own backend — manifest server
Run a small SHL server for passcodes (`P`), enforced expiry & use budgets, one-time/limited use, updateable content, reversible pause, and a per-access audit log. The **kill-the-clipboard** server (Bun + SQLite) does all of this and is self-hostable; point `DB_PATH` at a mounted volume for durable storage.
*Trade-offs:* you run a process + storage.
*Use when:* clinic check-in flows, ongoing care, anything needing revocation/audit/passcodes, or production where no third party should be in the path.

### (c) Hosted demo service — ktc.joshuamandel.com
The same kill-the-clipboard server, operated for you; the bundled scripts default to it. Identical capabilities to (b).
*Trade-offs:* prototype-grade, shared host, no SLA, operator-controlled retention (~30-day purge after expiry). **Not production health infrastructure.**
*Use when:* quick demos and MVPs, or to get the flow working before deciding to self-host.

The privacy boundary holds in all three: the host stores only ciphertext; the key stays client-side.

## ktc.joshuamandel.com / kill-the-clipboard API

No accounts. One owner **master secret `M`** (32 bytes) derives, via HKDF-SHA256, two capabilities: the encryption `key` (HKDF info `ktc-shl/v1/key`, goes in the shlink) and a control `auth` token (info `ktc-shl/v1/auth`, sent as `Authorization: Bearer`). The server stores only `sha256(auth)`, the ciphertext, an argon2id passcode hash, and a client-encrypted label — it can't read the data *or* the label.

Control plane (Bearer auth; wrong/missing auth → **404**, never 401):
- `POST /api/links` `{flag, exp, maxUses?, passcode?, labelEnc?}` → `{id, url}` (the `url` to embed).
- `POST /api/manage/files` (raw JWE body, ≤25 MB) → `{fileId}`; `PUT /api/manage/files/{fileId}` to replace.
- `GET /api/manage` → status + access log; `PATCH /api/manage` to extend/relabel/pause/set-passcode; `DELETE /api/manage` to destroy.
- `GET /api/manage/events` → signal-only SSE.

Data plane (CORS `*`; any non-live link → uniform 404):
- `GET /shl/{id}?recipient=<org>` (flag `U`) → the JWE.
- `POST /shl/{id}` `{recipient, passcode?}` → manifest; bad passcode → 401 `{remainingAttempts}` (5 lifetime guesses).

Owner page: `<base>/m#<base64url(M)>` (a secret bearer capability — deliver to the patient as message text, treat like a password). Viewer page: `<base>/v#shlink:/…`.

The repo ships ready-to-run scripts (`scripts/create-shl.ts`, `scripts/manage-shl.ts`) and a frozen, dependency-free crypto kernel (`lib/{jwe,shlink,hkdf,encoding}.ts`) you can vendor instead of taking a crypto dependency. QR uses the `qrcode` package.

## Implementing it yourself (no library)

If you'd rather not pull in a library, the whole client side is small — see the IG's `viewer-src/jwe.mjs` (compact JWE `dir`/A256GCM with optional `zip:DEF`, WebCrypto only) and `scripts/gen-shl.ts` (encrypt a bundle, build the `shlink:/`). For direct-file mode you then just host the `.jwe` and hand out `<viewer>#shlink:/<payload>`.

## Guidance

- **Expiry:** in-person QR 5–15 min; printed/scheduled 24–48 h; ongoing per the user's preference. Re-arming changes the payload, so regenerate any QR/`shlink.txt` after changing `exp`.
- **Recipient flow:** scan/paste → extract `shlink:/` → decode → (`U`) `GET` or (manifest) `POST` → fetch JWE → decrypt with `key` → FHIR. Always send `recipient`; expect one-time/expiring links not to re-resolve.
- **Receiver hygiene:** fetch payload URLs through a hardened, SSRF-resistant retrieval path and treat decrypted content as untrusted input. Label the rendering clearly as patient-generated, not clinically attested.
