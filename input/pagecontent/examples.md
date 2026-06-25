# Worked example

The guide ships a single worked example, generated from one synthetic dataset so the spec artifact, the SMART Health Link, and the viewer all show **the same data**. The source application is a fictional **Periodicity** — not a real product.

## The longitudinal example

The [**Longitudinal Period Tracking Export**](Bundle-period-tracking-longitudinal-example.html) is a synthetic ~seven-cycle copper-IUD case built from the Layer 0 bleeding core plus Layer 1 structured facts: flow, pain, symptoms, mood-like symptom values, and basal body temperature. It is generated during the site build, validated by the IG Publisher, and used as the cleartext payload for the sample SMART Health Link.

It exercises every construct in the MVP in one place:

- the **granular-first** pattern — boolean bleeding and flow intensity as *separate* facts, so binary-only apps and flow-capable apps share the same core;
- **pain** as a 0–10 score, **symptoms** as `cycle#symptom` facts with exact SNOMED or app-native values, and **basal body temperature** as a vital sign;
- an **explicit negative** — a day the user verified *no bleeding* (distinct from a day that simply wasn't recorded);
- one **app-native custom symptom** via the escape hatch (a code from an app-controlled CodeSystem, with no false standard mapping); and
- an optional **`Binary` native-JSON archive** — the "Complete export" safety net.

The published site build also creates a direct-file SMART Health Link for this Bundle. The reference viewer fetches the encrypted file, decrypts it in the browser with the key carried in the link fragment, and computes every cycle metric from the granular facts. A provider scanner or another viewer can extract the same `shlink:/...` payload from either a viewer-prefixed or raw SHLink QR and apply its own visualization. The key here is public **only because the data is synthetic** — a real share keeps the key in the link fragment and out of any server log.

## How it's built

The example is generated, not hand-authored, so it can't drift from the data model: `viewer-src/dataset.mjs` (the deterministic synthetic case) → `scripts/gen-example.ts` emits the FHIR resources into the build's `input/resources/` directory → the IG Publisher validates and publishes the Bundle → `scripts/gen-shl.ts` encrypts the Bundle into the sample link under `view-assets/`. The generated JSON and encrypted SHLink are build artifacts, not committed source files.
