# site-gen — plan to a complete, beautiful, isomorphic IG site

> **Historical plan.** The implemented renderer contract is documented in
> [`README.md`](README.md) and `core/site-build.ts` / `core/renderer.tsx`.
> References below to `site.db` as the single source of truth describe the
> original native build plan; portable/browser rendering now begins from a
> verified `ClosedSiteBuild` and consumes a callback-free `SiteBuildView`.

Single source of truth (`site.db`) → **SSR static HTML (full content, great with JS
disabled)** → **client React hydration (JS unlocks full interactivity)**. Faithful to
the cycle design system, responsive, navigable, **zero broken links**, all content
accounted for.

## Feedback being addressed (this round)

1. **No meaningless ornament.** The sidebar phase-dots carry no information → remove.
   Every visual element must encode something (status, type, phase-as-data), never
   decoration. ✦ guiding principle, applies everywhere.
2. **No cramped long-text columns / ugly vertical-centering.** Tables where a column
   holds long prose (element `description`, artifact `description`) become **fused
   rows** — a tight header line (name · cardinality · type) with the description on
   its own full-width line beneath. Clean blocks, top-aligned.
3. **No broken links.** ValueSet / CodeSystem / Example pages are generated, and every
   binding / type / reference link resolves to a real local page or a real R4 URL. A
   build-time link checker fails the build on any dangling internal `href`.
4. **Isomorphic.** Basic SSR delivers the full content; with JS, the page hydrates and
   the React components gain their full behaviour (tabs, expanders, copy, search).

## Architecture

- **Pages are React components with a single serializable `data` prop** (assembled
  from `site.db` at build; **all links resolved at build time** so no client lookups).
- **SSR:** `renderToString(<Page data/>)` into `<main>`; the chrome (top bar, menu,
  sidebar, TOC, footer) is rendered once, statically. The page's `data` + component
  key are embedded as `<script type="application/json">`.
- **Hydration:** one esbuild client bundle reads the embedded data, looks the page
  component up in a registry, and `hydrateRoot`s `<main>`. JS-off → the SSR HTML is
  already complete; JS-on → full React.
- **Interactive components** (Tabs, ElementTable detail-expand, CodeBlock copy,
  Artifacts toggle-all, search) are plain React. SSR renders **all** content in the
  DOM (every tab pane, every detail) so nothing is hidden without JS; hydration just
  adds toggling. Native `<details>`/CSS keep per-item expand working JS-off too.
- **DRY:** the same component renders on server and client. Shared `data.ts` builders.
  Lean on libraries where they help (markdown-it, liquidjs, react-dom).

## Phases & acceptance criteria

### Phase 0 — Stabilize + quick visual fixes
- [ ] `ingest` + `build` run clean; all current pages emit.
- [ ] Sidebar dots removed; sidebar items show only meaningful meta (type VS/CS, required).
- [ ] ElementTable reflowed to fused rows (header line + full-width description), top-aligned, indented by depth — desktop and mobile.
- **Accept:** build green; profile page shows no cramped description column; no decorative dots; screenshots (desktop+mobile) reviewed.

### Phase 1 — Complete page types + link integrity
- [ ] `ValueSetPage` (expansion from `ValueSet_Codes` + compose from JSON), `CodeSystemPage` (concept tree from `Concepts`), `ExamplePage` (the Bundle: rendered + source).
- [ ] Centralized **link resolver** (build-time): canonical URL → local page; core types → R4; value sets in bindings → their VS page.
- [ ] **Link checker**: scan every emitted page's internal `href`; fail build on any target not emitted.
- **Accept:** every binding/type/parent/reference link on every page resolves (checker passes, exit 0); VS/CS/example pages exist and are linked from artifacts + bindings.

### Phase 2 — Isomorphic SSR + hydration
- [ ] Page components refactored to `({ data }) => JSX`, data fully serializable (links pre-resolved).
- [ ] `client/entry.tsx` + page registry; esbuild bundles to `assets/app.js`.
- [ ] `<main>` hydrates; chrome stays static; embedded JSON per page.
- **Accept:** with JS disabled the page is fully styled + complete; with JS enabled, `hydrateRoot` runs with **no hydration mismatch warnings** (checked in headless chrome console).

### Phase 3 — Interactive React components
- [ ] `Tabs` (JSON / XML / FSH on examples; Snapshot / Differential on profiles) — all panes SSR'd in DOM.
- [ ] `ElementTable` per-row detail expand (definition, comments, invariants, mappings).
- [ ] `CodeBlock` copy button; Artifacts toggle-all as React; client search over a build-time index (optional).
- **Accept:** JS-off shows all panes/details inline (no loss); JS-on toggles them; verified in chrome.

### Phase 4 — Narrative & machine-facing completeness
- [ ] Liquid shortcodes finalized (DB-derived dependency/globals/IP, source-ingested includes, source-rendered PlantUML SVGs, and resource fragments); all narrative pages render correctly, anchors match menu.
- [ ] `MachineFormats` panel (json/xml/ttl) on artifact pages; **`llms.txt`** index generated.
- **Accept:** all menu items resolve to a real page/anchor; narrative diagrams render; `llms.txt` present and lists every page.

### Phase 5 — A11y, responsive, polish, test matrix
- [ ] Landmarks, heading order, focus-visible, `<abbr>` titles, AA contrast; mobile nav drawer.
- [ ] **Test matrix in headless chrome:** {desktop 1320×, mobile 390×} × {JS-off, JS-on} × {home, a profile, a value set, artifacts, a narrative page}. Capture screenshots; assert no console errors, no broken links.
- **Accept:** matrix passes; screenshots reviewed for both breakpoints and both JS states.

## Known issues backlog (beyond the feedback)
- Page titles from `definition.page` are mis-cased ("Fhir Mapping"); prefer resource/front-matter titles.
- ElementTable shows only constrained elements; add Snapshot/Differential/Key views.
- `TypeRef` core-vs-datatype resolution is heuristic; verify against an R4 type list.
- Home is generic narrative; consider the hero/phase-ring treatment from the kit.
- Heading anchors must equal menu `#fragments` (slugify parity).
- Dark mode; print styles.

## Testing harness
`site-gen/test.ts` (bun): builds, starts a static server, drives headless chromium over
the matrix, writes screenshots to `site-gen/.shots/`, runs the link checker, and reports
console errors. Run in CI-like fashion each phase.
