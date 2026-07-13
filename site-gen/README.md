# Cycle site generator

Cycle is an external FHIR IG site generator. It accepts one immutable,
authenticated `cycle-site/v2` SiteBuild and emits a complete deterministic
output catalog. It never opens a database, calls a compiler, or asks the Rust
engine to fill a missing fragment during rendering.

## Execution flow

```text
authored guide + exact packages
  -> fig prepare --target cycle-site/v2
  -> site-build.json + objects/sha256/<digest>
  -> ClosedBuildHandle
  + authenticated Cycle renderer package (design, fonts, marks, client runtime)
  + host ContentStore
  -> openCycleGenerator(handle, rendererPackage, contentStore)
  -> outputs() / render(path)
  -> SiteOutput receipt
  -> atomic publication or browser preview
```

The SiteBuild contains four strict `cycle.semantic.* /v1` JSON roots:

- resources and explicit primary ImplementationGuide metadata;
- terminology expansions;
- recursive pages and menu navigation; and
- parsed guide configuration.

Every authored asset is an ordinary content-addressed render-plan root. The
semantic payload schema revisions are `/v1`; the Cycle target remains
`cycle-site/v2`.

## Public generator seam

```ts
interface CycleGenerator {
  outputs(): CycleGeneratorOutput[];
  render(path: string): Promise<ContentRef>;
}

openCycleGenerator(
  build: ClosedBuildHandle,
  rendererPackage: CycleRendererPackage,
  outputStore: WritableContentStore,
): Promise<CycleGenerator>
```

`openCycleGenerator` accepts exactly an external-builder target whose renderer
is `cycle-site@2` and contract is `cycle-site/v2`. Opening verifies and decodes
the complete requirement before returning. The generator captures that build
and renderer together, so a catalog from one build cannot be rendered against
another.

`outputs()` returns the complete generator-owned namespace: HTML, resolved
Markdown, FHIR JSON, `llms.txt`, authored assets, design CSS, fonts, marks,
project CSS, and the browser runtime. Page entries also contain their title and
page kind. Every semantic, authored, and renderer-package path is merged and
collision-checked before the generator opens. `render(path)` is the only
byte-producing renderer operation: it writes directly to the supplied
ContentStore and returns the verified `ContentRef`. Each path is independent.
The build id remains on the authenticated closed manifest and never leaks as a
mutable generator property.

The second argument is a private renderer-implementation input, not guide data
or an editor asset API. Its strict `cycle-renderer-package/v1` manifest contains
UTF-8-ordered `{ path, mediaType, producer, content: ContentRef }` entries and a
`crp1-sha256` identity. Opening verifies the manifest identity plus every body
digest and length once. `outputs()` copies metadata only; `render(path)` copies
only the requested body. Native Bun constructs this package in memory from the
selected design/project files and exact production client bundle. A browser
host bakes the same manifest and CAS bodies, opens it internally during worker
preparation, and never exposes a parallel static asset tree to the editor API.

Transport is host-owned byte plumbing:

- native Bun uses `FilesystemContentStore` and
  `openFilesystemClosedBuild()` over a Fig bundle;
- the browser constructs the same `ClosedBuildHandle` over its content store.

Cycle does not define a second JSON/base64 handoff or a renderer-specific
storage tier.

## Native build

Prepare the closed input before starting the renderer:

```sh
SOURCE_DATE_EPOCH=1783555200 fig prepare . \
  --target cycle-site/v2 \
  --cache /path/to/fhir-package-cache \
  --out temp/cycle.fig-build

SITE_BUILD_DIR=temp/cycle.fig-build \
SITE_GEN_REPLACE_OUTPUT=1 \
  bun site-gen/build.tsx
```

This guide generates its longitudinal example under `input/resources` before
`fig prepare`; that is a project input stage, not part of the Cycle API.

`site-gen/build.tsx` requires `SITE_BUILD_DIR`. Before opening the generator it
builds and authenticates the renderer package in memory. It then renders every
member of the one closed catalog directly into CAS, checks links from the
addressed page bytes, and asks Rust through a hidden renderer IPC to verify the
same references and write canonical `site-output.json`. Only after independent
receipt validation does it materialize the exact receipt once and atomically
rename the complete tree. No design/client output is appended outside the
catalog. It rejects
source-overlapping or symlinked destinations. Replacing an existing destination
requires `SITE_GEN_REPLACE_OUTPUT=1`.

Native orchestration presents both a verified cache hit and a live generator
through one private immutable Build facade: `outputs()`, `render(path) ->
ContentRef`, and `finalize() -> SiteOutput`. `resolveNativeCycleOutput` is only a
convenience that drives those operations and returns the finalized output plus
its writable ContentStore for outer CAS composition; it is not another build
model or serialized handoff.

The private IPC names the exact `inputBuildId` already authenticated by the
Cycle host. Fig restores that bundle independently, binds the immutable output
path set, admits each referenced file from ContentStore, and invokes the same
no-argument SiteEngine `finalize` used by Publisher. A mismatched build aborts
before content admission. This transport is absent from Fig help and is not an
external-finalization plan or fifth build operation. The repository-wide
wrapper carries forward the inherited receipt's `inputBuildId` when it seals
the composed outer publication.

The native host privately derives an exact pre-render lookup pointer from the
closed build and authenticated renderer recipe. A hit returns only a canonical
receipt plus its verified ContentStore; Liquid rendering is not opened. A miss
follows the render/link-check/no-argument-finalize path above, then Fig advances
the private manifest pointer after caching every addressed object. No cache
key, cache type, or cache operation appears in the generator or SiteOutput API.
`FIG_OUTPUT_CACHE` selects this private storage root and defaults to
`temp/fig-output-cache`; `FIG_BIN` selects Fig.

The renderer recipe inputs are re-hashed before and after fresh finalization,
and again immediately before publishing a cache hit. Any drift aborts the
private transaction. `AtomicOutputPublication.publish()` likewise refuses to
rename any tree until it has adopted and independently verified Rust's receipt;
there is no unsealed publication mode.

The repository-wide publication uses:

```sh
FIG_BIN=/path/to/pinned/fig bun run build:sitegen
```

The wrapper runs the Java IG Publisher independently for validation and QA,
prepares the v2 Cycle SiteBuild with `FIG_BIN`, resolves the inner Cycle output
in ContentStore, then adds viewers, SMART Health Link files, the agent package,
deployment files, and the complete Publisher artifact under `publisher/`.
Root `qa.html` redirects to `publisher/qa.html`. Rust finalizes the combined
ContentRefs; only then does the wrapper materialize, verify, and publish once.
The Publisher's `package.db` is not a Cycle input.

## Rendering and Liquid

Cycle uses LiquidJS. `core/content.ts` is the single native/browser content
policy. Includes resolve from the explicit project registry or a text asset in
the closed SiteBuild. Resource fragments and generated fragments resolve from
the already prepared semantic context. Unknown includes and unsupported tags
fail the build.

Cycle has no SQL tag, database adapter, lenient fallback, filesystem include, or
compiler callback. The Rust Liquid implementation used by Publisher templates
is a separate renderer with a different contract.

## SiteOutput

The browser-neutral SiteOutput receipt binds:

- the exact `sb1-sha256` input build id;
- renderer identity and recipe digest;
- output schema and runtime options; and
- every declared path, media type, producer, owner, length, and SHA-256 digest.

Its public material identity is `so1-sha256`. A native host may use a private
`sok1-sha256` pointer derived from functional inputs, but that value is not a
receipt field or public contract. `site-output.json` is excluded from its own
file set to avoid self-reference. Native publication materializes and rechecks
only the paths named by the receipt before rename.

## Source layout

- `core/closed-build.ts`: host-neutral verified SiteBuild handle.
- `core/semantic-site-build.ts`: strict v2 decoder and typed renderer input.
- `core/open-site-build.ts`: the one `openCycleGenerator` facade.
- `core/renderer-package.ts`: authenticated renderer-owned static output package.
- `core/renderer.tsx`: output catalog and direct-path React SSR.
- `core/content.ts` and `core/liquid.ts`: shared closed LiquidJS policy.
- `core/filesystem-closed-build.ts`: Bun filesystem ContentStore adapter.
- `core/output-receipt.ts`: browser-neutral independent SiteOutput validation.
- `core/atomic-output.ts`: native staged publication.
- `native-renderer-package.ts`: Bun preparation of design/client package bytes.
- `fhir/`: FHIR resource page components.
- `chrome/`: shared site shell.
- `project/`: replaceable guide-specific brand, includes, and visible config.
- `designs/`: replaceable visual assets and tokens.

Renderer components consume typed semantic resources, recursive navigation,
configuration, terminology, and asset bytes directly. No database-shaped row
projection sits between the closed SiteBuild and rendering.

## Verification

```sh
bun run typecheck:renderer
bun test site-gen/core

# Complete native/browser-output smoke over a real closed bundle:
SITE_BUILD_DIR=/path/to/closed-v2-build bun run test:sitegen
```

The unit suite covers closure verification, strict semantic decoding, exact
target rejection, generator catalog/direct rendering, assets, LiquidJS,
receipts, atomic output, and link checking. CI additionally builds a real v2
bundle with a pinned Fig commit and deploys only after the complete publication
passes.
