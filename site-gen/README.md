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
  -> openCycleGenerator(handle, rendererPackage)
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
  readonly buildId: string;
  outputs(): CycleGeneratorOutput[];
  render(path: string): RenderedOutput;
}

openCycleGenerator(
  build: ClosedBuildHandle,
  rendererPackage: CycleRendererPackage,
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
byte-producing renderer operation and each path is independent.

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
member of the one closed catalog into private sibling staging, checks internal
links, asks Rust `fig finalize` to authenticate the tree and write
`site-output.json`, independently verifies it, and only then renames the complete tree. No
design/client output is appended outside the catalog. It rejects
source-overlapping or symlinked destinations. Replacing an existing destination
requires `SITE_GEN_REPLACE_OUTPUT=1`.

The external-finalization plan names the exact `inputBuildId` already opened by
the Cycle generator. Fig restores the bundle independently and rejects the
operation before inspecting the staged output unless that identity still
matches; Cycle also verifies the build id returned by Fig. The repository-wide
wrapper carries forward the inherited receipt's `inputBuildId` when it seals
the composed outer publication.

The native host first asks the pinned Fig engine for the exact pre-render
`SiteOutput` cache key using that closed build and authenticated renderer
recipe. A verified hit fills the already-private `AtomicOutputPublication`
staging directory, whose JavaScript validator rechecks the
receipt and all files before the normal atomic rename; Liquid rendering is not
opened. A miss follows the render/link-check/Rust-finalize path above; Fig
publishes the authenticated tree into `FileSiteOutputCache` + `FileContentStore` before
publication. `FIG_OUTPUT_CACHE` selects the cache root and defaults to
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
prepares the v2 Cycle SiteBuild with `FIG_BIN`, verifies the inner Cycle output,
then adds viewers, SMART Health Link files, the agent package, deployment files,
and the complete Publisher artifact under `publisher/`. Root `qa.html` redirects
to `publisher/qa.html`. Rust seals the combined tree; the wrapper independently
verifies and publishes it once.
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

Its pre-render key is `sok1-sha256`; its material output identity is
`so1-sha256`. `site-output.json` is excluded from its own file set to avoid
self-reference. Native publication re-reads every staged byte before rename.

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
