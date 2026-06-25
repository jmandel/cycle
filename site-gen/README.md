# site-gen

A static-site renderer for FHIR Implementation Guides. The IG Publisher does the
FHIR work (validation, snapshots, terminology expansion) and emits `package.db`;
site-gen reads that DB and renders the final site with React SSR + island hydration.
No Jekyll, no dependency on the Publisher's HTML/`ig-template`.

The repo still carries a minimal `ig-template/` shim because the Publisher needs
some template while producing `output/package.db`. That shim is not the visual
source for the published site; styles, fonts, marks, and chrome live here under
`site-gen/designs/`, `site-gen/chrome/`, and `site-gen/project/`.

## Pipeline

```
FSH → SUSHI → IG Publisher (→ output/package.db)
   → site-gen/ingest.ts  (augments package.db → temp/site-gen/site.db
                          with Pages, Menu, SiteConfig, Assets)
   → site-gen/build.tsx  (renders → site-gen/out)
   → scripts/build-sitegen-site.ts injects project artifacts (viewers, SHL,
       skill.zip, CNAME) and runs a final whole-site link check
```

Local renderer-only dev (no Publisher run) uses the committed fixture:

```sh
SITE_GEN_USE_FIXTURE=1 bun site-gen/ingest.ts && bun site-gen/build.tsx
bash site-gen/test.sh        # build + link-check + headless-chrome smoke
```

DB resolution is explicit (`PKG_DB` → `output/package.db` → fixture); a missing DB
fails loudly rather than silently rendering a stale one.

## Layers (the rule of thumb: where would a future adopter need to change things?)

- **`core/`** — generic static-site mechanics, no FHIR/project knowledge:
  `db` (SQLite reader), `markdown`, `link-check` (href/src/srcset), `liquid`
  (safe LiquidJS engine; registry-only includes; unknown → throw).
- **`fhir/`** — reusable FHIR IG rendering: profile / value-set / code-system /
  example pages, `ElementTable`, `MachineFormats`. Assumes Publisher `package.db` tables.
- **`chrome/`** — site shell/UI: `Layout`, `Menu`, `Footer`, `Parts`, `Tabs`, `Island`.
- **`project/`** — everything another IG would replace: `cycle.ts` (the visible
  contract — brand, externalLinks, cname, paths), `includes.ts` (the Liquid
  include registry), `cycle.css` (project-only CSS like `.ptmvp-diagram`).
- **`ds/`** — design-system primitives (Badge, Tag, Callout, CodeBlock, Cardinality, Icon).
- **`client/`** — the hydration entry + island registry (bundled to `assets/app.js`).
- **`designs/cycle/`** — the visual design drop-in (tokens, base.css, fonts, marks).
  Swap the look by pointing `SITE_DESIGN_DIR` at another design directory.

## Security / trust model

- **Liquid includes are registry-only** (`project/includes.ts`); there is no
  "include a file from disk" feature, and an **unknown include fails the build**.
- A **Liquid/include error fails the build** (set `SITE_GEN_LENIENT=1` only for
  local dev) — a broken directive must never silently publish.
- The **link checker rejects `javascript:` links** and flags dangling internal refs.
- **Raw HTML in markdown is enabled** (`core/markdown`, `html: true`). This is a
  deliberate choice: IG narrative is *trusted, first-party* content authored in
  this repo. Directive-generated HTML escapes dynamic text (`esc()` in
  `project/includes.ts`); React escapes component-rendered data by default. If
  site-gen is ever pointed at **untrusted** markdown, add sanitization or disable
  raw HTML before doing so.
