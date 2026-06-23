# Period Tracking MVP Implementation Guide

This draft defines a deliberately small FHIR R4 exchange model for **patient-generated menstrual period tracking data**, plus a complete, working path for getting that data from a tracking app into a clinician's hands: export as FHIR, share as an encrypted **SMART Health Link**, and render in a **privacy-preserving client-side viewer**. It is designed for a first interoperable implementation across structurally different mobile and web apps.

## The whole system at a glance

{% include system.svg %}

1. **Model** — an app maps the data it actually stores to three profiles (below). See [Data model](modeling.html) and the [Mapping contract](mapping.html).
2. **Share** — the Bundle is encrypted into a [SMART Health Link](smart-health-links.html) (compact JWE; the file host never sees the key or plaintext).
3. **View** — a [clinician viewer](https://periodicity.fhir.me/) decrypts the link in the browser and renders a cycle summary, **computing all analytics from the granular facts** (no precomputed summaries travel in the Bundle).

### Try it now

- **Open the {% include demo-shlink-link.xhtml %}** — it is a full viewer-prefixed SMART Health Link, so you can copy, paste, or inspect the `shlink:/…` payload directly.
- Inspect the data behind it: the [longitudinal example Bundle](Bundle-period-tracking-longitudinal-example.html) (a synthetic seven-cycle copper-IUD case — the same data the viewer renders).
- Shareable `shlink:/…` links point at this same published viewer (`…/viewer/`), so a recipient opens the link, sees the SHLink preloaded, and clicks Open after identifying themselves.

## The profiles

1. **[Period Tracking MVP Bundle](StructureDefinition-period-tracking-bundle.html)** — a FHIR `collection` Bundle (one Patient, a source-app Device, daily panels, granular facts, Provenance).
2. **[Daily Tracking Panel Observation](StructureDefinition-daily-tracking-panel.html)** — groups the facts recorded for one source calendar date via `hasMember`.
3. **[Period Tracking Fact Observation](StructureDefinition-period-tracking-fact.html)** — one independently meaningful granular fact.

It defines one small [Menstrual Flow ValueSet](ValueSet-menstrual-flow.html), a non-binding [Common Period-Tracking Symptoms](ValueSet-common-tracker-symptoms.html) starter set, and a [project CodeSystem](CodeSystem-cycle.html) of exactly seven concepts. Standard LOINC, SNOMED CT, and UCUM are used for the common clinical core when the source meaning supports them.

## For period-tracking app developers and AI agents

Any menstrual, fertility, or cycle-tracking app — regardless of its internal data model — can adopt this IG. The work is mostly mapping the data you already store and choosing how to host the encrypted share.

**An AI agent adding support to an app should** clone the repo and read the **skill** in place — it's written to be used alongside the repo's example Bundle, sample viewer, and profiles.

- **The skill** (a complete working method for agents) lives at **`skill/SKILL.md`** in the source repository: **[github.com/jmandel/periodicity](https://github.com/jmandel/periodicity)**. Read it in situ (`git clone` then open `skill/SKILL.md`) so its references to `viewer-src/`, `scripts/`, and `input/resources/` resolve. It covers app inventory and field classification, the fact-by-fact FHIR mapping, the missing-data rules, how to make a SMART Health Link, how to reuse or build a viewer, and how to verify end to end.
- **Reference implementation in the repo:** `viewer-src/` (the transform + viewer), `scripts/` (the `bun` generators that build the example Bundle, the SHL, and the viewer), and `input/resources/` (the published example Bundle).
- **Hosting the share:** publish one encrypted JWE file through a static host/CDN/object store, or through a backend endpoint that behaves like a direct-file SHLink (`flag: "U"`). See the [SMART Health Link packaging](smart-health-links.html) guidance for lifetime and use-limit expectations.

Start: **`git clone https://github.com/jmandel/periodicity`, read `skill/SKILL.md`, open the {% include demo-shlink-link.xhtml %}, and inspect the [mapping](mapping.html).**

## Core rule

> Emit only information that the user entered, selected, verified, or measured. Absence of an Observation means **not recorded**, not **absent**.

An explicit negative may be exported only when the source can distinguish it from an untouched default. See [Scope and principles](scope.html).

## What the MVP covers — and deliberately excludes

The normalized layer covers the common clinician-facing core: reported menstrual status, patient-rated flow, symptoms, numeric or ordinal pain severity, basal body temperature, mood, and diary notes. A complete export may also include an optional FHIR `Binary` holding the exact native JSON selected for sharing — a lossless safety net for source fields outside the normalized core.

The MVP does **not** require normalized representations for predictions, cycle summaries, medication adherence, contraception lifecycle, detailed sexual activity, cervical mucus/examination, menstrual products, fertility tests, or app configuration. Apps may keep these in the native archive or add source-coded granular Observations; later versions can standardize what real clinical workflows prove necessary.

## Status

Version 0.1.0 is an implementation draft intended for prototyping and testing. It is not an HL7-balloted implementation guide and does not establish clinical decision rules. The data is patient-generated and is not cryptographically attested clinical content.
