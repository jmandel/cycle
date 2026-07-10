# site-gen

A static-site renderer for FHIR Implementation Guides. Site-gen renders a
callback-free `SiteBuildView` with React SSR + island hydration. The browser
and preferred native path construct that view from the same verified
`ClosedSiteBuild`. `SqliteSiteBuildView` remains an explicitly selected legacy
compatibility adapter over `site.db`.
No Jekyll output is deployed, and the published site has no dependency on the
Publisher's generated HTML or template assets.

In the legacy validation/fixture workflow, the Publisher is invoked through
`ig-gh-actions.ini` with `fhir2.base.template` only to produce
`output/package.db`. The preferred Fig pipeline does not invoke it. The visual
source for the published site lives under `site-gen/designs/`,
`site-gen/chrome/`, and `site-gen/project/`.

## Preferred native pipeline

```text
authored IG + exact package cache
   → fig prepare --target cycle-site/v2
   → site-build.json + objects/sha256/<digest>
   → ClosedBuildHandle + openCycleSiteBuild
   → SemanticSiteBuildView (four typed data roots + raw asset roots)
   → CycleSiteRenderer   (pure page manifest + SSR + auxiliary outputs)
   → site-gen/build.tsx  (writes outputs/assets, bundles client, checks links)
   → cycle-output-receipt.json + atomic publication
```

Produce a new bundle (the output directory must not already exist), then render
it without any compiler callback or embedded WASM engine:

```sh
rm -rf input/resources temp/cycle.fig-build temp/fig-sushi
mkdir -p input/resources
EXAMPLE_OUT=input/resources/Bundle-period-tracking-longitudinal-example.json \
  bun scripts/gen-example.ts
SOURCE_DATE_EPOCH=1783555200 fig prepare . \
  --target cycle-site/v2 \
  --sushi-out temp/fig-sushi \
  --cache /path/to/fhir-package-cache \
  --out temp/cycle.fig-build
SITE_BUILD_DIR=temp/cycle.fig-build SITE_GEN_REPLACE_OUTPUT=1 \
  bun site-gen/build.tsx
```

The first three lines are a Cycle-guide preprocessing step, not part of the
generic site-gen/Fig contract. This guide's pages link to its generated
longitudinal Bundle, so the Bundle and five standalone Observations must exist
under `input/resources` before Fig compiles and closes the semantic input.
A guide with no project-specific input generator starts at `fig prepare`.

`SITE_BUILD_DIR` and `SITE_DB` are mutually exclusive. The portable path omits
the native SQL capability and fails the build if authored Liquid uses a SQL tag.

Native publication is fail-closed. `OUT_DIR` is resolved and checked against
filesystem root, the working tree, source/input paths, and symlink traversal.
An existing destination is rejected unless `SITE_GEN_REPLACE_OUTPUT=1` is set
explicitly. Rendering, decoded asset writes, client bundling, and strict link
checking all happen in a real sibling staging directory. Only a completed tree
is renamed into place; a pre-commit failure removes staging and leaves any prior
output untouched. A replacement retires the old tree and then renames the new
tree, so readers may observe a brief absent destination during those two
same-filesystem operations, but never a partially written tree. The flag in the example is appropriate for the canonical repeatable
`site-gen/out` build and can be omitted for a fresh `OUT_DIR`.
`CycleSiteRenderer.listOutputs()` is enforced as the complete generator-owned
namespace before publication; the native host also rejects collisions with
design files, project CSS, or the client bundle. After link checking, the host
hashes every declared renderer and host output and writes
`cycle-output-receipt.json`. It then re-reads the receipt and every staged file
immediately before publication; a missing, extra, changed, non-regular, or
symlinked output fails closed. The receipt itself is the sole excluded path so
that its identity is not recursively self-referential.

The repository-wide `bun run build:sitegen` adds guide-specific outputs beyond
this reusable builder. It therefore creates one outer
`AtomicOutputPublication`, points `site-gen/build.tsx` at an inner disposable
directory, verifies the inner receipt, and copies only its declared files into
outer staging. Viewers, SHL payloads, the agent package, `package-list.json`,
`CNAME`, the compatibility redirect, and Publisher QA are added and declared
there. All inherited renderer files are hash-checked again (with the deliberate
agent-package append to `llms.txt` recorded as a wrapper transformation), the
complete tree is link-checked and sealed, and only then is `site-gen/out`
published once. The inner receipt is proof consumed by the wrapper; it is not the
receipt shipped beside a larger, mutated tree.

## Legacy SQLite fallback

The existing Publisher/fixture workflow remains available only when `SITE_DB`
is named explicitly:

```text
FSH → SUSHI → IG Publisher (→ output/package.db)
   → site-gen/ingest.ts → temp/site-gen/site.db
   → SqliteSiteBuildView → the same renderer/content code
```

Local renderer-only development can use the committed fixture:

```sh
SITE_GEN_USE_FIXTURE=1 bun site-gen/ingest.ts
SITE_DB=temp/site-gen/site.db SITE_GEN_REPLACE_OUTPUT=1 bun site-gen/build.tsx
bash site-gen/test.sh        # build + link-check + headless-chrome smoke
```

The ingest input resolution is explicit (`PKG_DB` → `output/package.db` →
opt-in fixture), and the renderer requires either `SITE_BUILD_DIR` or `SITE_DB`;
it never silently selects a stale database.

## Layers (the rule of thumb: where would a future adopter need to change things?)

- **`core/`** — shared static-site mechanics: `closed-build` (verified manifest +
  read-only object-store handle), `site-build` (callback-free view contract),
  `semantic-site-build` (strict v2 decoder/preloaded view), `json-site-build`
  (v1 canonical-row adapter), `open-site-build` (exact contract dispatch and
  generic WASM CAS transport), `renderer` (the one
  CLI/browser semantic preparation + page/SSR implementation), `content` (the
  one CLI/browser closed narrative policy), `db` (legacy native SQLite adapter),
  `filesystem-closed-build` (Node/Bun-only Fig CAS reader), `markdown`,
  `link-check` (href/src/srcset), `output-receipt` (browser-compatible canonical
  output identity), `output-receipt-node` (native tree verification), and
  `liquid` (safe LiquidJS evaluator).
- **`fhir/`** — reusable FHIR IG rendering: profile / value-set / code-system /
  example pages, `ElementTable`, `MachineFormats`. Reads the typed row shapes
  exposed by `SiteBuildView`, not a SQLite connection.
- **`chrome/`** — site shell/UI: `Layout`, `Menu`, `Footer`, `Parts`, `Tabs`, `Island`.
- **`project/`** — everything another IG would replace: `cycle.ts` (the visible
  contract — brand, externalLinks, cname, paths), `includes.ts` (the Liquid
  include registry), `cycle.css` (project-only CSS like `.ptmvp-diagram`).
- **`ds/`** — design-system primitives (Badge, Tag, Callout, CodeBlock, Cardinality, Icon).
- **`client/`** — the hydration entry + island registry (bundled to `assets/app.js`).
- **`designs/cycle/`** — the visual design drop-in (tokens, base.css, fonts, marks).
  Swap the look by pointing `SITE_DESIGN_DIR` at another design directory.

## Public seams

| API | Role |
| --- | --- |
| `ClosedBuildHandle` | validates the manifest/read graph and eagerly verifies every reachable ready-artifact body, then exposes immutable scoped reads |
| `ContentStore` | read-only content-addressed byte transport; never a compiler/materialization callback |
| `FilesystemContentStore` / `openFilesystemClosedBuild` | Node/Bun-only reader for a native `fig prepare` bundle; not imported by browser renderer modules |
| `AtomicOutputPublication` | Bun-only validated sibling staging, failure cleanup, kernel-level no-replace rename, and completed-tree publication; not imported by browser modules |
| `createCycleOutputReceipt` / `verifyCycleOutputReceipt` | pure Web-Crypto API that computes or verifies a complete output set in Bun or a browser |
| `createCycleRendererOutputReceipt` | browser convenience that consumes `listOutputs()` / `renderOutput()`; optional host materials allow it to reproduce a native complete-tree receipt |
| `sealCycleOutputTree` / `verifyCycleOutputTree` | Node/Bun-only regular-file traversal and receipt adapter used by atomic publication |
| `scripts/final-publication.ts` | verifies and imports an inner receipt into outer staging, preserves inherited provenance, and audits inherited bytes after wrapper work |
| `SiteBuildView` | synchronous, callback-free semantic and asset queries for one closed Cycle build |
| `CYCLE_RENDER_PLAN_V2` | names `cycle-site/v2`: four `cycle.semantic/v1` JSON roots plus every raw authored asset root |
| `openCycleSiteBuild` | dispatches only by the exact target; malformed v2 inputs never fall back to v1 by artifact presence |
| `openCycleSiteBuildPayload` | strictly decodes the generic digest-to-base64 WASM CAS transport, verifies the build, and dispatches its view |
| `SemanticSiteBuildView` | preloads strict resource/terminology/navigation/config payloads and raw assets; legacy numeric row keys exist only in memory |
| `CYCLE_RENDER_PLAN_V1` / `JsonSiteBuildView` | readable v1 fallback over the one verified `compat.site_db/rows.json` artifact |
| `CycleContentRenderer` | injected narrative transformation over one explicit content context |
| `createCycleContentRenderer` | shared LiquidJS/include/fragment/site-data policy used by CLI and browser |
| `CycleSiteRenderer.listPages()` | deterministic page manifest |
| `CycleSiteRenderer.listOutputs()` | collision-checked generator output namespace (pages, narrative Markdown, machine JSON, `llms.txt`, and row assets) |
| `CycleSiteRenderer.renderPage(file)` | pure React SSR for one page plus auxiliary outputs |
| `CycleSiteRenderer.renderOutput(file)` | lazy direct-path access to HTML, narrative Markdown, machine JSON, or `llms.txt`; browser and native hosts do not synthesize these separately |
| `SqliteSiteBuildView` | native legacy adapter over `site.db`; the only shared-renderer module that opens SQLite |

`AtomicOutputPublication` intentionally remains useful to generic callers that
do not need a receipt. Its `publish()` permits an unsealed tree; if
`sealOutputReceipt()` was called it always re-verifies before rename. The native
Cycle builder unconditionally calls `sealOutputReceipt()` after link checking,
so its publication path cannot skip receipt verification. The whole-publication
wrapper independently seals its outer tree and performs the only rename to the
canonical `site-gen/out`; the builder's verified inner directory is removed
before that outer seal.

Both browser and native portable hosts call `openCycleSiteBuild` only through a
`ClosedBuildHandle`, after the required artifact closure and every ready body
has been verified. The v2 view reads parsed FHIR JSON rather than a `Json`
column, derives concept/menu/page surrogate keys only in memory, and exposes raw
asset bytes. Source/package read references are validated against the manifest
but are not downloaded again by a renderer. `JsonSiteBuildView.encodedAssets()`
exists only for the v1 browser compatibility transport; ordinary
`SiteBuildView.assets()` always returns bytes.

The resources root explicitly identifies its primary ImplementationGuide.
Only that entry receives the compatibility `packageId`/canonical/`index.html`
row identity. Additional ImplementationGuide resources retain their own ids,
URLs, and `ImplementationGuide-<id>.html` pages; duplicate compatibility
references fail before renderer maps are built.

Recursive v2 page roots flatten to compatibility depth zero. A positive depth
offset left behind when a producer omits a structural page such as `toc.html`
is normalized before the wire; only the relative page hierarchy is semantic.

`cycle-site/v2` identifies this input adapter contract. The receipt's
`cycle-site@1` renderer identity is deliberately independent and currently
shared with v1. Receipt ids still differ across v1/v2 parity builds because the
receipt commits `inputBuildId` as well as all output bytes.

The portable verified handle and native Fig handoff are documented in
[`FIG-INTEGRATION.md`](FIG-INTEGRATION.md).

Cycle uses LiquidJS; Publisher-template rendering in the Rust engine uses a
separate Rust Liquid implementation. See [`liquid-subset.md`](liquid-subset.md)
for the implemented Cycle contract and the native-only SQL capability.

## Security / trust model

- **Liquid includes never read from disk during render**. They resolve either to
  a computed registry entry (`project/includes.ts`) or to a same-named text asset
  that `ingest.ts` already copied into the DB from trusted project/Publisher
  outputs. An **unknown include fails the build**.
- **Liquid SQL tags are a native legacy capability only**. They accept only
  `SELECT` / `WITH` statements over the local generated `site.db`, reject
  semicolons and mutation keywords, and exist only for trusted first-party
  markdown authoring. The portable/browser closed renderer supplies no SQL
  executor and fails loudly if a page attempts to use one.
- **Asset names are validated** before ingest/write; absolute paths, `..`, and
  empty path segments are rejected.
- **Native output is staged and published as a completed tree**. Dangerous or
  source-overlapping paths and symlink traversal are rejected; replacing an
  existing output requires `SITE_GEN_REPLACE_OUTPUT=1`.
- **The final staged tree is content-addressed before publication**. Receipt
  paths use the same UTF-8 byte ordering as SiteBuild identities; every file's
  media type, length, SHA-256, producer, and available source/owner identity is
  bound to the input build id and Cycle renderer version.
- A **Liquid/include error fails the build** (set `SITE_GEN_LENIENT=1` only for
  local dev) — a broken directive must never silently publish.
- The **link checker rejects `javascript:` links** and flags dangling internal refs.
- **Raw HTML in markdown is enabled** (`core/markdown`, `html: true`). This is a
  deliberate choice: IG narrative is *trusted, first-party* content authored in
  this repo. Directive-generated HTML escapes dynamic text (`esc()` in
  `project/includes.ts`); React escapes component-rendered data by default. If
  site-gen is ever pointed at **untrusted** markdown, add sanitization or disable
  raw HTML before doing so.
