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
- `JsonSiteBuildView.fromClosedBuild` checks `cycle-site/v1`, reads the one
  `compat.site_db/rows.json` artifact, and supplies the same `SiteBuildView` to
  `CycleSiteRenderer` in every host.

The browser implements the store with the canonical row bytes returned beside
the WASM manifest. Native Cycle uses `core/filesystem-closed-build.ts` to read the
same contract from Fig's filesystem CAS. That module is imported only by the
native build entry point, so browser bundles never acquire Node built-ins.

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
  --target cycle-site/v1 \
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
native compile reads only that staged view. It then closes `cycle-site/v1`,
verifies every addressed object, and publishes the new directory atomically.
This prevents even an A→B→A live-tree mutation from influencing compilation
while retaining A's identity. It refuses an existing output directory; final
live-tree comparisons are mutation diagnostics, not build inputs.

`site-gen/build.tsx` reads only through `ClosedBuildHandle` and uses the shared
Cycle renderer/content policy. It writes decoded assets, renders, bundles the
client, and checks links inside a validated sibling staging directory, then
atomically renames the completed tree to `OUT_DIR`. It rejects root,
working-tree/source overlap, symlink traversal, and an existing output unless
`SITE_GEN_REPLACE_OUTPUT=1` explicitly enables staged replacement. Any failure
before publication cleans staging and leaves the previous destination intact.
For an authorized replacement, publication is old-tree-to-backup followed by
staged-tree-to-destination; this prevents partial trees and supports rollback,
but does not promise uninterrupted path availability between the two renames.
The renderer's `listOutputs()` manifest is mandatory: every declared page,
narrative Markdown file, machine JSON file, `llms.txt`, and row asset must be
emitted exactly once, and collisions with host design/client assets fail the
build.

Portable mode does not inject SQL and does not honor the lenient Liquid escape
hatch, so a SQL tag fails loudly.

`SITE_DB=/path/to/site.db` selects the legacy `SqliteSiteBuildView` explicitly.
Setting both `SITE_BUILD_DIR` and `SITE_DB`, or neither, is an error.

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

## Content-addressed output receipt remains a later step

Cycle now declares and enforces its complete logical output namespace before
publishing. It does not yet return a content-addressed receipt for those final
bytes to Fig. A future Fig finalization boundary can pair the current logical
manifest and staging step with a hashed output receipt:

```json
{
  "schemaVersion": "fig-generator-output/v1",
  "inputBuildId": "sb1-sha256:...",
  "generator": { "id": "cycle-site", "version": "<code digest>" },
  "files": [
    {
      "path": "index.html",
      "mediaType": "text/html",
      "sha256": "...",
      "byteLength": 123,
      "reads": [{ "kind": "artifact", "key": { "kind": "data", "namespace": "compat.site_db", "name": "rows.json" } }]
    }
  ]
}
```

A future `fig finalize` would validate the input build id, generator identity,
safe unique paths, byte hashes, and read dependencies before materializing
output. Initially each Cycle page may honestly record the aggregate row artifact
as its read; a later split model can make invalidation finer without changing
the handle.

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

Keep `compat.site_db/rows.json` for v1 migration. If profiling justifies it, a v2
plan can address resources, authored pages/assets, terminology products, and
selected Publisher fragments separately. Cycle may opt into Rust-produced
fragments that are genuinely useful, but they must be declared and materialized
before closure; Cycle remains on its shared LiquidJS renderer.
