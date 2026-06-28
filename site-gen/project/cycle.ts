/**
 * project/cycle.ts — the VISIBLE project contract for cycle.fhir.me.
 *
 * Everything another IG would reasonably replace lives here (or in
 * project/includes.ts, project/cycle.css). Plain TypeScript constants, not a
 * schema — open ONE file to see the repo-specific choices.
 *
 * Rule of thumb: if another repo would probably replace it, it belongs in project/.
 */
export const project = {
  // ---- paths ----
  outDir: process.env.OUT_DIR || 'site-gen/out',
  designDir: process.env.SITE_DESIGN_DIR || 'site-gen/designs/cycle',
  projectCss: 'site-gen/project/cycle.css', // shipped as out/assets/project.css
  contentDir: process.env.SITE_CONTENT_DIR || 'input/pagecontent',
  imageDir: process.env.SITE_IMAGE_DIR || 'input/images',
  liquidAssetDirs: process.env.SITE_LIQUID_ASSET_DIRS?.split(',').filter(Boolean) || ['input/includes'],

  // ---- links to artifacts the SURROUNDING build script injects (viewers, SHL,
  //      skill.zip) — site-gen does not produce these, so the link checker treats
  //      a matching href as satisfied. `*` matches any characters. ----
  externalLinks: ['view*.html', 'view-assets/*', 'view2-assets/*', 'view3-assets/*', '*.zip'],

  // ---- deploy (consumed by scripts/build-sitegen-site.ts, not by site-gen) ----
  cname: 'cycle.fhir.me',
  packageList: 'site-gen/project/package-list.json',

  // ---- brand (falls back to IG metadata where a field is omitted) ----
  brand: {
    wordmark: 'cycle',
    tld: '.fhir.me',
    mark: 'cycle-mark.svg', // shipped to out/assets/<mark> by the design drop-in
    tagline: 'Period data, interoperable. A small FHIR R4 model for patient-generated period tracking.',
  },

  // ---- footer "Guide" column: a curated set of REAL destinations.
  //      (Auto-deriving from the menu links group labels like "More" to an
  //      arbitrary first child — explicit, intentional links instead.) ----
  footer: {
    guide: [
      { label: 'Home', href: 'index.html' },
      { label: 'Specification', href: 'specification.html' },
      { label: 'Artifacts', href: 'artifacts.html' },
      { label: 'Worked example', href: 'examples.html' },
    ],
  },

  // ---- artifact grouping: project-specific editorial structure for generated
  //      artifact lists and sidebars. The FHIR renderer only receives the
  //      resolved grouping; it does not know cycle-specific profile names. ----
  profileGroups: [
    { label: 'Base', ids: ['period-tracking-fact'] },
    { label: 'Layer 0 core', ids: ['menstrual-bleeding'] },
    { label: 'Layer 1 facts', ids: ['menstrual-flow', 'symptom', 'numeric-pain-severity', 'basal-body-temperature'] },
    { label: 'Bundle', ids: ['period-tracking-bundle'] },
  ],
};
