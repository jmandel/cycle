# Period Tracking MVP Implementation Guide

This draft defines a deliberately small FHIR R4 exchange model for **patient-generated menstrual period tracking data**, plus a complete, working path for getting that data from a tracking app into a clinician's hands: export as FHIR, share as an encrypted **SMART Health Link**, and render in a **privacy-preserving client-side viewer**. The included viewer is a reference/default implementation; apps and provider systems can host their own viewer, use an EHR-integrated scanner, or exchange bare `shlink:/...` values. The guide is designed for a first interoperable implementation across structurally different mobile and web apps.

## The whole system at a glance

<div class="ptmvp-diagram">
<picture>
  <source media="(max-aspect-ratio: 4/5)" srcset="system-overview-portrait.png" width="864" height="1821" type="image/png">
  <img src="system-overview.png" alt="Three-step overview: source app maps period-tracking data to Layer 0 bleeding facts and optional richer facts, packages the Bundle as an encrypted SMART Health Link, and a receiving viewer decrypts locally to compute clinical views." width="1536" height="1024" loading="eager" fetchpriority="high" decoding="async">
</picture>
</div>

1. **Model** — an app maps the data it actually stores to the Bundle profile and concrete fact profiles below. See the [Specification](specification.html) and the [FHIR mapping reference](fhir-mapping.html).
2. **Share** — the Bundle is encrypted into a [SMART Health Link](smart-health-links.html) (compact JWE; the file host never sees the key or plaintext).
3. **View** — a receiving app decrypts the link and renders a cycle summary, **computing all analytics from the granular facts** (no precomputed summaries travel in the Bundle). The site includes [reference clinician viewer variants](view.html) as compatible receivers.

### Try it now

- **Open the reference viewer:** [view.html](view.html) — the published site build includes the generated sample link next to the viewer.
- **Compare viewer variants:** [view2.html](view2.html) is a binary-first clinician view that derives the cycle picture from Layer 0 before showing optional overlays; [view3.html](view3.html) is a bleeding-first alternate that foregrounds Layer 0 extrapolations before optional overlays.
- Inspect the data behind it: the [longitudinal example Bundle](Bundle-period-tracking-longitudinal-example.html) (a synthetic seven-cycle copper-IUD case — the same data the viewer renders).
- The sample is published through the [reference viewer](view.html) as a viewer-prefixed SHLink because that is the most robust default for ordinary browser launch. A provider's dedicated receiving app can scan that same QR, ignore the viewer prefix, and process the embedded `shlink:/...` with its own display logic.

## The profiles

1. **[Period Tracking MVP Bundle](StructureDefinition-period-tracking-bundle.html)** — a FHIR `collection` Bundle scoped to one person's period-tracking data. It requires at least one bleeding core fact; Patient and Device resources are optional.
2. **[Period Tracking Fact Observation](StructureDefinition-period-tracking-fact.html)** — the abstract base profile for one independently meaningful granular fact.
3. **[Menstrual Bleeding Fact Observation](StructureDefinition-menstrual-bleeding-fact.html)** — the required boolean core fact.
4. **[Menstrual Flow Fact Observation](StructureDefinition-menstrual-flow-fact.html)** — optional ordinal flow intensity.
5. **[Symptom Fact Observation](StructureDefinition-symptom-fact.html)** — optional symptom facts with the specific symptom in `valueCodeableConcept`.
6. **[Numeric Pain Severity Fact Observation](StructureDefinition-numeric-pain-severity-fact.html)** — optional 0-10 pain score.
7. **[Basal Body Temperature Fact Observation](StructureDefinition-basal-body-temperature-fact.html)** — optional timed or day-scoped basal body temperature.

It defines one small [Menstrual Flow ValueSet](ValueSet-menstrual-flow.html), a non-binding [Common Period-Tracking Symptoms](ValueSet-common-tracker-symptoms.html) starter set, a small fact-category ValueSet, and a [project CodeSystem](CodeSystem-cycle.html) of exactly eight concepts. The universal Layer 0 core is `menstrual-bleeding` true/false at the source date or timestamp; standard LOINC, SNOMED CT, and UCUM are used for optional Layer 1 facts when the source meaning supports them.

## For period-tracking app developers and AI agents

Any menstrual, fertility, or cycle-tracking app — regardless of its internal data model — can adopt this IG. The work is mostly mapping the data you already store and choosing how to host the encrypted share.

**An AI agent adding support to an app should** start with the [AI implementation skill](skill.html). It is the implementation checklist for inspecting real app data, mapping only stored facts, packaging an encrypted SHLink, and verifying the viewer/privacy path.

- **The skill** (a complete working method for agents) is browsable at [skill.html](skill.html) and downloadable as a self-contained [skill.zip](skill.zip). The zip maps this page to `SKILL.md`, includes the skill references, and includes the core spec markdown under `spec/`.
- **Reference implementation in the repo:** `viewer-src/` (the transform + viewer source) and `scripts/` (the `bun` generators that build the example Bundle, the SHL, and the viewer as build artifacts).
- **Hosting the share:** use an application backend or deployable blind SHLink service that can actually enforce revocation, expiry, use limits, passcodes, and access logs. See the [SMART Health Links reference](smart-health-links-implementation.html) for the implementation choices.

{% assign source_repo = site.data.fhir.ig.contact[0].telecom[0] %}
Source repository: **[{{ source_repo | replace: 'https://', '' }}]({{ source_repo }})**.

## Core rule

> Emit only information that the user entered, selected, verified, or measured. Absence of an Observation means **not recorded**, not **absent**.

An explicit negative may be exported only when the source can distinguish it from an untouched default. See [Scope and conformance principles](specification.html#scope-and-conformance-principles).

## What the MVP covers — and deliberately excludes

The MVP has three adoption layers. **Layer 0: Core bleeding facts** is required for compatibility: `menstrual-bleeding` true/false at the source date or timestamp. **Layer 1: Structured optional facts** adds patient-rated flow, symptoms, numeric pain severity, and basal body temperature when available. **Layer 2: Native archive** optionally adds a FHIR `Binary` holding the exact native JSON selected for sharing — a lossless safety net for source fields outside the normalized facts.

The MVP does **not** require normalized representations for predictions, cycle summaries, medication adherence, contraception lifecycle, detailed sexual activity, cervical mucus/examination, menstrual products, fertility tests, or app configuration. Apps may keep these in the native archive or add source-coded granular Observations; later versions can standardize what real clinical workflows prove necessary.

## Status

Version 0.1.0 is an implementation draft intended for prototyping and testing. It is not an HL7-balloted implementation guide and does not establish clinical decision rules. The data is patient-generated and is not cryptographically attested clinical content.
