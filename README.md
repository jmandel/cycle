# Period Tracking MVP Implementation Guide

A compact FHIR R4 implementation guide for sharing granular patient-generated menstrual period tracking data.

## Contents

- 7 FHIR profiles
- 1 project CodeSystem containing 8 concepts
- 3 ValueSets (menstrual flow; a non-binding common-symptoms starter set; fact categories)
- complete FSH source
- generated worked examples: a synthetic seven-cycle **longitudinal example Bundle** plus small standalone examples for the concrete profiles
- clinician-display guidance
- an agent skill (`skill/`) for adding IG support to a tracking app
- SMART Health Link packaging guidance
- source for a self-contained **clinician viewer** that decrypts a SMART Health Link in the browser and renders the cycle summary
- terminology and integrity-check scripts
- IG Publisher build scripts and GitHub Actions workflow

## Generated artifacts (bun)

Generated examples, SHLink files, and bundled viewer assets are build products. They are not committed. Local builds write them under `dist/`; the GitHub Pages workflow copies generated example resources into `input/resources/` inside the runner before invoking the IG Publisher, then adds the viewer pages and sample SHLink assets.

```bash
bun install          # one-time, restores esbuild + React for the viewer build
bun run build        # local demo artifacts under dist/
bun run build:site   # full IG Publisher + viewer build under output/
```

`bun run build` creates:

- `dist/examples/Bundle-period-tracking-longitudinal-example.json` and `dist/examples/Observation-*.json` — the synthetic seven-cycle Bundle and standalone profile examples;
- `dist/view-assets/example.jwe` + `shlink.txt` — the worked SMART Health Link;
- `dist/view.html` + `dist/view-assets/{app.js,index.html}` — the bundled viewer SPA.

Sources live in `viewer-src/` and `scripts/`. Set `VIEWER_BASE=https://your-host/path/view` before `bun run build` or `bun run build:site` to generate `shlink.txt` for a fork or alternate publication location. To exercise the local viewer headlessly: `bun run verify:viewer`.

## Build

Requirements:

- Node.js 20 or later
- Java 17 or later
- internet access for first-time FHIR package and publisher downloads

Compile FSH:

```bash
./_sushi.sh
```

Build the full IG site:

```bash
./_updatePublisher.sh
./_genonce.sh
```

The static site is written to `output/`. Generated FHIR JSON is written to `fsh-generated/resources/`.

## Local checks

```bash
bun scripts/check-mvp.ts
bun scripts/validate-r4-structures.ts --r4-package ~/.fhir/packages/hl7.fhir.r4.core#4.0.1
bun scripts/verify-terminology.ts \
  --loinc /path/to/Loinc_2.82 \
  --snomed /path/to/SnomedCT_ManagedServiceUS_PRODUCTION_US1000124_20260301T120000Z
```

## Status

Version 0.2.0 is an implementation draft for prototyping. It is not an HL7-balloted guide.
