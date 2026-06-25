# package-mapped components

Component catalog for the **from-scratch IG site generator** (the forked architecture):
the IG Publisher does the FHIR computation and emits `output/package.db`; a **Bun +
React SSR** pipeline reads that DB and renders a complete static site with the cycle
design system. No base template, no Jekyll.

**Non-negotiables (from the brief):**
- **Static-first / JS-off safe** — every component renders complete content via
  `renderToStaticMarkup`. JS is progressive enhancement only.
- **Explicit, never implicit** — worded conformance (`Required`, `Must Support`), not
  glyph/color alone.
- **No interaction-gated primary content** — expansion is allowed *only* for deep
  secondary detail or redundant alt-representations, and the content stays in the DOM.
- **Responsive** — real CSS (classes + media/container queries), not the DS's
  fixed-px inline styles, for anything that must reflow (shell, tables).

---

## Data sources (`output/package.db`)

| Table | Feeds |
| --- | --- |
| `Metadata` (Name/Value) | IG id, canonical, version, FHIR version, genDate, releaseLabel — site header/footer, every page |
| `Resources` (typed cols + **`Json`** full resource) | the core: every SD / VS / CS / IG / example, with snapshot **and** differential |
| `Concepts` (ParentKey hierarchy) + `ConceptProperties` + `Designations` + `Properties` | CodeSystem pages (concept tree, properties, translations) |
| `ValueSet_Codes` (expansion) | ValueSet pages (expanded code list) |
| `CodeSystemList*` / `ValueSetList*` (Refs/OIDs/Systems/Sources) | cross-reference indexes ("systems used by", "value sets referencing") |
| `ConceptMappings` | ConceptMap pages (if any) |

**Not in the DB** (resolve separately):
- **Narrative pages** (`index`, `specification`, …) — authored markdown in
  `input/pagecontent/`; render with our own markdown step. The IG resource's
  `definition.page` tree gives titles/ordering/nav.
- **Menu** — `sushi-config.yaml` `menu:` (or IG `definition.page`).
- **Cross-IG / core type links** — `Resources` only has *this* IG's resources; links to
  core FHIR datatypes (`string`, `CodeableConcept`) resolve to `hl7.org/fhir/R4/…`.

---

## A · Shell & chrome

### `Layout`
- **Purpose:** the HTML document — `<!doctype>`, `<head>` (title, meta, cycle token CSS + self-hosted fonts + page CSS), `<body>` with TopBar + shell + Footer.
- **Data:** `Metadata` (title/version), per-page title + breadcrumb + TOC.
- **Responsive:** shell is CSS grid `[sidebar] [main] [toc]` → collapses to single column < 1024px (toc hidden), sidebar → off-canvas drawer < 768px.

### `TopBar`
- Brand (cycle mark + `cycle.fhir.me` wordmark, `.fhir.me` coral) · version/status badge · primary nav (from menu) · search + source-repo icons. Sticky, porcelain blur.
- **PE:** mobile hamburger toggles the sidebar drawer; search opens a client-side index (later).

### `SidebarNav`
- **Contextual** left nav: grouped, scannable (Profiles / Value sets / Code systems / Examples / Pages), phase dots, active state (coral keyline + tint), counts.
- **Data:** `Resources` grouped by `Type`/`kind`; pages from IG `definition.page`.

### `Toc` ("On this page")
- Right rail; anchors for the page's `h2/h3`. **PE:** scrollspy highlights current; static list works without JS.

### `MachineFormats`
- Ink panel: links to `{base}.json` / `.xml` / `.ttl` (and FSH where available). Encodes "HTML is a view; JSON is the truth." Every artifact page.

### `Breadcrumb` · `Footer`
- Mono breadcrumb from page hierarchy. Footer: package id#version, FHIR version, genDate, license, links.

---

## B · Primitives (port from the design system → CSS classes)

Already pulled from the DS (React inline-style source = the spec). Port to
`cycle-components.css` classes so they're responsive + JS-off:

| Component | Notes |
| --- | --- |
| `Icon` | Lucide subset, embedded path data, `currentColor`. ✅ ported |
| `Badge` | worded status pill; tones = phase palette; soft/solid/outline. ✅ ported |
| `Tag` | mono label for FHIR paths/types/codes |
| `Card` | warm paper surface, optional phase top-keyline, hover lift |
| `Button` | primary/secondary/ghost/sticker; press scale |
| `Callout` | admonition: note/tip/warning/danger/example/**normative**/**informative** — worded label + icon + tint |
| `CodeBlock` | dark warm panel, filename + lang chip, **copy** (PE), JSON syntax → phase palette, line numbers |
| `Cardinality` | `min..max` + worded flags `S` / `?!` / `Σ` via `<abbr title>` |
| `Tabs` | **only** for redundant alt-views; all panes in DOM, display-toggled |
| `Stat`, `PhaseRing`, `PhaseDot` | home/hero + cycle motif |
| `Input`/`Select`/`Switch` | forms — for search/filters later |

---

## C · FHIR data components (the substance)

### ⭐ `ElementTable` — the centerpiece
Renders a StructureDefinition's elements (the thing you flagged).

- **Data:** `Resources.Json` → `snapshot.element[]` (default) and `differential.element[]`. Each element: `path`, `sliceName`, `min`, `max`, `type[]` (`code`, `profile[]`, `targetProfile[]`), `mustSupport`, `isModifier`, `isSummary`, `short`, `definition`, `comment`, `fixed[x]`/`pattern[x]`, `binding` (strength + valueSet), `constraint[]`, `slicing`, `contentReference`, `mapping[]`.
- **Static output (always visible — primary):**
  - **Tree name column:** indent by `path` depth; tree connectors; element name = last path segment; `value[x]` choice rows; slice rows under a sliced element with the slice name; a small type/structure icon.
  - **Flags & cardinality:** `Cardinality` (`min..max`, required in coral) + worded `S`/`?!`/`Σ`.
  - **Type column:** each type → `TypeRef` link (core datatype → R4 spec; local profile → its page; `Reference(targetProfile)` → target pages). Choice types list all.
  - **Description:** `short`. (Full `definition`/`comment` is secondary — see expand.)
  - **Inline markers (no click):** binding (`BindingRef`: value-set link + strength badge), fixed/pattern value as `Tag`/`Badge`, "Slice: …", obligations.
- **Secondary detail (expand — content stays in DOM):** a per-row disclosure revealing `definition`, `comment`, invariants (`constraint[]`: key/severity/human/expression), full binding, mappings. Default collapsed is acceptable here because it's *deep* detail, not primary — but rendered in the DOM (CSS/JS toggle or `<details>`), Ctrl-F-able, and deep-linkable via `#<path>`.
- **Views:** `Tabs` for **Snapshot / Differential / (Key elements)** — redundant representations, all panes in DOM.
- **Links:** every element row has a stable `id="<path>"` anchor + copy-link; name links to its own detail.
- **Responsive:** ≥ desktop = 4 columns; tablet = merge Flags+Type under name; mobile = stacked "definition list" cards per element with a sticky path, horizontal scroll avoided. Keep a real `<table>` semantics where possible (or ARIA grid when stacked).
- **A11y:** `<table>` with `scope` headers; `<abbr title>` for flags; tree depth via `aria-level`.

### `ResourceHeader`
- Eyebrow (`Profile · Observation` / `ValueSet` / `CodeSystem`), `h1` title, status/maturity badges (`Draft`, `Required in Bundle`, standardsStatus), lead = `description`.
- **Data:** `Resources` cols (`Title`, `Status`, `derivation`, `kind`, `sdType`, `base`, `Description`, `standardStatus`).

### `MetadataGrid` (`KeyValue`)
- Bordered card: Official URL, Computable name, Version, Status, Base/Parent (link), FHIR version, Publisher. **Data:** `Resources` cols + `Metadata`.

### `ValueSetTable`
- Expanded codes grouped by system: `code` · `display` · system. Header notes binding strength + "expansion generated {date}". **Data:** `ValueSet_Codes` (+ `ValueSetListSystems` for system titles). Also render `compose` (include/exclude, filters) from `Json` for the *definition* (compose) vs *expansion* (codes) — `Tabs`.

### `CodeSystemTable` / `ConceptHierarchy`
- Concept list or **nested tree** (via `Concepts.ParentKey`): `code` · `display` · `definition` · property columns. **Data:** `Concepts`, `ConceptProperties`, `Properties` (column defs), `Designations` (alt displays/langs).

### `BindingRef` · `TypeRef` · `ConstraintList`
- `BindingRef`: value-set link + strength badge (`required`/`extensible`/`preferred`/`example`). `TypeRef`: type → definition page (core vs local resolution). `ConstraintList`: invariants table (`key`, severity badge, `human`, `expression`).

### `ArtifactIndex`
- The Artifacts page: grouped, scannable rows (name · kind `Tag` · status badge · description · link). **Data:** all `Resources` grouped by `Type`/`kind`.

### `ExampleViewer`
- Example resource: `Tabs` JSON / XML / TTL (`CodeBlock`) + optional friendly rendering. **Data:** `Resources` (examples; the Bundle) `Json`.

### `MappingTable` (optional) · `ConceptMapTable` (if ConceptMaps exist, from `ConceptMappings`).

---

## D · Page templates

| Page | For | Key components |
| --- | --- | --- |
| `HomePage` | landing | hero + `PhaseRing`, system-at-a-glance flow, Core Rule `Callout`, profiles grid, "for agents" + `llms.txt` |
| `ArtifactsPage` | index | `ArtifactIndex` |
| `ProfilePage` | StructureDefinition (constraint) | `ResourceHeader`, `MetadataGrid`, normative `Callout`, ⭐`ElementTable`, `ExampleViewer`, `MachineFormats` |
| `ExtensionPage` | SD (extension) | as profile, extension context |
| `ValueSetPage` | ValueSet | `ResourceHeader`, `ValueSetTable`, `MachineFormats` |
| `CodeSystemPage` | CodeSystem | `ResourceHeader`, `CodeSystemTable`/`ConceptHierarchy` |
| `ExamplePage` | example instances | `ExampleViewer` |
| `NarrativePage` | authored markdown | markdown → cycle prose + `Callout`/`CodeBlock` shortcodes |
| `IGDetailsPage` | the IG resource | dependencies, parameters, globals |
| `404` / `search` | utility | client search index (later) |

---

## E · Interactivity budget (progressive enhancement, ~one small JS bundle)

All optional; page is complete without them.
1. `Tabs` toggle (snapshot/diff, JSON/XML/TTL) — panes pre-rendered in DOM.
2. `CodeBlock` copy button.
3. `ElementTable` row-detail expand (toggles a DOM-present panel).
4. `Toc` scrollspy + mobile sidebar drawer.
5. Anchor "copy link" on headings/elements.
6. (Later) client-side search; dark-mode toggle.

---

## Open questions / data gaps
- **Narrative pages:** render `input/pagecontent/*.md` ourselves (markdown engine + cycle shortcodes), or post-process the Publisher's HTML for those pages only? Leaning: own the markdown.
- **Type-link resolution:** map core FHIR types → `hl7.org/fhir/R4/datatypes.html#…`; local → our pages. Need a resolver keyed by canonical URL.
- **Intros/notes:** the Publisher supports per-artifact `*-intro.md`/`*-notes.md` fragments — decide if/how to include.
- **Diagrams:** PlantUML/Mermaid in narrative — render at build (we control the pipeline) and ship the underlying table too.

---

## Prototype status
Started porting primitives into `site-gen/ds/` (`Icon`, `Badge` done). Next: `db.ts`
(`bun:sqlite` reader), `Layout`, and `ElementTable` + `ProfilePage` rendered from
`menstrual-bleeding-fact` to prove the DB→SSR→static pipeline, then screenshot-verify.
