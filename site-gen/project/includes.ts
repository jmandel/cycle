/**
 * project/includes.ts — PROJECT-OWNED Liquid `{% include NAME %}` registry.
 * DB-first: each entry derives HTML from the IG resource / ingested assets.
 * Adding or removing an include here does not touch the generic renderer
 * (core/liquid.ts). Another IG would replace this file.
 */
import * as db from '../core/db';
import type { IncludeRegistry } from '../core/liquid';

const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const includes: IncludeRegistry = {
  // model diagram: generated from PlantUML at ingest, stored in Assets (single source).
  'model.svg': () => db.asset('model.svg') || '<!-- model.svg not ingested -->',

  // dependency table: derived from the IG resource's dependsOn (in the DB).
  'dependency-table.xhtml': (ig) => {
    const deps = ig.dependsOn || [];
    if (!deps.length) return '<p class="muted">No package dependencies.</p>';
    const rows = deps.map((d: any) =>
      `<tr><td><code>${esc(d.packageId || d.uri || '')}</code></td><td><code>${esc(d.version || '')}</code></td></tr>`).join('');
    return `<table class="cycle-table"><thead><tr><th>Package</th><th>Version</th></tr></thead><tbody>${rows}</tbody></table>`;
  },

  // globals: derived from IG.global.
  'globals-table.xhtml': (ig) => {
    const g = ig.global || [];
    if (!g.length) return '<p class="muted">No global profiles declared.</p>';
    const rows = g.map((x: any) => `<tr><td><code>${esc(x.type)}</code></td><td><code>${esc(x.profile)}</code></td></tr>`).join('');
    return `<table class="cycle-table"><thead><tr><th>Type</th><th>Profile</th></tr></thead><tbody>${rows}</tbody></table>`;
  },

  // IP / copyright: derived from IG metadata.
  'ip-statements.xhtml': (ig) => {
    const bits = [ig.copyright, ig.publisher && `Publisher: ${ig.publisher}`].filter(Boolean).map(esc);
    return `<p class="muted">${bits.join(' · ') || 'CC0-1.0.'}</p>`;
  },

  // The one genuine non-DB-derivable fragment (publisher-computed). Omitted.
  'cross-version-analysis.xhtml': () => '<!-- cross-version-analysis: omitted (not derivable from package.db) -->',
};
