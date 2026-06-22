# Viewer reference

A receiver needs to turn a decrypted Bundle into something a clinician (or the patient) can read. The IG ships a complete, self-contained reference viewer you can **point at, reuse, or learn from** — you do not have to write one from scratch.

Reference viewer (GitHub Pages, single self-contained file): `https://jmandel.github.io/periodicity/viewer.html`
Source: `viewer-src/` in the IG repo.

## The pipeline (what any viewer does)

```
shlink:/…  ──parse──▶  {url,key,flag}  ──fetch+decrypt (JWE)──▶  FHIR Bundle
        ──transform──▶  view model (cycles, daily facts, events)
        ──derive──▶     metrics (intervals, durations, medians)  ──render──▶  summary UI
```

The reference implementation, file by file (all dependency-light, browser + bun safe):

- `viewer-src/jwe.mjs` — compact JWE `dir`/A256GCM decrypt (+ `zip:DEF` inflate), WebCrypto only.
- `viewer-src/shl.mjs` — parse `shlink:/`, fetch (direct-file or manifest), decrypt → Bundle.
- `viewer-src/transform.mjs` — **the reusable core**: Bundle → application-independent view model `{ meta, cycles[], daily[], byDate, events[], context }`. Tolerant: unknown codes ignored, missing fields skipped, a day with no entry is never treated as "no symptom."
- `viewer-src/viewmodel.mjs` — derive descriptive metrics from the view model (the UI hard-codes no numbers).
- `viewer-src/summary.jsx` — the render layer (React): cycle-comparison strips, per-cycle table, bleeding/pain timeline, symptom heatmap, fertility (BBT) panel, day detail.
- `viewer-src/app.jsx` — glue: read `#shlink:/…` from the URL (or a relative `shl.json`), decrypt, transform, render.

## Reuse options

1. **Just link to it.** Generate `https://jmandel.github.io/periodicity/viewer.html#shlink:/…` (or your own copy) and let the user open it. Zero integration.
2. **Host your own copy.** The viewer is one self-contained `viewer.html` (no build step at runtime, no CDN). Drop it on any static host; it reads a co-located `shl.json` for a default, or any `#shlink:/…`.
3. **Embed the transform.** If your app already has UI, reuse just `transform.mjs` + `viewmodel.mjs` to get the view model and render with your own components.

## Key derivation rules the transform encodes (match these if you write your own)

- **Period day** = an explicit menstrual-status-present fact, OR flow ≥ light when no status is given (so flow-only apps still produce cycles), unless the user explicitly said "not menstruating" that day.
- **Intermenstrual bleeding** = a bleeding day (flow ≥ spotting) that is not a period day.
- **Cycle** = a run of period days; a new cycle starts after a gap > 3 bleeding-free days. Cycle length = onset-to-onset; bleed duration = consecutive period days from onset.
- **Everything derived in the UI** — intervals, medians, heavy-day counts — comes from the granular facts, per the IG (`scope.html`). Nothing is read from precomputed summary fields.

## Privacy

Decrypt and render **client-side only**. Never POST the decrypted FHIR back to a server. Keep the `shlink:/` in the URL fragment so the key never reaches a server. Display the result as patient-generated data, clearly not clinically attested.

## Verifying a viewer headlessly

The IG repo's `scripts/verify-viewer.sh` serves the built output and drives headless Chromium against both `/viewer/index.html` (reads `shl.json`) and `/viewer/index.html#shlink:/…`, asserting the summary renders. Adapt it for your own host. (When the app JS is inlined into a single HTML file, don't assert on the *absence* of an error string — the source text is in the DOM — assert on the *presence* of rendered sections instead.)
