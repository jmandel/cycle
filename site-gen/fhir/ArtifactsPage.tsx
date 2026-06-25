import React from 'react';
import { Tag } from '../ds/Tag.jsx';
import type { ResourceRow } from '../core/db';

const GROUPS: { title: string; types: string[]; accent: string }[] = [
  { title: 'Profiles', types: ['StructureDefinition'], accent: 'var(--menstrual)' },
  { title: 'Value sets', types: ['ValueSet'], accent: 'var(--follicular)' },
  { title: 'Code systems', types: ['CodeSystem'], accent: 'var(--luteal)' },
  { title: 'Examples', types: ['Bundle'], accent: 'var(--ovulatory)' },
];

const shortOf = (d?: string) => {
  if (!d) return '';
  const s = d.split(/(?<=[.?!])\s/)[0];
  return s.length > 110 ? s.slice(0, 110) + '…' : s;
};

export function ArtifactsPage({ resources, page }: { resources: ResourceRow[]; page: (r: ResourceRow) => string }) {
  const detail = (r: ResourceRow) => (
    <div className="art-detail">
      {r.Description || <em>No description.</em>}
      <div style={{ marginTop: 8 }}>
        <a className="art-link" href={page(r)}>Open artifact: {r.Type}-{r.Id} →</a>
      </div>
    </div>
  );

  return (
    <>
      <section id="overview">
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', letterSpacing: 'var(--tracking-eyebrow)', textTransform: 'uppercase', color: 'var(--menstrual-deep)', fontWeight: 600 }}>The whole IG</div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 'var(--text-3xl)', letterSpacing: 'var(--tracking-tight)', margin: '6px 0 12px', lineHeight: 'var(--leading-tight)' }}>Artifacts</h1>
        <p style={{ font: 'var(--type-lead)', color: 'var(--ink-700)', maxWidth: '62ch', margin: '0 0 8px' }}>
          Everything this IG defines, rendered the same way every time and built directly from the IG Publisher's <code>package.db</code>.
        </p>
      </section>

      {GROUPS.map((g) => {
        const rows = resources.filter((r) => g.types.includes(r.Type));
        if (!rows.length) return null;
        return (
          <section key={g.title} id={g.title.toLowerCase().replace(/\s+/g, '-')} style={{ marginTop: 30 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12 }}>
              <span style={{ width: 9, height: 9, borderRadius: 999, background: g.accent }} />
              <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 'var(--text-lg)', margin: 0, border: 'none', padding: 0 }}>{g.title}</h2>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-2xs)', color: 'var(--ink-300)' }}>{rows.length}</span>
            </div>
            <div className="art-card">
              {rows.map((r) => (
                <div className="art-row" key={r.Id}>
                  <div className="art-summary">
                    <span className="art-name">{r.Title || r.Name || r.Id}</span>
                    <span className="art-kind"><Tag>{r.sdType || r.Type}</Tag></span>
                    <span className="art-short">{shortOf(r.Description)}</span>
                  </div>
                  {detail(r)}
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </>
  );
}
