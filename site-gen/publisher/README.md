# Experimental package.db producer

> **Legacy/experimental preparation path.** This code remains useful for
> Publisher comparison and safety research, but it is not Cycle's preferred
> renderer handoff. Current portable/native publication uses a verified
> `cycle-site/v2` `ClosedSiteBuild`; see [`../README.md`](../README.md) and
> [`../FIG-INTEGRATION.md`](../FIG-INTEGRATION.md).

This folder is an experiment in replacing the Java IG Publisher as the producer
of the `package.db` shape consumed by `site-gen`.

The current producer is deliberately source-driven:

- SUSHI is invoked in-process through `scripts/run-sushi.ts` /
  `site-gen/publisher/sushi.ts`, using the installed `fsh-sushi` package as an
  npm dependency. The producer does not import SUSHI's CLI entrypoint and does
  not shell out to `sushi build`.
- `fsh-generated/resources/*.json` supplies the conformance resources and
  `ImplementationGuide` manifest after the integrated SUSHI stage.
  StructureDefinition resources must include `snapshot.element`; the integrated
  stage always requests snapshots.
- `input/resources/*.json` supplies authored/generated examples.
- `sushi-config.yaml` supplies package metadata.
- FHIR packages are resolved from `sushi-config.yaml` `fhirVersion`, declared
  dependencies, pinned Publisher ambient packages, generated
  `ImplementationGuide.definition.extension` package context, optional
  operator-supplied extras, and package transitive dependencies.

It does not copy rows from `output/package.db` and does not hardcode
cycle-specific resource ids. It scans actual FHIR resources, extracts resource
metadata, CodeSystem concepts, ValueSet compose includes, and the package/base
dependency indexes used by the artifact browser.

CodeSystem URLs and NamingSystem URI aliases are indexed separately.
NamingSystems are useful metadata, but a NamingSystem alone is not treated as a
CodeSystem row or as package ownership for a ValueSet source label. This matches
the current Publisher behavior across Cycle and IPS, where older THO packages
may still carry a CodeSystem for a URI that newer packages expose only as a
NamingSystem.

ValueSet expansion is explicit because package metadata is not a terminology
engine:

```sh
PUBLISHER_TX=off     bun site-gen/publisher/build.ts  # default; leaves ValueSet_Codes empty
PUBLISHER_TX=local   bun site-gen/publisher/build.ts  # local/extensional only; fail on filters
PUBLISHER_TX=cache   bun site-gen/publisher/build.ts  # use input/tx-cache only; no network
PUBLISHER_TX=online  bun site-gen/publisher/build.ts  # call the tx server and write cache
PUBLISHER_TX=refresh bun site-gen/publisher/build.ts  # refresh cached tx responses
```

`PUBLISHER_EXPERIMENT_EXPAND_VALUESETS=1` is still accepted as an alias for
`PUBLISHER_TX=local`. The default terminology server follows the IG's
`fhirVersion` (`https://tx.fhir.org/r4` for R4, for example); override with
`PUBLISHER_TX_SERVER`. The default cache path is
`<SUSHI_PROJECT>/input/tx-cache`; override with `PUBLISHER_TX_CACHE`.
Large expansions are bounded by `PUBLISHER_TX_MAX_CODES` (default `10000`) so a
site build does not accidentally materialize a huge intensional SNOMED or LOINC
set. Terminology server calls use a 120-second timeout by default; override with
`PUBLISHER_TX_TIMEOUT_MS`.

CodeSystem metadata lookup is separate from ValueSet expansion. Some IGs,
including IPS, reference code systems such as EDQM or ISCO that are known to the
terminology server but are not present as package CodeSystem resources. Use:

```sh
PUBLISHER_TX_METADATA=cache   bun site-gen/publisher/build.ts  # use cached CodeSystem?url lookups only
PUBLISHER_TX_METADATA=online  bun site-gen/publisher/build.ts  # fetch missing metadata and write cache
PUBLISHER_TX_METADATA=refresh bun site-gen/publisher/build.ts  # refresh cached metadata
```

If `PUBLISHER_TX_METADATA` is omitted, it follows `PUBLISHER_TX` for `cache`,
`online`, and `refresh`, and otherwise stays `off`. Metadata lookups do not
populate `ValueSet_Codes`; they only fill CodeSystem list metadata, OIDs, and
references.

The same terminology cache boundary supports ValueSet and CodeSystem
`$validate-code`. Example validation can use these helpers when terminology
support is enabled; successful FHIR `Parameters` responses, including
`result=false`, are cacheable because they are deterministic validation evidence.
`OperationOutcome`, HTTP/network failures, and malformed `Parameters` responses
are not cacheable.

Terminology cache entries are written only for successful, cacheable FHIR
responses, and existing cache entries are validated again before use. HTTP
failures, network failures, `OperationOutcome` responses, malformed expansion
or metadata responses, and malformed or mismatched cache files are not reused.
They are appended to `temp/site-gen/tx-errors.jsonl` by default so repeated
upstream/service failures can be reviewed and reported without poisoning the
cache; override with `PUBLISHER_TX_ERROR_LOG`, or set
`PUBLISHER_TX_ERROR_LOG=off` to disable this diagnostic log.

Run:

```sh
bun site-gen/publisher/build.ts
bun site-gen/publisher/compare.ts
```

Each build writes a package manifest next to the generated DB by default:

```text
temp/site-gen/publisher/package.db.manifest.json
```

Override with `PUBLISHER_BUILD_MANIFEST`. The manifest records the integrated
SUSHI compiler stage, the SUSHI version, generated-resource count and newest
timestamp, FSH compiler-input count and newest timestamp, the exact FHIR package
graph used by the build, the package cache root, registry endpoint, package
download policy/timeout, and whether each package came from cache or was
downloaded during this run. For downloads, it records the SHA-256 digest of the
fetched package tarball because the FHIR package registry response does not
provide enough integrity metadata for a reproducibility audit. It also records
terminology settings, including tx server timeout, and a
per-ValueSet strategy summary: classification, reasons, expansion mode,
expansion status, source, and code count when an expansion was actually
prepared.

Example validation runs by default and writes a sidecar report:

```text
temp/site-gen/publisher/package.db.validation.json
```

The validator uses `ImplementationGuide.definition.resource.exampleCanonical`
and `meta.profile` to associate examples with generated profiles. It checks
resource type, required and maximum cardinalities, fixed values, FHIR pattern
values, embedded resource profile assertions for common Bundle slice shapes, and
required bindings. It also evaluates `ElementDefinition.constraint.expression`
with `fhirpath.js` and the FHIR version model for the IG. For ordinary
unsliced elements, the validator evaluates constraints from the full resource as
`ElementPath.all(<relative expression>)`, letting the FHIRPath engine handle
choice elements and underscore primitive companion properties such as
`_performedDateTime`. Slice-filtered contexts are evaluated as fragments only
after the validator has selected the matching slice instances. The only local
standard-invariant compatibility shim is `dom-3`, because the published R4
expression currently throws in `fhirpath.js` when `descendants().as(...)` is
applied across heterogeneous descendants.
Required bindings are checked from a local or cached ValueSet expansion when one
is available; otherwise, when
`PUBLISHER_TX=cache`, `online`, or `refresh` is enabled, the validator uses
ValueSet `$validate-code` for the actual instance codings without materializing
a full expansion. It understands the common SUSHI snapshot slice shapes used by
the Publisher, including value-discriminated slices such as
`Composition.section.code`, resource type/profile slices such as
`Bundle.entry.resource`, and nested slice chains such as
`Composition.section.entry` slices that use `resolve()` profile discriminators.
Optional profile-discriminated slices are matched only when the instance
declares the asserted profile; required profile slices use a conservative
resource-type fallback so core Bundle requirements can still be checked when
examples rely on IG manifest metadata instead of inline `meta.profile`.

Validation is QA by default, matching the Publisher posture that an IG can still
produce output while reporting example problems. The report can find profile
violations even when a Java Publisher site build does not surface them in its
QA summary, because it validates examples assigned by `exampleCanonical` or
`meta.profile` directly against the generated snapshots. Set
`PUBLISHER_FAIL_ON_VALIDATION_ERRORS=1` to make validation errors fail the Bun
publisher, `PUBLISHER_VALIDATE_EXAMPLES=0` to skip the report, and
`PUBLISHER_WARN_UNCHECKED_BINDINGS=1` to include warnings for required bindings
that could not be checked without terminology expansion.

Run against another IG checkout:

```sh
SUSHI_PROJECT=../path/to/ig OUT_DB=temp/site-gen/other/package.db bun site-gen/publisher/build.ts
```

Package cache:

```sh
FHIR_PACKAGE_CACHE=temp/fhir-package-cache bun site-gen/publisher/build.ts
```

`FHIR_PACKAGE_CACHE` is passed to both the integrated SUSHI stage and this
publisher's package resolver, so a clean CI build can use one explicit cache
root from FSH compilation through DB generation. If a required package is
missing, the resolver downloads it from the FHIR package registry into the
normal `name#version/package` cache shape. Use `FHIR_PACKAGE_REGISTRY` to point
at a different registry endpoint. Set `PUBLISHER_PACKAGE_DOWNLOADS=off` to prove
the Bun package resolver can run from a warm cache without fetching missing
packages; missing packages then fail with an explicit cache/install error.
Registry fetches use a 120-second timeout by default; override with
`PUBLISHER_PACKAGE_DOWNLOAD_TIMEOUT_MS` when a CI environment needs a different
bound. Mutable versions such as `current` or `dev` must already be installed or
replaced with a pinned concrete version.

`PUBLISHER_RUN_SUSHI=0` is for comparison runs or precompiled IG inputs only.
When SUSHI is skipped, the build fails if the newest FSH/compiler input is newer
than the newest file in `fsh-generated/resources`; this prevents publishing a
package DB from stale generated profiles.

Blank-cache smoke test:

```sh
bun run test:publisher:blank-cache
```

This networked integration check creates an empty temporary FHIR package cache,
runs the integrated SUSHI + Bun publisher build, then reruns the Bun publisher
with `PUBLISHER_RUN_SUSHI=0` and `PUBLISHER_PACKAGE_DOWNLOADS=off` against the
warmed cache. By default it runs against this IG and compares to
`output/package.db` when present. The same script can be pointed at another IG:

```sh
SUSHI_PROJECT=temp/ips-ig \
SUSHI_OUT=temp/ips-ig \
EXPECTED_DB=temp/ips-ig/output/package.db \
PUBLISHER_SMOKE_LABEL=ips \
PUBLISHER_FIRST_TX_METADATA=online \
PUBLISHER_OFFLINE_TX_METADATA=cache \
bun scripts/check-publisher-blank-cache.ts
```

If the expected Java Publisher DB is present, the smoke compares the warm-cache
DB against it.

The external IG pilot wraps that setup:

```sh
bun run test:publisher:ips
bun run test:publisher:sdc
bun run test:publisher:crd
```

Each wrapper uses a checkout under `temp/<label>-ig` when present, otherwise
clones the configured upstream repository, ensures Java Publisher output exists
(`output/package.db`), and then runs the blank-cache Bun publisher smoke against
that checkout. By default the first Bun pass may fetch missing CodeSystem
metadata and the second pass must replay it from cache. The generic entry point
is `scripts/check-publisher-external-ig.ts`; wrappers supply defaults for IPS
(`HL7/fhir-ips`), SDC (`HL7/sdc`), and Da Vinci CRD (`HL7/davinci-crd`).
Override with `PUBLISHER_IG_DIR`, `PUBLISHER_IG_REPO`, `PUBLISHER_IG_REF`,
`PUBLISHER_IG_RUN_JAVA`, `PUBLISHER_FIRST_TX_METADATA`, or
`PUBLISHER_OFFLINE_TX_METADATA` as needed. The legacy `PUBLISHER_IPS_*`
variables still work for the IPS wrapper.

Publisher package context is explicit and reproducible. These are compatibility
context packages, not IG-authored dependencies and not Cycle- or IPS-specific
special cases:

- IG-declared dependencies come from `sushi-config.yaml`.
- Java IG Publisher loads `hl7.fhir.pubpack` and
  `hl7.fhir.xver-extensions` into the worker context before IG dependencies.
  This producer includes the pinned versions used by the checked Publisher
  source so builds do not inherit those packages by accident from a local cache.
- Java IG Publisher auto-adds the HL7 Extension Pack and HL7 Terminology when a
  source IG does not declare them; this producer mirrors that behavior with
  pinned package versions and the same version-family mapping (`r3` for FHIR
  STU3, `r4` for R4/R4B, and `r5` for R5/R6).
- Java IG Publisher also loads the HL7 tools package for Publisher-defined
  extension definitions and related terminology. This producer includes the
  version-specific `hl7.fhir.uv.tools.*` package as ambient context (`r3` for
  FHIR STU3, `r4` for R4/R4B, and `r5` for R5/R6) so those canonical URLs
  resolve without the jar.
- The FHIR spec Publisher loads DICOM and IHE format-code terminology as ambient
  context (`kindling PageProcessor.java` loads `fhir.dicom` and
  `ihe.formatcode.fhir` beside UTG). This producer mirrors that context with
  pinned package versions so DICOM/IHE canonical references do not depend on
  chance local cache state.
- Generated `ImplementationGuide.definition.extension` package context is
  honored after the integrated SUSHI stage:
  `ig-internal-dependency` entries are loaded as transitive context packages,
  while pinned `ig-link-dependency` entries are loaded as non-transitive link
  context. These must be explicit `name#version` values so a blank CI cache can
  reproduce the build.
- `PUBLISHER_AMBIENT_PACKAGES=off` disables the ambient set.
- `PUBLISHER_AMBIENT_PACKAGES="pkg#version ..."` replaces the ambient set.
- `PUBLISHER_EXTRA_PACKAGES="pkg#version ..."` appends additional pinned context
  packages without modifying the IG dependency metadata.
- IG-declared dependencies are resolved transitively. Ambient and extra context
  packages are loaded for their own resources only; their package dependencies
  are not followed unless the IG also declares them. This mirrors the Java
  Publisher's `pub_no_load_deps` handling for packages it loads on its own
  initiative and avoids pulling older context-package dependencies into clean
  CI builds.

The comparator reports fidelity against the real Publisher output:

- table presence and row counts;
- stable metadata;
- `Resources` rows by `Type/Id`;
- review-only raw `Resources.Json` drift classified as structural constraints,
  human documentation, generated metadata, generated narrative, canonical
  version decoration, and extension/provenance metadata;
- CodeSystem concepts by resource and code; and
- ValueSet expansion codes; and
- ValueSet/CodeSystem index rows, systems, OIDs, sources, and references.

`compare.ts` writes the same evidence to a Markdown sidecar report by default:

```text
<actual-package.db>.compare.md
```

Override with `COMPARE_REPORT=/path/to/report.md`, or disable with
`COMPARE_REPORT=off`. The comparator exits non-zero when it finds differences;
set `COMPARE_FAIL_ON_DIFFS=0` only when a workflow is intentionally collecting a
diff report without gating on it. The raw resource JSON fidelity section is
reported for human review but does not currently count toward the row-parity
failure gate; it exists so generated narrative, comments, extensions,
canonical-version decoration, and structural differences are visible instead of
being normalized away silently.

Current boundaries:

- It orchestrates SUSHI, but SUSHI remains the compiler boundary. The producer
  does not reimplement FSH compilation.
- It requires snapshots to already be present in local StructureDefinition
  resources after the integrated SUSHI stage. This is deliberate: `site-gen` renders profile pages from
  `Resources.Json.snapshot.element`, so reconstructing snapshots in the renderer
  would put FHIR computation on the wrong side of the DB boundary.
- Example validation evaluates FHIRPath constraints with `fhirpath.js` and the
  IG's FHIR model. FHIRPath evaluation failures are reported as
  `fhirpath-evaluation` warnings rather than hidden. The validator recognizes
  FHIR JSON primitive companion properties for structural cardinality checks,
  and FHIRPath itself handles those companions when constraints are evaluated
  from the full resource. The remaining local FHIRPath compatibility shim is
  the R4 `dom-3` invariant.
- Optional profile-discriminated slices are not guessed when examples omit
  profile assertions. The validator follows explicit `meta.profile` and IG
  `exampleCanonical` assignments and follows embedded resource profile
  assertions for Bundle slices.
- By default, it matches the observed Publisher DB and leaves
  `ValueSet_Codes` empty. `PUBLISHER_TX=local` is useful for small local
  extensional sets but is not a terminology-service replacement.
- `ValueSetListSources` uses the same short-label heuristic as Java Publisher
  `CrossViewRenderer.describeSource`, including labels such as `SCT`, `LOINC`,
  `UCUM`, `DICOM`, `THO (V3)`, `THO (V2)`, `THO`, `FHIR`, package id,
  `Internal`, and `Other`. These are package.db index labels only; they do not
  drive expansion, validation, or code-system ownership.
- ValueSet expansion is deliberately guarded. Explicit concept lists,
  whole-system includes for available complete CodeSystems, available
  local/package ValueSet imports, and excludes work offline. Filters,
  unavailable whole-system includes, unavailable imported ValueSets, and
  incomplete CodeSystems require `PUBLISHER_TX=cache`, `online`, or `refresh`.
- Strategy classification inspects `compose` without materializing expansion
  rows. When expansion rows are requested, local and tx expansions are capped by
  `PUBLISHER_TX_MAX_CODES` and fail diagnostically if they exceed the limit.
- The build manifest includes a per-ValueSet terminology strategy summary even
  when `PUBLISHER_TX=off`, so CI artifacts can show which ValueSets were local
  extensional, external extensional, or required terminology support instead of
  hiding the decision behind an empty `ValueSet_Codes` table.
- CodeSystem metadata lookup is also cached and guarded. Empty search results,
  `OperationOutcome` responses, HTTP failures, and malformed responses are
  logged as errors and are not written to cache.
- Metadata such as generation timestamp, git status, and tooling identifiers is
  intentionally producer-specific.
