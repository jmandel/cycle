# Liquid subset for the jekyll-less build

The package.db generator renders narrative pages (`input/pagecontent/*.md`) itself —
no Jekyll. But the authored content uses a little Liquid. This doc defines the
**minimal subset we support, where it runs in the pipeline, and how includes resolve**.

Design stance: support the *small, bounded* dialect our content actually uses; map
`{% include %}` to **our own data-driven generators** (not arbitrary file includes);
hard-cut everything advanced. The Liquid we keep is a thin authoring convenience over
data we already have in `package.db`.

---

## 1 · What our content actually uses (the whole inventory)

3 of 14 pages, ~7 sites:

| Construct | Site(s) | Category |
| --- | --- | --- |
| `{% include dependency-table.xhtml %}` etc. (×4) | `ig-details.md` | **generated artifact** include |
| `{% capture x %}{% include model.svg %}{% endcapture %}` + `{{ x \| remove_first: … }}` | `specification.md` | capture + include + filter |
| `{% assign source_repo = site.data.fhir.ig.contact[0].telecom[0] %}` | `index.md` | assign from data |
| `{{ source_repo \| replace: 'https://','' }}` | `index.md` | output + filter |

So we need exactly: **`assign`, `capture`, `include`, object/path interpolation, a few
filters** — plus a **data context** (`site.data.fhir.ig.*`). Nothing else appears.

---

## 2 · Pipeline placement

Liquid runs **before** Markdown (Jekyll order), so includes can emit block HTML that
Markdown then passes through:

```
raw .md ──▶ [1] Liquid pass (resolve assign/capture/include/{{…}})
        ──▶ [2] Markdown render (markdown-it, HTML passthrough on)
        ──▶ [3] wrap in cycle Layout (React SSR shell) ──▶ static .html
```

Front matter (`---`) is parsed in [1] and removed before [2]. Includes that return
HTML tables/SVG survive [2] untouched.

---

## 3 · Supported subset

### Tags
| Tag | Support | Notes |
| --- | --- | --- |
| `{% assign v = expr %}` | ✅ | RHS = path lookup, string/number literal, or filtered expr |
| `{% capture v %}…{% endcapture %}` | ✅ | captures rendered inner block into `v` |
| `{% include NAME %}` | ✅ **remapped** | NAME resolves against our **shortcode registry** (§5), *not* the filesystem |
| `{% comment %}…{% endcomment %}` | ✅ | dropped |
| `{% if %}` / `{% unless %}` / `{% else %}` | ⚠️ minimal | truthiness + `==`/`!=` only; no `and/or` chains initially |
| `{% for %}` | ❌ (phase 2) | not used by our content; add only if needed |
| `{% raw %}` | ✅ | useful to show literal `{{ }}` in docs |
| layouts / `{% layout %}` / tablerow / cycle / increment | ❌ | out of scope — the Layout is React |

### Output / interpolation
- `{{ path.to.value }}` and `{{ path[0].x | filter: 'arg' }}`.
- Path resolution over the data context: dotted keys + `[n]` indexing; missing → empty string (configurable to throw in strict mode).

### Filters (initial set — extensible)
`replace`, `remove`, `remove_first`, `append`, `prepend`, `downcase`, `upcase`,
`strip`, `default`, `escape`, `date`, `markdownify`. Everything else → build error
naming the unknown filter (no silent passthrough).

---

## 4 · Data context (the `site` drop)

A single read-only object assembled from `package.db` + the IG resource, exposing the
Jekyll-ish paths FHIR content expects:

```
site.data.fhir.ig          → the ImplementationGuide resource (Resources.Json where Type='ImplementationGuide')
site.data.fhir.ig.version  → Metadata.igVer
site.data.fhir.path        → Metadata.path  (core FHIR spec base)
site.data.info.canonical   → Metadata.canonical
site.data.metadata.*       → all Metadata key/values
page.*                     → per-page front matter (title, etc.)
```

Only this curated surface is exposed — **not** Jekyll's full `site`/`site.data`
(no collections, no `_data/*` sprawl). New paths are added deliberately as content needs them.

---

## 5 · `include` → shortcode registry (the important part)

`{% include NAME args %}` does **not** read a file. NAME maps to a registered
generator `(args, ctx) => htmlString`, fed by `package.db`. Two kinds:

**A. Publisher-artifact replacements** (what `ig-details.md` / `specification.md` need):
| include NAME | Generated from |
| --- | --- |
| `dependency-table` | IG resource `dependsOn[]` |
| `cross-version-analysis` | (stub/optional) |
| `globals-table` | IG resource `global[]` |
| `ip-statements` | package copyright/license metadata |
| `model.svg` (or `model-diagram`) | inline our built SVG asset |

**B. Authoring shortcodes** (our components, React SSR → HTML):
| include NAME | Renders |
| --- | --- |
| `callout` (variant=, title=) | `<Callout>` |
| `codeblock` (lang=, file=) | `<CodeBlock>` |
| `artifact-link` (id=) | resolved link + `Tag` |

Rules:
- **Unknown NAME → build error** (fail loud; never emit a broken `{% include %}`).
- Args are simple `key=value` (quoted strings / refs), parsed to an object.
- Generators are pure: `(args, ctx) → string`; they may pull from `package.db`.

---

## 6 · Explicitly out of scope (cut features)
Arbitrary file/`_includes/*` resolution · full `site`/`site.data`/collections ·
`for`/`tablerow`/`cycle` (phase 1) · custom Jekyll plugins · layouts & multi-layout
inheritance · liquid inside data files · whitespace-control nuance parity. If content
needs one of these, we add it deliberately, not by importing all of Jekyll.

---

## 7 · Implementation: two options

**Option A — LiquidJS, locked down (recommended).** Mature JS Liquid engine; we
restrict capability by *configuration*, not by writing a parser:
- `new Liquid({ strictFilters: true, strictVariables: false, globals: ctx })`.
- Register only our filters; **custom `fs`** so `include` resolves to the shortcode
  registry (or disable file fs and implement `include` as a custom tag).
- Pros: correct Liquid semantics for the dialect the content was authored in; trivial
  to extend; ~one dependency. Cons: ships a fuller engine than we strictly use (mitigated
  by strict flags + not registering extra tags).

**Option B — hand-rolled (~150 LOC).** A tiny tokenizer for `{{…}}` / `{%…%}` + the
five tags + path resolver + filter map. Pros: zero deps, total control, matches the
"from scratch" ethos. Cons: we re-implement (and must keep correct) edge cases
LiquidJS already handles (filter args, nesting, whitespace).

**Recommendation:** start with **A** (locked-down LiquidJS) so existing content renders
faithfully day one; the restriction lives in *what we register*, which is exactly the
subset above. Revisit B only if the dependency or surface area becomes a problem.

> Escape hatch for *this* IG: the 7 sites are few enough to hand-strip/inline today for
> an immediately Liquid-free build. The subset engine is the **reusable** answer.

---

## 8 · Open questions
- `markdownify` filter: do we let included fragments contain Markdown (needs a nested
  md render) or HTML-only? Leaning HTML-only for generated tables; Markdown for prose includes.
- Strict variables: throw on missing path, or empty-string? Propose **warn + empty** in
  dev, **throw** in CI.
- Diagrams (`model.svg`): inline at build vs `<img>` — inline (so it inherits theme/colors
  and ships the underlying structure), per the brief.
