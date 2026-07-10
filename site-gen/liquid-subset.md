# Cycle Liquid contract

Status: implemented. This document describes the shared Cycle narrative policy
in `core/liquid.ts` and `core/content.ts`; it is not a proposal for choosing a
Liquid library.

Cycle uses LiquidJS. The native CLI and browser editor call the same
`createCycleContentRenderer()` and `CycleSiteRenderer`. There is no browser fork
and no fallback to the Rust Publisher-template Liquid engine.

## Placement

For a narrative page, the renderer applies:

```text
PageRow.Body
  -> CycleContentRenderer.renderLiquid
  -> known FHIR/core link rewriting
  -> Markdown rendering
  -> React static markup inside the Cycle Layout
```

The content renderer is injected into `CycleSiteRenderer`. Its request contains
the page identity and an immutable `CycleContentContext` built from one
`SiteBuildView`.

## Data boundary

Liquid can read only values assembled into its explicit context:

- `site.data`, including `site.data.fhir.ig` and the Cycle metadata projection;
- the current ImplementationGuide resource;
- registered computed includes;
- generated fragment text exposed by the view;
- previously ingested textual assets;
- resources resolved from the view for `{% fragment %}`; and
- an optional, explicitly injected SQL executor.

The portable/browser renderer never calls a compiler, fragment engine, native
template tree, filesystem, SQLite connection, or ambient “active database.” A
missing capability is an error, not a callback opportunity.

## LiquidJS configuration

`core/liquid.ts` constructs LiquidJS with:

```ts
new Liquid({ strictFilters: true, strictVariables: false, extname: '' })
```

Standard LiquidJS tags and filters are available. An unknown filter fails.
Missing variables follow Liquid's empty/nil behavior because strict variables
are disabled. There is no LiquidJS filesystem: Cycle replaces include behavior
with an explicit registry/asset lookup.

## Custom tags and behavior

### `include` and `lang-fragment`

```liquid
{% include dependency-table.xhtml %}
{% include sample-viewer-links.md variant="compact" %}
```

Both tags use the same resolution order:

1. a registered pure include generator receives the ImplementationGuide and
   parsed `key=value` parameters;
2. otherwise a same-named textual asset from the closed view is recursively
   evaluated with the same Liquid data and `include` parameters;
3. otherwise rendering fails with an unknown-include error.

No filesystem search occurs during rendering. Binary assets are not treated as
Liquid source.

The standard content policy has one narrowly named preview placeholder for
`sample-viewer-links.md` when that build-wrapper artifact is absent. Other
unknown includes fail.

### `fragment`

```liquid
{% fragment Questionnaire/example JSON BASE:descendants().select(item) %}
{% fragment Binary/Services XML EXCEPT:services.where(hook='appointment-book') %}
```

The tag resolves `Type/id` through the view, optionally decodes JSON
`Binary.data`, applies supported `BASE:`, `EXCEPT:`, and `ELIDE:` selectors, and
emits escaped JSON or FHIR-like XML. Unsupported selector syntax and missing
resources fail.

For compatibility with Publisher-authored pages, a final fragment pass also
evaluates a `{% fragment %}` that LiquidJS correctly preserved inside a
`{% raw %}` block. This is a deliberate, tested authoring quirk.

This resource fragment is a Cycle-owned pure formatter. It is not a request for
Rust Publisher `_includes` and does not cross the native `ArtifactResolver`.

### `sql` and `sqlToData`: native capability only

The shared parser understands the IG Guidance forms:

```liquid
{% sql
select Code, Display, Definition as Meaning
from Concepts
order by Key
%}
```

```liquid
{% sql {
  "query": "select Name, Description, Web from Resources",
  "columns": [
    { "source": "Name", "type": "link", "target": "Web" },
    { "source": "Description", "type": "text" }
  ]
} %}
```

```liquid
{% sqlToData itemQuery SELECT count(*) as n from Metadata %}
Number of metadata items: {{ itemQuery[0].n }}
```

SQL is not part of the portable `SiteBuildView` contract. Only the explicitly
selected native `SITE_DB` legacy path injects an executor backed by the
read-only `SqliteSiteBuildView`. Browser and native `SITE_BUILD_DIR` construction
omit it; using either tag then fails with “no SQL executor was provided.”

Even in native mode the query must begin with `SELECT` or `WITH`, contain no
semicolon, and contain none of the mutation/attachment/schema keywords rejected
by `assertSafeSelect`. This is trusted first-party build compatibility, not an
end-user query API.

## Includes and generated fragments

Cycle's computed include registry is passed explicitly as
`CycleRendererOptions.includes`. The renderer also makes these view-derived
functions available to the content policy:

- `generatedFragment(name)`;
- `textAsset(name)`; and
- `resolveFragmentResource(type, id)`.

Adding a new include should normally mean adding a pure generator or ingesting a
text asset. It should not mean adding another global store, filesystem probe, or
compiler callback.

## Failure and leniency

Strict mode is the default. A Liquid, include, fragment, or missing-capability
error is rethrown with the narrative slug, so the build fails visibly.

`createCycleContentRenderer({ lenient: true, warn })` is an explicit diagnostic
escape hatch: it reports the failure and returns the original source. It is not
the normal publication contract and must not be used to call incomplete output
successful.

## Relationship to `SiteBuild`

The browser and preferred native path construct `SiteBuildView` only after
verifying a `cycle-site/v2` `ClosedSiteBuild` whose render plan requires typed
resource, terminology, navigation, and config roots plus every raw authored
asset root. The v1 `compat.site_db/rows.json` reader and
`SqliteSiteBuildView` remain explicitly selected legacy adapters; neither is
part of the preferred portable chain.

Therefore the intended portable chain is:

```text
ClosedSiteBuild -> SiteBuildView -> CycleSiteRenderer
                -> CycleContentRenderer -> LiquidJS
```

All data needed by Liquid is already on the closed side of that boundary.
