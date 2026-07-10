# Cycle as a Fig external generator

Cycle should consume a closed build produced by the native Rust core; it should
not embed the engine, call compiler services during rendering, or use Rust
Liquid.

## Portable boundary now

`core/closed-build.ts` defines the host-neutral boundary:

- `ClosedBuildHandle.open(manifest, store)` recomputes the `SiteBuild` id,
  proves the required transitive artifact closure is ready, eagerly loads every
  reachable object, and checks its `ContentRef` length and SHA-256 digest.
- `ContentStore` is read-only byte transport, not a semantic callback. After
  opening, reads come from immutable verified copies held by the handle.
- Only artifacts reachable from the declared render plan are exposed.
- `openCycleSiteBuild` dispatches by the exact target. `cycle-site/v2` preloads
  four strict `cycle.semantic/v1` data artifacts and every raw authored asset;
  `cycle-site/v1` remains readable through the aggregate row adapter.
- The v2 payload contains parsed FHIR resources, terminology products, recursive
  navigation, and parsed config. SQLite surrogate keys, `Json` strings, and
  base64 asset bodies do not cross this boundary.

The browser calls `openCycleSiteBuildPayload` over the generic
`site-build-cas/v1` digest-to-base64 transport returned beside the WASM manifest.
Native Cycle uses `core/filesystem-closed-build.ts` to read the same artifact
contract from Fig's filesystem CAS. That module is imported only by the native
build entry point, so browser bundles never acquire Node built-ins.

## Native command

Fig now produces the exact closed bundle and Cycle consumes it directly:

```sh
cd <ig-dir>
rm -rf input/resources temp/cycle.fig-build temp/fig-sushi
mkdir -p input/resources
EXAMPLE_OUT=input/resources/Bundle-period-tracking-longitudinal-example.json \
  bun scripts/gen-example.ts
SOURCE_DATE_EPOCH=1783555200 \
fig prepare . \
  --target cycle-site/v2 \
  --sushi-out temp/fig-sushi \
  --cache /path/to/fhir-package-cache \
  --out temp/cycle.fig-build

SITE_BUILD_DIR=temp/cycle.fig-build SITE_GEN_REPLACE_OUTPUT=1 \
  bun site-gen/build.tsx
```

Generating the longitudinal example is a project-specific input stage for this
guide, not a requirement imposed by Fig or Cycle's reusable renderer. Two
authored pages link to that resource. It therefore belongs in `input/resources`
before `fig prepare`, so the native compile, SiteDb rows, validation inputs, and
closed manifest all describe the same world. Treating it as a generator output
or a link-check exception would put it outside the semantic handoff. A guide
whose semantic inputs need no preprocessing begins with `fig prepare`.

`temp/cycle.fig-build/` is a portable filesystem CAS:

```text
site-build.json
objects/sha256/<digest>
```

`fig prepare` captures authored inputs and the resolved package closure once,
hashes every source and normalized package payload, and reconstructs a private,
read-only IG tree and package cache from those captured objects. Its single
native compile reads only that staged view. It then closes the requested Cycle
target (`cycle-site/v2` is preferred),
verifies every addressed object, and publishes the new directory atomically.
This prevents even an A→B→A live-tree mutation from influencing compilation
while retaining A's identity. It refuses an existing output directory; final
live-tree comparisons are mutation diagnostics, not build inputs.

`site-gen/build.tsx` reads only through `ClosedBuildHandle` and uses the shared
Cycle renderer/content policy. It materializes every declared renderer file
through `listOutputs()` + `renderOutput()`—the same direct-path seam used by the
browser—then bundles the client and checks links inside a validated sibling
staging directory before it
atomically renames the completed tree to `OUT_DIR`. It rejects root,
working-tree/source overlap, symlink traversal, and an existing output unless
`SITE_GEN_REPLACE_OUTPUT=1` explicitly enables staged replacement. Any failure
before publication cleans staging and leaves the previous destination intact.
For an authorized replacement, publication is old-tree-to-backup followed by
staged-tree-to-destination; this prevents partial trees and supports rollback,
but does not promise uninterrupted path availability between the two renames.
The renderer's `listOutputs()` manifest is mandatory: every declared page,
narrative Markdown file, machine JSON file, `llms.txt`, and row asset must be
returned exactly once by `renderOutput()`, and collisions with host
design/client assets fail the build. Hosts do not need to know whether an
auxiliary file belongs to a separate page, shares `index.html`, or has no page.

For the repository's full Pages publication, `scripts/build-sitegen-site.ts`
owns a larger outer `AtomicOutputPublication`. It points `site-gen/build.tsx` at
an inner disposable destination inside outer staging, verifies the inner receipt
and copies only those declared files, then adds and declares the project viewers,
SHL files, agent package, deployment metadata, compatibility redirect, and
Publisher QA. It rechecks inherited hashes, runs the final link check over the
complete tree, writes one outer receipt, and performs the only rename to
`site-gen/out`. The intentional agent-package append to `llms.txt` receives new
wrapper provenance; no other inherited renderer file may change.

Portable mode does not inject SQL and does not honor the lenient Liquid escape
hatch, so a SQL tag fails loudly.

`SITE_DB=/path/to/site.db` selects the legacy `SqliteSiteBuildView` explicitly.
Setting both `SITE_BUILD_DIR` and `SITE_DB`, or neither, is an error.
The v1 row contract identifies its primary ImplementationGuide as the sole IG
row whose `Web` is `index.html`; additional guides retain ordinary resource
pages. A missing or ambiguous primary marker fails instead of relying on row
order.

## End-to-end evidence

The repository/CI gate runs the command sequence above against an archived copy
of this guide and an exact local package cache. The native Cycle consumer
verifies the resulting bundle, renders the narratives,
artifacts, seven profiles, terminology pages, and six examples, writes decoded
assets, and requires a strict link check with zero dangling links. Build ids and
object counts deliberately remain command output rather than copied
documentation because they change with exact source/package bytes. The gate is
evidence for this repository, not a promise that every unrelated guide needs
the same preprocessing command.

## Content-addressed final output

Cycle declares its logical renderer namespace through `listOutputs()` and each
host declares every additional output as it reserves or imports it. In the full
repository publication this includes viewer, SHL, skill, deployment, redirect,
and Publisher QA files as well as the design, project stylesheet, and client
bundle. After rendering and whole-tree link checking,
`AtomicOutputPublication.sealOutputReceipt()` traverses the complete private
tree, rejects symlinks/non-files and missing or undeclared paths, and writes:

```json
{
  "schemaVersion": "cycle-output-receipt/v1",
  "inputBuildId": "sb1-sha256:...",
  "renderer": { "id": "cycle-site", "version": "1" },
  "files": [
    {
      "path": "index.html",
      "mediaType": "text/html",
      "sha256": "...",
      "byteLength": 123,
      "producer": { "id": "cycle-site", "version": "1" },
      "source": "narrative page"
    }
  ],
  "outputBuildId": "cob1-sha256:..."
}
```

Files are uniquely keyed and sorted using Rust-compatible UTF-8 byte order.
`outputBuildId` is SHA-256 over canonical UTF-8 JSON containing the schema,
input build id, renderer identity, and every file record; it deliberately omits
only `outputBuildId` itself. The serialized receipt is also deterministic. The
reserved `cycle-output-receipt.json` path is not a member of `files`, avoiding
self-hash recursion. Atomic publication re-reads the receipt and all file bytes
immediately before the final rename, so late corruption also fails closed.

Portable builds bind the output directly to the verified `sb1-sha256` input.
The explicitly selected legacy SQLite adapter records
`legacy-site-db-sha256:<digest>` instead, making the compatibility input honest
without pretending it is a SiteBuild.

That binding is intentional: v1 and the typed v2 SiteBuild can render
byte-identical generator files but still have different receipt identities
because their exact semantic inputs have different build ids. Renderer parity
tests should compare the declared output files (or their per-file hashes), not
the receipt file or unnormalized `outputBuildId`.

`core/output-receipt.ts` is a browser-safe Web Crypto module.
`createCycleRendererOutputReceipt()` consumes the same `listOutputs()` and
`renderOutput()` API used by the editor; a host can add its design/client
materials to reproduce and compare the complete native receipt. No filesystem
or Bun API is needed to compute, validate, or compare receipt identities.

A future `fig finalize` can consume this versioned receipt as-is. Initially all
renderer files truthfully inherit the aggregate Cycle input identity; a later
split artifact model can add finer read provenance in a new receipt version
without weakening this complete-byte boundary.

## Execution choice

For native full builds, the precomputed CAS directory is the contract. Fig may
launch Bun as a subprocess for convenience, but there is no engine RPC during
rendering. This is preferable to loading a second Node-target WASM engine (extra
startup/memory and another stateful host) or exposing an open compiler protocol
to the generator. A long-lived subprocess may later exchange immutable build ids
and output deltas for watch mode; it is an optimization over the same contract.

## Stale runner retired

The former `sushi-rs/crates/fig/src/runner/adapter-runner.mjs` called the legacy
`buildSiteDb` path and editor APIs that no longer exist. It also made native Fig
depend on editor source layout. The runner and its `--wasm-dir`, `--project-json`,
and `--bundles-json` plumbing have been removed. `fig render --generator` fails
with a migration explanation; the supported flow is now `fig prepare` followed
by `SITE_BUILD_DIR=... SITE_GEN_REPLACE_OUTPUT=1 bun site-gen/build.tsx` when
refreshing the canonical existing output (the replacement flag is omitted for
a fresh destination).

## Later model improvements

Keep the `cycle-site/v1` reader during migration. V2 splits the monolithic row
artifact into independently addressed semantic groups and raw assets while
retaining an aggregate resources object for efficient synchronous preload. If
profiling justifies it, a future contract can address resources individually.
Cycle may opt into Rust-produced fragments that are genuinely useful, but they
must be declared and materialized before closure; Cycle remains on its shared
LiquidJS renderer.
