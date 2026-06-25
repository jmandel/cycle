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
  contentDir: 'input/pagecontent',
  imageDir: 'input/images',

  // ---- links to artifacts the SURROUNDING build script injects (viewers, SHL,
  //      skill.zip) — site-gen does not produce these, so the link checker treats
  //      a matching href as satisfied. `*` matches any characters. ----
  externalLinks: ['view*.html', 'view-assets/*', 'view2-assets/*', 'view3-assets/*', '*.zip'],

  // ---- deploy (consumed by scripts/build-sitegen-site.ts, not by site-gen) ----
  cname: 'cycle.fhir.me',

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
};
