/**
 * project/includes.ts — PROJECT-OWNED Liquid `{% include NAME %}` registry.
 * View-first: each entry derives HTML from the closed IG resource. Plain
 * file-like includes are resolved from text assets in the explicit content
 * context by core/content.ts.
 * Adding or removing an include here does not touch the generic renderer
 * (core/liquid.ts). Another IG would replace this file.
 */
import type { IncludeRegistry } from '../core/liquid';

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attr = (s: unknown) => esc(s).replace(/"/g, '&quot;');
const safeAsset = (s: unknown) => {
  const name = String(s ?? '').trim().replace(/\\/g, '/');
  if (!name || name.startsWith('/') || name.split('/').some((part) => !part || part === '..')) return '';
  return name;
};
const safeCssSize = (s: unknown) => {
  const value = String(s ?? '').trim();
  return /^(\d+(\.\d+)?(px|em|rem|%)?|auto)$/i.test(value) ? value : '';
};

function dependencyTable(ig: any, mode: 'full' | 'short' | 'nontech' = 'full'): string {
  const deps = ig.dependsOn || [];
  if (!deps.length) return '<p class="muted">No package dependencies.</p>';
  if (mode === 'nontech') {
    const names = deps.map((d: any) => esc(d.packageId || d.uri || '')).filter(Boolean);
    return `<p>This guide depends on ${names.length ? names.map((n: string) => `<code>${n}</code>`).join(', ') : 'no other FHIR packages'}.</p>`;
  }
  const rows = deps.map((d: any) => {
    const pkg = esc(d.packageId || d.uri || '');
    const version = esc(d.version || '');
    return mode === 'short'
      ? `<tr><td><code>${pkg}</code></td><td><code>${version}</code></td></tr>`
      : `<tr><td><code>${pkg}</code></td><td><code>${version}</code></td><td>${esc(d.uri || '')}</td></tr>`;
  }).join('');
  const extra = mode === 'short' ? '' : '<th>Canonical</th>';
  return `<div class="table-scroll"><table class="cycle-table"><thead><tr><th>Package</th><th>Version</th>${extra}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

export const includes: IncludeRegistry = {
  // Common Publisher-style image include used by many IGs:
  // {% include img.html img="diagram.png" caption="Figure 1" width="70%" %}
  'img.html': (_ig, params) => {
    const img = safeAsset(params.img || params.src);
    if (!img) throw new Error('img.html include requires a safe img= filename');
    const caption = params.caption || '';
    const width = safeCssSize(params.width);
    const style = width ? ` style="max-width:${attr(width)}"` : '';
    return `<figure class="ig-figure"><img src="${attr(img)}" alt="${attr(caption)}"${style}>${caption ? `<figcaption>${esc(caption)}</figcaption>` : ''}</figure>`;
  },

  // Dependency tables: derived from the IG resource's dependsOn (in the DB).
  'dependency-table.xhtml': (ig) => dependencyTable(ig),
  'dependency-table-en.xhtml': (ig) => dependencyTable(ig),
  'dependency-table-short.xhtml': (ig) => dependencyTable(ig, 'short'),
  'dependency-table-short-en.xhtml': (ig) => dependencyTable(ig, 'short'),
  'dependency-table-nontech.xhtml': (ig) => dependencyTable(ig, 'nontech'),
  'dependency-table-nontech-en.xhtml': (ig) => dependencyTable(ig, 'nontech'),

  // globals: derived from IG.global.
  'globals-table.xhtml': (ig) => {
    const g = ig.global || [];
    if (!g.length) return '<p class="muted">No global profiles declared.</p>';
    const rows = g.map((x: any) => `<tr><td><code>${esc(x.type)}</code></td><td><code>${esc(x.profile)}</code></td></tr>`).join('');
    return `<div class="table-scroll"><table class="cycle-table"><thead><tr><th>Type</th><th>Profile</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  },

  // IP / copyright: derived from IG metadata.
  'ip-statements.xhtml': (ig) => {
    const bits = [ig.copyright, ig.publisher && `Publisher: ${ig.publisher}`].filter(Boolean).map(esc);
    return `<p class="muted">${bits.join(' · ') || 'CC0-1.0.'}</p>`;
  },
  'ip-statements-en.xhtml': (ig) => includes['ip-statements.xhtml'](ig, {}),

  // The one genuine non-DB-derivable fragment (publisher-computed). Omitted.
  'cross-version-analysis.xhtml': () => '<!-- cross-version-analysis: omitted (not available in the closed Cycle view) -->',
  'cross-version-analysis-inline.xhtml': () => '<!-- cross-version-analysis-inline: omitted (not available in the closed Cycle view) -->',
  'cross-version-analysis-inline-en.xhtml': () => '<!-- cross-version-analysis-inline: omitted (not available in the closed Cycle view) -->',
};
