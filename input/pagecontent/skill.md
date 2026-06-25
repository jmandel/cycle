# AI implementation skill

Use this page when an AI agent is adding cycle.fhir.me support to an app. It is the implementation checklist: inspect the app's real data, map only true stored facts, package them as an encrypted SMART Health Link, and verify the viewer/privacy path end to end.

The authoritative model is the published **Period Tracking MVP Implementation Guide**:

> **IG home:** https://cycle.fhir.me/

Always consult the IG for the normative details — this skill is the working method and the glue; the IG is the source of truth for profiles, codes, and conformance.

**Two URL roles:** `cycle.fhir.me` is the canonical namespace baked into resource URLs (never fetched); the rendered IG/site is where implementers read the guide, generated examples, viewer, and sample SHLink.

This page is also packaged for agents as [`skill.zip`](skill.zip). In that zip, this page becomes `SKILL.md`, the reference pages below become `references/*.md`, and the core IG markdown is included under `spec/` so the download is self-contained.

## Operating rule: drive from the app's real data

Map only what the app actually stores. Read the app's data model, storage, exports, UI, and tests **before** deciding what to map. Do not invent fields the app does not have, and do not emit app *predictions*, *derived caches*, or *unedited defaults* as clinical facts. When normalization is uncertain, preserve the native value (and optionally keep a full native snapshot) rather than guessing.

This restraint is the whole point: the data is sensitive (reproductive, sexual, fertility, mental-health), and a clinician must be able to trust that every fact reflects something the user actually entered, selected, measured, or verified.

**Read the IG home and the References below before you lock a plan** — the sharing flow, host, and viewer choices all turn on constraints spelled out there.

## Workflow

1. **Plan — set criteria first.** Write a short success checklist before coding: which sharing flow (a downloaded file? a bare SHLink QR/link? a viewer-prefixed link?), which viewer or scanner should receive it, the privacy boundary (where plaintext may exist and where it must not), demo-data needs, viewer behavior, and verification steps. Note explicit non-goals. This checklist is your living plan - see [Journal and planning templates](journal-templates.html).

2. **Confirm the high-level choices with the user.** Before building, surface the decisions that change the shape of the work and get the user's call — propose a sensible default, then ask them to confirm or redirect:
   - **Sharing flow** — a downloaded file, a bare SHLink QR/link, or a viewer-prefixed link? Prefer a viewer-prefixed link for broad user-facing QR/copy UX; SHL-aware scanners can still scan that QR and extract the embedded `shlink:/...`.
   - **Ciphertext host** — a static object, the app's own backend, or a deployable blind service ([shlep](https://github.com/jmandel/shlep), self-hostable over any object store)? Frame this as the controls you can *honestly* promise (revocability, expiry, use-limit, passcode), not just cost. See [SMART Health Links implementation notes](smart-health-links-implementation.html).
   - **Viewer** — use the reference viewer source, host your own copy, embed your own, or integrate scanning into a provider app?
   - **Sensitive scope** — which categories (e.g. sexual activity, mental-health, fertility signs) to include versus hold back.

   Decide silently — and record in the journal — the things the user need not weigh in on: FHIR codes per the IG, compression, bundle structure, and demo-seed mechanics.

3. **Inventory the app.** Identify stored daily facts (bleeding state, flow, pain, symptoms, mood, temperature, fertility signs, notes), custom/user-defined symptom labels, predicted/derived/defaulted fields, existing exports, the auth/ownership boundary, and demo-seed and test conventions. Reuse the app's existing repositories, serializers, and build tools.

4. **Classify every candidate field** into one of: `user-entered` (selected/entered/verified/measured/imported) → map it; `derived` (calculated from facts) → usually omit or preserve only as source context; `prediction` (future/probabilistic) → **do not** emit as an observed fact; `default` (UI/schema default, not user intent) → do not emit; `configuration` (goals, reminders, prefs) → out of scope; `not-stored` → cannot map. Only `user-entered` becomes a clinical fact.

5. **Map to the IG model.** Build a `period-tracking-bundle` scoped to one person and containing concrete fact Observations. Always emit the Layer 0 boolean bleeding core when the source represents that state; add Layer 1 flow, symptom, numeric pain, and basal body temperature fact profiles when those data exist. Use standard or IG-preferred value codings only when the meaning is exact enough; otherwise keep a stable app-native concept and text. See the [FHIR mapping reference](fhir-mapping.html).

6. **Honor the missing-data rules** in the [Specification](specification.html#missingness) and [FHIR mapping reference](fhir-mapping.html#missing-data-rules-do-not-skip). "User explicitly said none/no" (an explicit negative) is a *different fact* from "not recorded that day" (emit nothing). Never fabricate negatives from absence.

7. **Share as a SMART Health Link.** Read the [normative packaging guidance](smart-health-links.html) and the [implementation notes](smart-health-links-implementation.html) first. Encrypt the bundle and mint a `shlink:/...`, usually behind a viewer prefix for robust camera/browser UX; SHL-aware scanners can still extract the embedded SHLink. The host only ever sees ciphertext, and any viewer-prefixed link keeps the key in the fragment. The share UI is non-negotiable: **show an on-screen QR**, offer **copy / share** of the same link, and make every share **revocable** (the user can take it down, plus expiry/use-limit where the host supports it).

8. **Render it.** Either point at an existing viewer (the IG ships a reference one), embed a small client-side viewer, or integrate SHLink scanning into a provider app that applies its own display logic. Decrypt in the client and compute the summary from the granular facts - never send decrypted FHIR back to a server. See [Viewer integration](viewer-integration.html).

9. **Verify end to end, tracking progress as you go.** Keep the step-1 plan checklist live - tick items as you complete them (the plan tracks progress; the journal records decisions). Validate the Bundle against the IG; round-trip encrypt/decrypt; confirm the viewer renders; confirm the host never receives plaintext or the key. Keep a journal of mapping decisions and deferred fields.

## The data model in one screen

- **Bundle** (`period-tracking-bundle`): a `collection` scoped to one person with at least one menstrual bleeding fact. Patient, Device, and Binary native snapshot are optional.
- **Fact base** (`period-tracking-fact`): abstract base for one independently meaningful `Observation` — a `code`, an `effectiveDateTime` at date or timestamp precision, and exactly one `value[x]`. `subject` and `device` are optional.
- **Concrete facts**: use the specific bleeding, flow, symptom, numeric pain, and basal body temperature profiles when those buckets apply.

Layer 0 and Layer 1 facts - codes and values in the [FHIR mapping reference](fhir-mapping.html):

| Fact | code |
|---|---|
| Bleeding core | `cycle#menstrual-bleeding` (`valueBoolean`) |
| Flow intensity | `cycle#menstrual-flow` (coded `flow-none`/`flow-spotting`/`flow-light`/`flow-moderate`/`flow-heavy`) |
| Pain (0–10) | LOINC `72514-3` |
| Symptom | `cycle#symptom` with a SNOMED or app-native value |
| Basal body temperature | LOINC `8310-5` (category `vital-signs`) |

Bleeding (`menstrual-bleeding`) is the universal emitted Layer 0 core. Flow intensity (`menstrual-flow`) is an optional Layer 1 fact that characterizes bleeding; a flow-capable app emits both, not flow instead of the boolean. The receiver derives episodes, cycle lengths, and medians from the facts - summaries do **not** travel in the bundle.

## References

Skim all of these (and the IG home) before locking the plan; re-read each in depth when you reach its phase. The **Read before** tags index which reference anchors which phase.

- [FHIR mapping reference](fhir-mapping.html) - the concrete fact-by-fact mapping, terminology, flow/missing-data rules, and a worked bundle to copy from. **Read before building the export.**
- [SMART Health Links packaging](smart-health-links.html) - the normative Period Tracking MVP SHLink packaging guidance (lifetime, use-limit, share shape). **Read before building sharing.**
- [SMART Health Links implementation notes](smart-health-links-implementation.html) - the sharing UX checklist (present + manage), the host-decision table, payload/encryption details, and local scripts. **Use after the packaging page.**
- [Viewer integration](viewer-integration.html) - how the reference client-side viewer works (decrypt, transform, render) and how to reuse or embed it. **Read before building a viewer.**
- [Journal and planning templates](journal-templates.html) - the plan checklist, journal, and mapping-issue templates to keep in the target repo.

## What "done" looks like

The app can demonstrate the patient→clinician path end to end: a FHIR Bundle built from real stored data, validated against the IG; an encrypted SHL the user can share (link or QR); a client-side render of the summary; and a verified privacy boundary (the host never sees plaintext or the key). Mapping decisions, intentionally omitted fields, and any incompatibilities are written down.
