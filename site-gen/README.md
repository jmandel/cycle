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
   → fig prepare --target cycle-site/v1
   → site-build.json + objects/sha256/<digest>
   → ClosedBuildHandle + JsonSiteBuildView
   → CycleSiteRenderer   (pure page manifest + SSR + auxiliary outputs)
   → site-gen/build.tsx  (writes outputs/assets, bundles client, checks links)
```

Produce a new bundle (the output directory must not already exist), then render
it without any compiler callback or embedded WASM engine:

```sh
rm -rf input/resources temp/cycle.fig-build temp/fig-sushi
mkdir -p input/resources
EXAMPLE_OUT=input/resources/Bundle-period-tracking-longitudinal-example.json \
  bun scripts/gen-example.ts
SOURCE_DATE_EPOCH=1783555200 fig prepare . \
  --target cycle-site/v1 \
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
design files, project CSS, or the client bundle.

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
  `json-site-build` (portable canonical-row view), `renderer` (the one
  CLI/browser semantic preparation + page/SSR implementation), `content` (the
  one CLI/browser closed narrative policy), `db` (legacy native SQLite adapter),
  `filesystem-closed-build` (Node/Bun-only Fig CAS reader), `markdown`,
  `link-check` (href/src/srcset), and `liquid` (safe LiquidJS evaluator).
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
| `AtomicOutputPublication` | Node/Bun-only validated sibling staging, failure cleanup, and completed-tree publication; not imported by browser modules |
| `SiteBuildView` | synchronous, callback-free semantic and asset queries for one closed Cycle build |
| `CYCLE_RENDER_PLAN` | names the `cycle-site/v1` contract and its one required `compat.site_db/rows.json` artifact |
| `JsonSiteBuildView` | shared view over the verified canonical row artifact; decodes asset bytes for portable consumers |
| `CycleContentRenderer` | injected narrative transformation over one explicit content context |
| `createCycleContentRenderer` | shared LiquidJS/include/fragment/site-data policy used by CLI and browser |
| `CycleSiteRenderer.listPages()` | deterministic page manifest |
| `CycleSiteRenderer.listOutputs()` | collision-checked generator output namespace (pages, narrative Markdown, machine JSON, `llms.txt`, and row assets) |
| `CycleSiteRenderer.renderPage(file)` | pure React SSR for one page plus auxiliary outputs |
| `CycleSiteRenderer.renderOutput(file)` | lazy direct-path access to HTML, narrative Markdown, machine JSON, or `llms.txt`; browser and native hosts do not synthesize these separately |
| `SqliteSiteBuildView` | native legacy adapter over `site.db`; the only shared-renderer module that opens SQLite |

Both browser and native portable hosts construct `JsonSiteBuildView` only
through a `ClosedBuildHandle`, after the required artifact closure and all of
its ready artifact bodies have been verified. Source/package read references are
validated against the manifest but are not downloaded again by a renderer. The
browser-only base64 asset transport is exposed separately as `encodedAssets()`;
ordinary `SiteBuildView.assets()` always returns bytes.

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
- A **Liquid/include error fails the build** (set `SITE_GEN_LENIENT=1` only for
  local dev) — a broken directive must never silently publish.
- The **link checker rejects `javascript:` links** and flags dangling internal refs.
- **Raw HTML in markdown is enabled** (`core/markdown`, `html: true`). This is a
  deliberate choice: IG narrative is *trusted, first-party* content authored in
  this repo. Directive-generated HTML escapes dynamic text (`esc()` in
  `project/includes.ts`); React escapes component-rendered data by default. If
  site-gen is ever pointed at **untrusted** markdown, add sanitization or disable
  raw HTML before doing so.
