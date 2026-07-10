# Multi-IG Site Generator and Bun Publisher Plan

> **Historical research and implementation plan.** Current site generation is
> documented in [`site-gen/README.md`](site-gen/README.md). In particular,
> `site.db` is now one Cycle compatibility artifact, the portable renderer
> consumes a verified `ClosedSiteBuild` through `SiteBuildView`, and the CLI and
> browser share `CycleSiteRenderer` plus one LiquidJS content policy.

This plan describes the work needed before `site-gen` and the experimental Bun
publisher can be used safely across multiple FHIR IGs. The goal is a small,
clear, reproducible toolchain, not a second full IG Publisher.

## Principles

- **Clarity first.** Each stage should have one job and a visible input/output
  contract.
- **Immutable derivation.** Prefer pure derivation functions that return rows or
  models. Only the final DB writer should mutate SQLite.
- **DRY canonical resolution.** Resolve FHIR resources by canonical URL/version
  in one place. Do not duplicate lookup logic across terminology, artifact
  pages, links, and validators.
- **Small abstractions.** Use plain data types and functions until real
  duplication appears. Avoid framework-shaped abstractions ahead of need.
- **Fail loudly on unsupported semantics.** Never render empty or misleading
  terminology output when a ValueSet uses a construct we do not support.
- **Optimize through simplicity.** Resolve only declared dependencies, index
  once, use one SQLite transaction, and avoid work the site does not consume.
- **Project-specific behavior is data/config.** Cycle-specific ordering, labels,
  art direction, and content should not live in generic FHIR modules.
- **No accidental clinical authority.** The fast path may render and package IG
  artifacts, but it must not imply terminology, profile, or example validation
  it has not actually performed.
- **Security and provenance are part of reproducibility.** Package downloads,
  terminology results, generated DBs, and rendered QA pages should be traceable
  to explicit inputs.

## Scope and Non-Goals

This work is about a reusable static IG site generator and an experimental
Publisher-compatible package DB producer. It is not a replacement for every Java
Publisher feature.

In scope:

- generating the subset of `package.db` that site-gen consumes;
- rendering profiles, terminology, examples, narrative pages, images, QA files,
  and machine-readable artifacts from explicit inputs;
- resolving FHIR packages from a clean cache;
- classifying terminology work and delegating semantics we cannot safely
  implement;
- validating enough to prevent false confidence in examples and generated
  content; and
- proving the pipeline against more than one IG.

Out of scope until explicitly added:

- reimplementing SUSHI or FSH compilation;
- reimplementing SNOMED CT, LOINC, RxNorm, or full terminology-server behavior;
- pretending best-practice Publisher warnings are the same as conformance
  errors;
- silently fabricating Publisher output that was not derived from real
  resources; and
- keeping compatibility shims for experimental APIs we just invented.

## Target Pipeline

```text
FSH + resources + config
  -> SUSHI with snapshot output
  -> generated FHIR JSON with StructureDefinition.snapshot.element
  -> snapshot gate
  -> Publisher-fidelity enrichment checks
  -> package resolver
  -> canonical resource index
  -> dependency and terminology plan
  -> package.db rows
  -> site DB ingest
  -> static render
  -> project extras
  -> link and QA checks
```

The toolchain now orchestrates SUSHI through a thin programmatic adapter over
SUSHI's exported lower-level APIs. It still treats SUSHI as the FSH compiler
boundary and does not import the CLI entrypoint or duplicate compiler logic.
SUSHI snapshot output is a maintained structural input, not proof that the
generated resource JSON is identical to Java Publisher output. The Java
Publisher also enriches and normalizes resources: generated narrative, dates,
publisher/contact metadata, canonical version pinning, IG page/parameter
extensions, snapshot provenance extensions, constraint sources, and some
documentation/comment handling can differ. The Bun publisher must compare and
classify these differences explicitly; the renderer must not depend on
accidental omissions.

It also must not reconstruct profile snapshots inside the renderer:
`Resources.Json.snapshot.element` is the profile rendering contract. If local
StructureDefinitions lack snapshots, the publisher must fail before writing
`package.db`.

## Current Baseline

Known useful state:

- Cycle can be built from SUSHI-generated resources into a Bun-produced
  `package.db` when SUSHI is run with `--snapshot`.
- Cycle currently compares exactly against Java Publisher `output/package.db`
  for the tables covered by `site-gen/publisher/compare.ts`: resources,
  concepts, ValueSet/CodeSystem indexes, source labels, OIDs, refs, and empty
  `ValueSet_Codes` in the default terminology-off mode. The compare script now
  writes a Markdown report beside the generated DB and exits non-zero on
  differences. It also includes a review-only raw `Resources.Json` fidelity
  section, classifying drift as structural constraints, human documentation,
  generated metadata, generated narrative, canonical version decoration, or
  extension/provenance metadata.
- IPS can run through the same in-process SUSHI adapter and Bun publisher
  without using Java Publisher output as input. With `PUBLISHER_TX_METADATA`
  using either live tx lookup or warmed cache, the IPS run compares exactly
  against Java Publisher `output/package.db` for the current compare surface:
  `Resources`, concepts, ValueSet/CodeSystem indexes, source labels, OIDs,
  refs, and empty `ValueSet_Codes`; the raw `Resources.Json` fidelity section
  is also reported for review.
- A minimal R5 fixture now exercises the non-R4 path across package resolution,
  metadata path derivation, StructureDefinition base canonical version pinning,
  package-aware source labels, SQLite row writing, and external ValueSet links.
  This is a small synthetic guardrail, not a substitute for a realistic R5 IG
  pilot.
- IPS additional binding extensions
  (`http://hl7.org/fhir/tools/StructureDefinition/additional-binding`) are now
  included in ValueSet reference extraction. This removed the broad missing
  reference class where profiles bind a primary ValueSet and also advertise
  additional candidate ValueSets.
- The Bun DB can be compared against Java Publisher output for the tables
  site-gen currently consumes.
- Current cycle terminology is simple enough to classify and expand locally:
  explicit concept lists only, no filters, no nested imports, and no excludes.
- A blank FHIR package cache can be populated from declared package
  dependencies.
- Bun publisher builds now write a sibling build manifest recording the exact
  resolved package graph, package cache root, registry endpoint, cache/download
  source, and downloaded tarball SHA-256 digests when packages are fetched
  during that run. The same manifest now records terminology modes and a
  per-ValueSet strategy summary, including classification, reasons, expansion
  status, source, and code count when expansion rows were prepared.
- ValueSet strategy classification now walks `compose` grammar without
  materializing local/package expansions. Actual local expansion is bounded by
  `PUBLISHER_TX_MAX_CODES`, so large complete CodeSystems or imported sets fail
  diagnostically when expansion rows are requested rather than silently
  truncating or producing an unusable `ValueSet_Codes` table.
- The build manifest records the integrated SUSHI stage: whether it ran, the
  SUSHI version, snapshot mode, output directories, generated resource count,
  newest generated-resource timestamp, FSH compiler-input count/newest
  timestamp, and SUSHI output counts. This makes the snapshot-producing
  compiler boundary auditable instead of implicit.
- Skipped-SUSHI runs now fail early when the newest FSH/compiler input is newer
  than the newest generated resource, preventing package DB publication from
  stale `fsh-generated/resources`.
- `PUBLISHER_PACKAGE_DOWNLOADS=off` now turns missing package downloads into an
  explicit failure, so CI can prove a warm-cache run without relying on hidden
  network access by the Bun package resolver.
- `bun run test:publisher:blank-cache` now provides a networked smoke test for
  the blank-cache path: first build with an empty temporary FHIR package cache,
  then a warm-cache `PUBLISHER_RUN_SUSHI=0` build with package downloads
  disabled, followed by compare when Java Publisher `output/package.db` is
  present.
- The blank-cache smoke is parameterized with `SUSHI_PROJECT`, `SUSHI_OUT`,
  `EXPECTED_DB`, and `PUBLISHER_SMOKE_LABEL`, so the same harness can be run
  against Cycle or a local IPS checkout instead of proving only this repository
  layout.
- The blank-cache smoke also supports separate first-pass and offline-pass
  terminology modes, for example online CodeSystem metadata lookup followed by
  cache-only replay for IPS.
- `bun run test:publisher:ips` now makes the IPS pilot explicit: use or clone
  the IPS IG, ensure Java Publisher `output/package.db` exists when comparison
  is required, then run the blank-cache Bun publisher smoke against that
  checkout.
- The same external-IG harness now has SDC and Da Vinci CRD wrappers
  (`bun run test:publisher:sdc` and `bun run test:publisher:crd`). They are
  now promoted into the recurring publisher-safety matrix with Cycle and IPS.
- SDC now builds from a blank package cache, replays offline without downloads,
  and compares exactly against Java Publisher `output/package.db` for the
  current compare surface: `Resources`, concepts, ValueSet/CodeSystem indexes,
  source labels, OIDs, refs, and empty `ValueSet_Codes`. Extension slices whose
  type profile fixes `Extension.url` are matched without flooding CI logs from
  FHIRPath `trace()`. Sliced Extension `ext-1` validation handles `value[x]`
  choice aliases using a type-aware FHIRPath base. The local `dom-3` evaluator
  uses fhirpath model metadata to detect `reference`, `canonical`, `uri`, and
  `url` descendants, including contained resources and primitive companion
  extensions; sliced primitive `ele-1` validation treats raw JSON primitive
  values as present. Ordinary FHIRPath constraints resolve local references
  through the in-memory resource index, so SDC's `Task.focus.resolve()`
  invariants evaluate without async/network warnings. Current SDC validation
  has three warning-level authored constraints plus 60 separately reported
  generated narrative warnings from `dom-6`.
- Da Vinci CRD now builds from a blank package cache, replays offline without
  downloads, and compares exactly against Java Publisher `output/package.db`
  for the current compare surface. CRD includes authored JSON
  StructureDefinitions outside SUSHI's generated output; the Bun publisher now
  completes missing local snapshots from a base snapshot plus the differential,
  or from the normalized differential for logical specializations whose base is
  FHIR `Base`. CRD now has no ordinary validation issues, with 18 separately
  reported generated narrative warnings from `dom-6` and no FHIRPath
  evaluation warnings.
  The previous 6 false `ext-1` errors, 2 false
  `Appointment.participant` slice errors were fixed by type-aware Extension
  FHIRPath evaluation and relative `resolve()` profile-discriminator matching;
  the SDC-driven `dom-3`, sliced primitive `ele-1`, and ordinary local
  `resolve()` fixes keep CRD warning-only.
- The Pages workflow now runs publisher unit tests in the normal build, caches
  Bun install data and FHIR packages for warm deploy builds, and runs the
  Cycle, IPS, SDC, and Da Vinci CRD publisher pilots on a weekly/manual
  non-deploying safety job in the same workflow. The safety job also caches
  Bun install data and the shared FHIR package cache so recurring Java
  Publisher comparisons do not depend on a completely cold global package
  cache. The scheduled safety job uses a separate
  concurrency group so it cannot cancel a Pages deploy.
- Package registry fetches are bounded by
  `PUBLISHER_PACKAGE_DOWNLOAD_TIMEOUT_MS` so a stalled registry cannot hang the
  publisher indefinitely.
- Canonical resource resolution is now centralized for the publisher: current
  IG resources, core package resources, dependency package resources, and
  terminology-service CodeSystem metadata all pass through one resolver. This
  keeps local-resource precedence, THO dependency-before-core behavior, and
  terminology metadata fallback testable outside the DB writer.
- The snapshot contract is now a tested publisher boundary: local
  StructureDefinitions without `snapshot.element` fail before DB writing, so
  profile rendering remains based on DB snapshots rather than renderer-side
  reconstruction.
- Phase 2 now has a dedicated package resource index boundary:
  package-directory enumeration and `.index.json` handling live in
  `site-gen/publisher/package-index.ts`, while canonical resolution consumes the
  resulting resource entries.
- Phase 4 row extraction has started: metadata, `Resources`, local CodeSystem
  concept rows, `ValueSet_Codes` expansion rows, and ValueSet/CodeSystem list
  index rows are now derived by pure functions and unit-tested before SQLite
  insertion.
- SQLite mutation is now isolated in `site-gen/publisher/writer.ts`; `build.ts`
  orchestrates SUSHI, package resolution, resource loading, terminology, and
  row derivation, then hands a row bundle to the writer.
- First-pass implementations already exist for package resolution, canonical
  indexing, and terminology classification. The phases below still describe the
  hardening needed before relying on them across IGs.
- Example validation now writes a sidecar QA report. It uses IG
  `exampleCanonical` and inline `meta.profile` assignments, checks structural
  and pattern requirements from snapshots, validates required local bindings,
  can call cached/online ValueSet `$validate-code`, and follows common
  single-level Bundle profile assertions without requiring examples to stamp
  `meta.profile` redundantly.

Known risks:

- IPS and other real IGs use terminology constructs that require a terminology
  service or a cached expansion/validation result.
- The former IPS package DB differences have been chased into generic rules:
  - DICOM CID 29 now resolves through the pinned Publisher ambient package set;
    this mirrors the Java/FHIR Publisher context without relying on chance
    local cache state;
  - THO ValueSets resolve from terminology packages before R4 core, and
    dependency Web links use package-derived web locations;
  - versioned ValueSet system URIs remain visible in `ValueSetListSystems` but
    are not turned into duplicate `CodeSystemList` rows;
  - EDQM (`http://standardterms.edqm.eu`) and ISCO
    (`urn:oid:2.16.840.1.113883.2.9.6.2.7`) CodeSystem metadata is resolved
    through cached `CodeSystem?url` terminology lookup, not by hardcoded
    constants.
- Some Java Publisher output is expensive or brittle because it performs live
  terminology lookups during rendering.
- Site-gen still needs a crisp boundary between generic FHIR rendering and
  project-specific content/design.
- The experimental Bun publisher is only profile-renderer-grade when local
  StructureDefinition resources already contain full snapshots. Differential
  chains and inherited binding heuristics are useful diagnostics, not a
  replacement for snapshots.
- SUSHI-generated snapshots are structurally close to Java Publisher snapshots
  for Cycle, but they are not byte-for-byte or documentation-equivalent. Current
  observed deltas include version-pinned canonical references, generated
  narrative, snapshot provenance extensions, constraint sources, FHIR type
  display extensions, and comment/doc handling. Comments and extensions must be
  classified case-by-case because some drive the human rendering.
- Multi-IG support must avoid hardcoded page names, profile groups, menu shapes,
  asset names, and root-path assumptions.

## Phase 0: Stabilize the Current Experiment

Purpose: keep the current fast path useful while making its limits explicit.

Work:

- Keep `site-gen/publisher/build.ts` as an experiment, but make the stage
  boundaries visible in the code.
- Keep `PUBLISHER_PROFILE=1` phase timing.
- Keep a single SQLite transaction for DB writes.
- Keep package sidecar cleanup for `.db`, `.db-wal`, and `.db-shm`.
- Document that concurrent writers must use distinct `OUT_DB` paths.
- Keep `compare.ts` as the fidelity gate against Java Publisher output.

Acceptance criteria:

- `PUBLISHER_RUN_SUSHI=0 bun run experiment:package-db` completes in under 1s
  on a warm local cache for this IG. Full integrated runs are allowed to be
  dominated by SUSHI snapshot generation.
- `bun run experiment:package-db && bun run experiment:package-db:compare`
  reports exact rows for the current Cycle compare surface.
- Site-gen can render from the generated DB with no dangling internal links.

## Phase 1: Blank-Slate Package Resolution

Purpose: make the Bun publisher work in clean CI where `~/.fhir/packages` does
not already exist.

Work:

- Add `site-gen/publisher/packages.ts`.
- Read required package roots from:
  - `sushi-config.yaml` `fhirVersion`;
  - generated IG/package metadata when available;
  - explicit IG dependencies;
  - generated `ImplementationGuide.definition.extension` package context
    (`ig-internal-dependency` and pinned `ig-link-dependency`);
  - each package's own `package/package.json` dependencies.
- Ensure required packages are present:
  - FHIR core package, for example `hl7.fhir.r4.core#4.0.1`;
  - Publisher ambient packages, pinned for reproducibility:
    - `hl7.fhir.pubpack` and `hl7.fhir.xver-extensions`, matching Java IG
      Publisher's worker-context bootstrap;
    - HL7 Extension Pack and HL7 Terminology, matching Java IG Publisher's
      auto-added dependencies when an IG omits them;
    - HL7 tools package, matching Java IG Publisher's tooling context for
      Publisher-defined extensions and related terminology;
    - DICOM and IHE format-code terminology context, matching the FHIR spec
      Publisher's ambient terminology packages;
  - generated IG internal package context and declared transitive dependencies.
- Support explicit package controls:
  - `PUBLISHER_AMBIENT_PACKAGES=off` to disable ambient packages;
  - `PUBLISHER_AMBIENT_PACKAGES="pkg#version ..."` to replace the ambient set;
  - `PUBLISHER_EXTRA_PACKAGES="pkg#version ..."` to append pinned context
    packages without changing IG dependency metadata.
- Treat IG-declared dependencies and generated IG internal package context as
  transitive. Treat ambient, link, and operator-extra context packages as
  non-transitive unless the IG declares them itself. This mirrors Java
  Publisher's no-load-deps handling for packages it loads on its own initiative
  and avoids accidental old package versions in blank-cache builds.
- Support a deterministic cache root:
  - default `~/.fhir/packages`;
  - CI override such as `FHIR_PACKAGE_CACHE=temp/fhir-package-cache`.
- Download missing packages from the FHIR package registry.
- Fail clearly when package downloads are disabled and a required package is
  missing.
- Bound package registry fetches with a configurable timeout.
- Add a package lock or generated manifest recording exact package versions used
  by a build.
- Record package source, resolved URL, and integrity data when the registry
  supplies it. If the registry does not supply enough integrity metadata, record
  the downloaded tarball digest in the build manifest. The current build
  manifest is written beside the generated DB by default and can be overridden
  with `PUBLISHER_BUILD_MANIFEST`.

Acceptance criteria:

- With an empty `FHIR_PACKAGE_CACHE`, the package resolver installs the required
  packages and the Bun publisher completes.
- With network disabled and a warm cache, the same build completes offline.
- The resolved package set is printed and is stable across repeated runs.
- A build report can answer: which packages were used, where they came from, and
  whether they were downloaded or already cached.

## Phase 2: Canonical Resource Index

Purpose: replace ad hoc scanning and lookup with one reusable canonical index.

Work:

- Add `site-gen/publisher/canonical.ts`.
- Add `site-gen/publisher/package-index.ts`.
- Define plain immutable types:

```ts
type CanonicalKey = {
  resourceType: string;
  url: string;
  version?: string;
};

type PackageId = {
  name: string;
  version: string;
};

type IndexedResource = {
  key: CanonicalKey;
  package?: PackageId;
  sourcePath: string;
  resource: Json;
};
```

- Build a canonical index from local generated resources plus package resources.
- Prefer package `.index.json` or package metadata when available.
- Fall back to scanning package JSON once and cache the result by package
  name/version.
- Resolve all resources through one API:

```ts
resolveResource(index, { resourceType, url, version });
```

- Remove duplicate `findValueSet`, `findCodeSystem`, and page/source lookup
  logic.
- Track source provenance for each indexed resource:
  - generated by the current IG;
  - input resource from the current IG;
  - dependency package resource;
  - external generated artifact copied from Publisher output.
- Keep CodeSystem URL ownership and NamingSystem URI aliases separate. A
  NamingSystem can identify an external code system, but it is not itself a
  CodeSystem resource and should not be treated as one for source labels or
  CodeSystem list rows.

Acceptance criteria:

- No generic site-gen or publisher module scans package directories directly
  except the package index builder.
- All canonical lookups go through the same resolver.
- The generated DB remains compatible with current compare output.
- Any artifact page can explain whether the underlying resource is local to the
  IG or inherited from a package dependency.

## Phase 2A: Snapshot Generation Contract

Purpose: make profile rendering correct by requiring full
`StructureDefinition.snapshot.element` content before package DB rows are
written.

Work:

- Invoke SUSHI programmatically with snapshot generation enabled for FSH-based
  IGs as part of the Bun publisher run.
- Treat local StructureDefinitions without `snapshot.element` as invalid input
  for the Bun publisher.
- Preserve the full resource JSON, including both `differential` and
  `snapshot`, in the `Resources.Json` column.
- Derive snapshot-scope views, such as all used ValueSets, from actual
  `snapshot.element` bindings, not from a reconstructed differential chain.
- Keep authored differential metadata for authored/differential views, but do
  not use it as a substitute for snapshots.
- Add a resource-JSON fidelity report that separates:
  structural constraints,
  human documentation (`short`, `definition`, `comment`, `requirements`),
  generated metadata/narrative,
  canonical version decoration,
  and extension/provenance metadata. Do not silently normalize any category that
  the renderer might display.
- If an IG supplies non-FSH StructureDefinitions, require that they already
  carry snapshots or run a trusted snapshot-generation stage before DB writing.
- Add a fixture that intentionally omits snapshots and proves the publisher
  fails with a clear message.

Acceptance criteria:

- `bun run experiment:package-db` invokes SUSHI and emits local
  StructureDefinitions with non-empty `snapshot.element` before DB writing.
- `bun run experiment:package-db` fails before writing the DB when any local
  profile lacks a snapshot.
- The generated `Resources.Json` rows contain the snapshots site-gen renders.
- Profile pages can render the Key elements, Differential, and Snapshot tabs
  from DB content alone.
- There is no renderer-side profile inheritance or snapshot reconstruction
  path.
- Compare reports include a raw resource JSON fidelity section that makes
  documentation, extension, generated narrative, canonical version decoration,
  and structural drift visible for review without pretending all categories are
  harmless.

## Phase 3: Package DB Contract

Purpose: define exactly what part of Java Publisher's `package.db` we are
compatible with, so site-gen does not depend on accidental rows.

Work:

- Document the DB tables site-gen reads today.
- For each table, classify it:
  - required by generic rendering;
  - required only by cycle-specific rendering;
  - useful for future rendering;
  - ignored.
- Add a generated schema/version marker for Bun-produced DBs.
- Keep the table and column names compatible with Java Publisher where we use
  them.
- Add a contract test that opens a DB and verifies the minimum table/column set
  required by site-gen.
- Move any non-Publisher extension data into explicitly named site-gen tables
  during ingest, not into fake Publisher rows.

Acceptance criteria:

- A maintainer can see the DB surface area this project promises to produce.
- Site-gen fails clearly when a required table/column is missing.
- Compare output distinguishes harmless extra Publisher tables from meaningful
  differences in consumed tables.
- Compare reports are written as reviewable artifacts and can be used as CI
  gates because non-zero differences fail by default.

## Phase 4: Derived Rows Before SQLite Writes

Purpose: make the publisher easier to test, optimize, and reason about.

Work:

- Add `site-gen/publisher/rows.ts`.
- Split DB generation into:
  - pure row derivation;
  - SQLite schema creation;
  - SQLite row writing.
- Replace functions that both derive and insert rows, such as
  `insertIndexedLists`, with pure derivation:

```ts
const rows = derivePackageDbRows({ resources, index, terminology });
writePackageDb(db, rows);
```

- Keep generated row order deterministic.
- Make each row type explicit, matching the DB schema.

Acceptance criteria:

- Unit tests can verify ValueSet/CodeSystem index rows without opening SQLite.
- The DB writer contains SQL only, not terminology/package traversal rules.
- Compare output remains stable.

## Phase 5: Terminology Guardrails

Purpose: prevent silently wrong ValueSet output.

Work:

- Add `site-gen/publisher/terminology.ts`.
- Classify every ValueSet before expansion/indexing:

```ts
type ValueSetClassification =
  | { kind: "local-extensional" }
  | { kind: "external-extensional" }
  | { kind: "intensional"; reason: string }
  | { kind: "unsupported-without-tx"; reason: string };
```

- Detect and report:
  - `compose.include.concept`;
  - `compose.include.filter`;
  - `compose.include.valueSet`;
  - `compose.exclude`;
  - versioned systems;
  - CodeSystem `content` mode.
- Fail loudly when expansion is requested for unsupported constructs.
- Never emit an empty expansion just because a construct is unsupported.
- Emit a build summary listing each ValueSet and its expansion strategy.

Acceptance criteria:

- Current cycle IG classifies cleanly.
- A fixture ValueSet with `include.filter` fails with a specific message when
  terminology service support is off.
- A fixture ValueSet with `include.valueSet` fails or expands depending on the
  implemented support level.
- No unsupported ValueSet can produce an empty `ValueSet_Codes` table silently.
- The build manifest records every ValueSet's terminology strategy even when
  `PUBLISHER_TX=off`, so an intentionally empty `ValueSet_Codes` table is
  accompanied by explicit classification evidence.

## Phase 6: Local Extensional Expander

Purpose: fully support the safe offline subset.

Work:

- Implement local expansion only for complete CodeSystems available in the
  current IG or resolved package context, explicit `include.concept` lists, and
  whole-system includes where that complete CodeSystem is available.
- Add display backfill from local CodeSystem concepts.
- Honor CodeSystem `content`; only `complete` is locally expandable.
- Treat `fragment`, `example`, and `not-present` as not locally expandable.
- Preserve system/version/code/display in expansion rows.

Acceptance criteria:

- Local extensional ValueSets expand deterministically.
- Fragment/example CodeSystems do not masquerade as complete CodeSystems.
- Expansion rows include enough provenance to explain source system/version.

## Phase 7: Nested ValueSet and Exclude Set Algebra

Purpose: support common local composition without a terminology server.

Work:

- Implement recursive `include.valueSet` resolution for available local/package
  ValueSets while emitting expansion rows only for the current IG's ValueSets.
- Detect cycles and report a useful error path.
- Implement `compose.exclude` as set subtraction.
- Keep expansion immutable: each operation returns a new set.
- Add a maximum expansion size and diagnostics when exceeded.

Acceptance criteria:

- Nested local ValueSets expand correctly.
- Excludes remove matching system/version/code tuples.
- Recursive import loops fail clearly.
- Huge expansions are bounded and marked incomplete rather than silently
  truncated.

## Phase 8: Terminology Service Cache and Delegation

Purpose: support real terminology semantics without reimplementing SNOMED,
LOINC, or RxNorm.

Work:

- Add `site-gen/publisher/tx-cache.ts`.
- Define terminology modes:
  - `PUBLISHER_TX=off`: no terminology service calls and no expansion rows;
    this preserves Publisher-compatible `ValueSet_Codes` output when a site
    does not need expansions.
  - `PUBLISHER_TX=local`: expand only the safe local/offline subset and fail on
    filters, unavailable whole-system includes, unavailable imports, or
    incomplete CodeSystems.
  - `PUBLISHER_TX=cache`: use committed/cache files only; no network.
  - `PUBLISHER_TX=online`: call configured terminology server and write cache.
  - `PUBLISHER_TX=refresh`: refresh cache entries.
- Define CodeSystem metadata modes separately because list metadata is useful
  even when `ValueSet_Codes` expansion is intentionally disabled:
  - `PUBLISHER_TX_METADATA=off`: no metadata lookup;
  - `PUBLISHER_TX_METADATA=cache`: use reviewed cache only;
  - `PUBLISHER_TX_METADATA=online`: fetch missing CodeSystem metadata and write
    cache;
  - `PUBLISHER_TX_METADATA=refresh`: refresh metadata cache.
  If omitted, metadata mode follows `PUBLISHER_TX` for `cache`, `online`, and
  `refresh`, and otherwise remains `off`.
- Use standard FHIR operations:
  - ValueSet `$expand`;
  - CodeSystem search by canonical URL (`CodeSystem?url=...`) for metadata
    needed by CodeSystem list rows;
  - ValueSet/CodeSystem `$validate-code`;
  - optional CodeSystem `$lookup`.
- Use content-addressed cache keys based on:
  - operation;
  - normalized request resource or canonical URL/version;
  - system versions;
  - expansion parameters;
  - terminology server identity/version when available.
- Store cache entries under a reviewable path such as:

```text
input/tx-cache/expand/sha256-<hash>.json
input/tx-cache/CodeSystem?url/sha256-<hash>.json
input/tx-cache/validate-code/sha256-<hash>.json
```

- Do not call a remote terminology server in default CI unless explicitly
  enabled. CI can choose `off` when expansion tables are not used or `cache`
  when expansion/validation is part of the acceptance criteria.
- Cache only successful, cacheable FHIR responses. Network failures, HTTP
  failures, `OperationOutcome` responses, empty CodeSystem searches, and
  malformed expansion/metadata responses are written to a JSONL diagnostic log
  (`temp/site-gen/tx-errors.jsonl` by default) but are never stored as reusable
  cache entries.
- Validate existing cache files before use: the embedded request must match the
  requested operation, and the cached response must still satisfy the same
  cacheability checks used on write. Malformed, mismatched, or poisoned cache
  entries should fail diagnostically and be logged rather than silently reused.
- Bound terminology server calls with `PUBLISHER_TX_TIMEOUT_MS` so online and
  refresh modes fail diagnostically instead of hanging indefinitely.
- Keep Publisher DB source labels separate from terminology semantics.
  `ValueSetListSources` should mirror Java Publisher
  `CrossViewRenderer.describeSource(String uri)` exactly, while expansion and
  validation continue to use ValueSet/CodeSystem resources and terminology
  service operations.

Acceptance criteria:

- Intensional SNOMED/LOINC fixture leaves `ValueSet_Codes` empty with
  `PUBLISHER_TX=off` and fails clearly with `PUBLISHER_TX=local`.
- The same fixture uses cache with `PUBLISHER_TX=cache`.
- Online mode writes a cache entry that can be reviewed and reused offline.
- Online mode records failed tx attempts in the diagnostic log and does not
  write cache files for failures.
- Cache mode rejects malformed, mismatched, or uncacheable existing cache
  entries without making a network call, and records the problem in the tx
  diagnostic log.
- Online and refresh modes abort tx server calls after the configured timeout
  and record the failure in the tx diagnostic log.
- IPS EDQM and ISCO CodeSystem metadata can be fetched once with
  `PUBLISHER_TX_METADATA=online` and then reproduced exactly with
  `PUBLISHER_TX_METADATA=cache`.
- Cache keys are stable for semantically identical requests.
- Source-label helper is covered by tests against the known Java Publisher
  branches (`SCT`, `LOINC`, `DICOM`, `UCUM`, `RxNorm`, `THO`, `FHIR`,
  package id, `Internal`, `Other`).

## Phase 9: Example Validation

Purpose: recover the most important safety behavior we currently get from Java
Publisher.

Work:

- Validate examples against generated profiles enough to catch:
  - missing required fields;
  - fixed/pattern mismatches;
  - cardinality violations;
  - unsupported profile references;
  - code not in required bindings when terminology support is available.
- Use `ImplementationGuide.definition.resource.exampleCanonical` and inline
  `meta.profile` as the profile-assignment signals; do not require examples to
  stamp `meta.profile` when the IG already identifies the example profile.
- Treat validation as QA output by default. Write
  `<package.db>.validation.json`; let CI opt into
  `PUBLISHER_FAIL_ON_VALIDATION_ERRORS=1` when a repository wants validation
  errors to block publishing.
- Apply cardinality per parent instance, not by summing all matching descendants
  across a resource.
- Recognize FHIR JSON primitive companion properties such as `_birthDate` or
  `_performedDateTime` as present for cardinality when they carry `id` or
  extensions.
- Evaluate FHIRPath constraints with the FHIR version model. Ordinary unsliced
  element constraints should run from the full resource as
  `ElementPath.all(<relative expression>)` so choice aliases and underscore
  primitive companions are handled by the FHIRPath engine rather than by local
  rewrites.
- Support common snapshot slices before treating IPS as a fair cross-IG check:
  - value-discriminated slices such as `Composition.section` by `code`;
  - type/profile-discriminated slices such as `Bundle.entry` by `resource`;
  - nested slice chains such as `Composition.section.entry` using `resolve()`
    profile discriminators.
- Follow embedded resource profile assertions for Bundle slices. Do not guess
  optional profile-discriminated slices from resource type alone when the
  instance does not declare `meta.profile`; otherwise one resource can be
  falsely validated against every optional profile slice of that type.
- Use `$validate-code` for coded elements when needed.
- Produce a QA report that site-gen can publish.
- Keep best-practice warnings separate from errors.
- Keep generated narrative warnings separate from ordinary validation issues:
  Bun does not generate FHIR narrative today, so `dom-6` should remain visible
  in the report without making Cycle, IPS, SDC, or CRD look like they have
  authored profile warnings.

Acceptance criteria:

- Current examples validate or report intentional warnings consistently.
- A wrong fixed code fails.
- A code outside a required local ValueSet fails.
- A code outside a required external/intensional ValueSet fails when tx support
  or tx cache is available.
- Cycle writes no ordinary validation issues and reports expected generated
  narrative warnings separately unless examples add generated narrative.
- IPS does not report false missing-cardinality errors for primitive companion
  data-absent-reason fields such as `_performedDateTime`; its current local run
  writes no ordinary validation issues, reports expected generated narrative
  warnings separately, and keeps the DB compare exact.

## Phase 10: SUSHI Orchestration, Not Reimplementation

Purpose: make the toolchain one command without duplicating FSH compilation.

Work:

- Keep `scripts/run-sushi.ts` as a thin adapter over SUSHI's exported
  lower-level APIs: config loading, FSH tank creation, dependency/predefined
  resource loading, export, snapshot writing, and IG assembly.
- Avoid importing SUSHI's CLI entrypoint; it owns argument parsing and
  `process.exit`, making it brittle as an in-process dependency.
- Add an orchestration script or mode that runs:
  - SUSHI through the adapter;
  - Bun publisher;
  - site-gen ingest;
  - render;
  - link check.
- Keep SUSHI as the compiler boundary.
- Keep recording SUSHI version and generated-resource timestamp in metadata.
- Keep failing when generated resources are stale relative to FSH inputs, unless
  the orchestration mode has just regenerated them.

Acceptance criteria:

- A clean CI job can run one command from checkout to static site.
- The build log clearly separates SUSHI, publisher, render, and project extras.
- No code path pretends to compile FSH without SUSHI.

## Phase 11: Project Configuration and Theming Boundary

Purpose: make `site-gen` reusable without carrying cycle-specific assumptions.

Work:

- Define a small project contract, likely under `site-gen/project/<id>.ts`.
- Move IG-specific values out of generic modules:
  - profile grouping/order;
  - labels and visual emphasis;
  - custom CSS;
  - sample viewer links;
  - deploy extras;
  - CNAME/package-list;
  - project-specific generated artifacts.
- Keep generic FHIR rendering based on package DB/resource metadata.
- Let project config augment, not replace, standard FHIR-derived metadata.

Acceptance criteria:

- A second IG can define its own project config without editing generic
  `site-gen/fhir/*` components.
- Cycle-specific strings do not appear in generic FHIR modules, except in test
  fixtures.
- The artifact browser can render standard IG content with no project config.

## Phase 12: Site DB, Content Queries, and Rendering Contract

Purpose: make narrative content and generated tables DRY without embedding
project-specific hacks in the renderer.

Work:

- Treat the site DB as the renderer input contract:
  - Publisher-compatible package rows;
  - derived navigation/menu rows;
  - copied static assets;
  - project config metadata;
  - QA files and machine-readable artifacts.
- Support a small, explicit content-query mechanism for generated pages:
  - SQL that returns a table;
  - SQL that returns JSON for a component;
  - SQL that returns a string;
  - no hidden template language beyond the documented mechanism.
- Keep query execution read-only.
- Keep project-authored markdown readable without executing it.
- Prefer generated tables over duplicated prose when the source is a ValueSet,
  CodeSystem, profile list, package dependency list, or example index.
- Add a lint/check mode for content queries:
  - query parses;
  - referenced table/columns exist;
  - result shape matches the component contract.

Acceptance criteria:

- Specification pages can include generated profile/terminology extracts
  without duplicating resource content manually.
- Query failures stop the build with the page name and query location.
- The generic renderer remains usable for an IG with no custom content queries.

## Phase 13: QA, Links, and Published Artifact Handling

Purpose: preserve the diagnostic output implementers need when the rendered site
is no longer the Java Publisher's own HTML.

Work:

- Copy Java Publisher QA artifacts when they exist:
  - `qa.html`;
  - `qa.json`;
  - other linked QA support files.
- Make root-path handling explicit:
  - generated site root;
  - optional language subdirectory;
  - GitHub Pages 404 redirect behavior;
  - canonical URLs.
- Keep link checking aware of:
  - fragment-only SHLink examples;
  - viewer-prefixed `#shlink:/...` URLs;
  - copied QA pages that still refer to Publisher's `/en/` paths;
  - external links that should not block offline builds unless configured.
- Publish machine-readable files next to HTML pages:
  - JSON resources;
  - package manifest;
  - `llms.txt`;
  - `skill.zip` or other project extras when configured.

Acceptance criteria:

- QA pages are reachable from the generated site.
- Broken internal links fail the build unless explicitly ignored with a reason.
- A site built at root and a site built under `/en/` can be checked
  deterministically.

## Phase 14: Multi-FHIR-Version Support

Purpose: avoid hardcoding R4 once another IG uses R5/R6.

Work:

- Resolve core package from `fhirVersion`.
- Derive core spec URL from package metadata.
- Derive the default terminology server endpoint from `fhirVersion`; keep
  `PUBLISHER_TX_SERVER` as the explicit override.
- Avoid R4-specific links in generic renderer code.
- Keep version-specific behavior behind small helpers.
- Add fixtures for at least one non-R4 package once needed.

Acceptance criteria:

- R4 cycle build remains unchanged.
- A minimal R5 fixture resolves its core package, writes package DB rows, and
  emits R5 publication links without R4 hardcoding.

## Phase 15: CI, Caching, and Supply Chain Controls

Purpose: make builds reproducible, fast, and diagnosable in GitHub Actions.

Work:

- Cache:
  - Bun install cache;
  - FHIR package cache;
  - generated package index cache;
  - tx cache, if not committed.
- Add explicit cache keys based on:
  - `bun.lock`;
  - package manifest/lock;
  - SUSHI version;
  - publisher code hash.
- Keep a manual cache-bust path.
- Add a CI mode that starts from an empty package cache periodically.
- Publish QA artifacts and compare summaries.

Acceptance criteria:

- Normal CI is fast and warm-cache friendly.
- Blank-slate CI succeeds.
- Cache misses are understandable from logs.
- A failed terminology/package resolution tells the user what package or tx
  request is missing.
- A periodic blank-cache build proves the repo does not depend on hidden local
  packages.
- Dependency and terminology cache busting are documented and can be triggered
  deliberately.

## Phase 16: Tests and Fixtures

Purpose: make future changes safe.

Work:

- Add focused fixtures under `site-gen/publisher/fixtures`.
- Test categories:
  - package resolution from empty cache;
  - canonical resource index;
  - local extensional expansion;
  - unsupported filter guardrail;
  - nested ValueSet import;
  - exclude;
  - CodeSystem content modes;
  - row derivation;
  - DB write/read smoke;
  - renderer smoke from generated DB.
- Keep fixtures small and explicit.

Acceptance criteria:

- Tests do not require the cycle IG content except for integration tests.
- Unit tests run without Java Publisher.
- Integration compare can be run when `output/package.db` exists.

## Phase 17: Documentation

Purpose: make the tool understandable for repo maintainers and adopters.

Work:

- Document the pipeline in `site-gen/publisher/README.md`.
- Document terminology modes and cache policy.
- Document how to add a new IG:
  - required files;
  - project config;
  - package dependencies;
  - CI setup;
  - known unsupported terminology constructs.
- Document when Java Publisher is still needed.

Acceptance criteria:

- A new maintainer can run a build from blank checkout.
- A second IG can follow a checklist without reading cycle-specific code.
- Unsupported behavior is listed plainly.

## Phase 18: Cross-IG Pilot Matrix

Purpose: prove the pipeline is not accidentally shaped around cycle.fhir.me.

Work:

- Define a small pilot matrix:
  - cycle.fhir.me as the home IG and regression baseline;
  - IPS as the first realistic external IG;
  - SDC (`HL7/sdc`) as a forms/questionnaire-heavy external IG;
  - Da Vinci CRD (`HL7/davinci-crd`) as a CDS Hooks / payer workflow external
    IG;
  - at least one small synthetic IG fixture designed to exercise edge cases.
- For each pilot IG, run both paths when practical:
  - Java Publisher output;
  - Bun publisher plus site-gen output.
- Compare:
  - package dependencies resolved from a blank cache;
  - `package.db` tables needed by site-gen;
  - artifact index counts and canonical links;
  - ValueSet/CodeSystem rendering;
  - profile differentials, snapshots, examples, and invariants;
  - QA/link-check output;
  - static render completeness and navigability.
- Record every mismatch as one of:
  - source-content drift;
  - intentional site-gen rendering difference;
  - unsupported Publisher feature;
  - terminology limitation;
  - package/dependency resolution bug;
  - renderer bug;
  - validation gap.
- Turn each unsupported Publisher feature into either:
  - an implemented capability;
  - a fail-loud diagnostic with a clear message; or
  - a documented non-goal if it is outside the intended tool scope.
- Keep pilot results in a reviewable report. `compare.ts` now writes
  `<actual-package.db>.compare.md` by default, for example
  `temp/site-gen/publisher/package.db.compare.md` for Cycle and
  `temp/site-gen/ips/package.db.compare.md` for IPS. CI should upload these as
  artifacts.
- Keep the IPS pilot runnable from one command (`bun run test:publisher:ips`)
  so local and CI checks exercise the same clone/build/compare path instead of
  relying on an accidental local checkout.

Acceptance criteria:

- Cycle continues to pass after every generalization.
- IPS, SDC, and Da Vinci CRD can be built from a blank package cache, replayed
  offline from the warmed cache, and compared exactly against Java Publisher
  `package.db` for the current compare surface.
- Remaining resource-JSON fidelity drift is classified in compare reports and
  kept separate from the package.db row parity gate.
- No pilot IG produces silently empty terminology, missing artifacts, or broken
  canonical links without an explicit diagnostic.
- At least one non-cycle project config can render without editing generic
  FHIR/site-gen modules.

## Phase 19: Migration Criteria for Using Bun Publisher by Default

Purpose: decide when this is safe to use beyond experiments.

Minimum bar:

- Blank-slate package resolution works in CI.
- Canonical resource resolution is centralized.
- Local StructureDefinitions have full snapshots before `package.db` is written,
  and profile pages render only from those DB snapshots.
- Unsupported terminology constructs fail loudly.
- Local extensional ValueSets work.
- Package DB rows needed by site-gen match Publisher output for cycle.
- Renderer smoke passes.
- QA/link checks pass.
- Documentation explains what is and is not replaced from Java Publisher.

Higher bar for replacing Java Publisher in production builds:

- Example/profile validation is good enough for the target IG.
- Required terminology validations work through cache/tx.
- Multiple IG fixtures pass.
- A stale generated-resource check prevents publishing old output.

## Near-Term Implementation Order

1. Finish hardening the package resolver, canonical index, and terminology
   classifier already started.
2. Make the snapshot generation contract explicit: run SUSHI with snapshots,
   preserve them in `Resources.Json`, and fail on snapshotless local profiles.
3. Define the package DB contract and add contract tests around site-gen's
   consumed tables.
4. Split row derivation from SQLite writes.
5. Add local extensional expansion tests and bounded nested/exclude support.
6. Run cycle through the generated DB and static renderer after each
   refactoring.
7. Run the IPS pilot and record categorized differences.
8. Add generic project config/rendering fixes exposed by IPS.
9. Add CI cache strategy and a periodic blank-slate CI check.
10. Add tx-cache and validation work only after the local/offline path is clean.

This order keeps the current useful experiment intact while removing the biggest
risks: hidden local state, duplicated lookup logic, mutable code paths, and
silent terminology errors.
