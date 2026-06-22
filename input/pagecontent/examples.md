# Worked example

The worked example uses a synthetic **MVP Reference Tracker**, not one of the five surveyed applications. This keeps every example assertion internally consistent while the adapter page documents the real native mappings.

The [Period Tracking MVP Export Bundle](Bundle-period-tracking-bundle-example.html) demonstrates the complete pattern.

## 14 May 2026

The daily panel groups seven independently meaningful facts:

- menstrual bleeding present;
- heavy patient-rated flow;
- menstrual cramps;
- pain 7/10;
- basal body temperature 36.6 °C;
- stress; and
- one app-native custom symptom, “Pulling sensation.”

The panel also carries the diary note “Needed to leave work early.”

The custom symptom uses LOINC `75325-1` as the observation name and an app-native code as the result. No unsupported standard mapping is asserted.

## 15 May 2026

The second panel contains menstrual bleeding present, moderate flow, headache, and pain 4/10.

## 20 May 2026

The third panel demonstrates an explicit negative. “Not currently menstruating” is exported because the source state was explicitly verified. The example does not generate negative status Observations for all unlogged dates.

## Native archive and provenance

The Bundle includes an optional Binary containing a compact source JSON example. The Provenance resource links the normalized resources to the source archive and identifies the application that assembled the export.

## JSON resources

The source package includes all generated JSON resources under `fsh-generated/resources`. The full example is also copied to `examples/period-tracking-bundle-example.json` for convenient implementer use.
