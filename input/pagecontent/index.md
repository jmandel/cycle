# Period Tracking Implementation Guide

This draft defines a deliberately small FHIR R4 exchange model for **patient-generated menstrual period tracking data**. The core handoff is simple: a tracking app exports recorded facts, shares them as an encrypted **SMART Health Link**, and a receiving app or viewer decrypts locally to render a clinician-facing summary.

The required interoperable core is **Layer 0: a bleeding calendar** — menstrual bleeding true/false at the source date or timestamp. Apps can add richer Layer 1 facts such as flow, symptoms, numeric pain severity, and basal body temperature when those facts are actually stored.

## System at a glance

<div class="ptmvp-diagram">
<picture>
  <source media="(max-aspect-ratio: 4/5)" srcset="system-overview-portrait.png" width="864" height="1821" type="image/png">
  <img src="system-overview.png" alt="Three-step overview: source app maps period-tracking data to Layer 0 bleeding facts and optional richer facts, packages the Bundle as an encrypted SMART Health Link, and a receiving viewer decrypts locally to compute clinical views." width="1536" height="1024" loading="eager" fetchpriority="high" decoding="async">
</picture>
</div>

1. **Model** — export the app's real stored data as a [Period Tracking Bundle](StructureDefinition-period-tracking-bundle.html), starting with Layer 0 bleeding facts.
2. **Share** — encrypt the Bundle into a [SMART Health Link](specification.html#smart-health-links); the host never sees the key or plaintext.
3. **View** — decrypt locally and compute summaries from granular facts; no precomputed clinical summary travels in the Bundle.

## Try it now

The same standardized payload can be opened by any compatible viewer or provider scanner. These sample viewers use the same generated SMART Health Link:

{% include sample-viewer-links.md %}

Inspect the data behind them: the [longitudinal example Bundle](Bundle-period-tracking-longitudinal-example.html), a synthetic seven-cycle copper-IUD case.

## Start here

- [Specification](specification.html) defines the wire model, adoption layers, profiles, packaging rules, and security requirements.
- [Implementation](implementation.html) gives the working checklist for app inventory, FHIR mapping, sharing and hosting choices, viewer behavior, testing, and journal prompts.
- [Artifacts](artifacts.html) is the generated reference for profiles, terminology, examples, and machine-readable JSON.

{% assign source_repo = site.data.fhir.ig.contact[0].telecom[0] %}
Source repository: **[{{ source_repo | replace: 'https://', '' }}]({{ source_repo }})**.

Version 0.2.0 is an implementation draft for prototyping and testing. It is not an HL7-balloted implementation guide and does not establish clinical decision rules.
