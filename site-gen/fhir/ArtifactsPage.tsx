import React from 'react';
import { Tag } from '../ds/Tag';
import type { CycleResource } from '../core/semantic-site-build';

type ProfileGroup = { label: string; ids: readonly string[] };

const GROUPS: { title: string; types: string[]; accent: string; examples?: boolean }[] = [
  { title: 'Profiles', types: ['StructureDefinition'], accent: 'var(--menstrual)' },
  { title: 'Value sets', types: ['ValueSet'], accent: 'var(--follicular)' },
  { title: 'Code systems', types: ['CodeSystem'], accent: 'var(--luteal)' },
  { title: 'Examples', types: [], accent: 'var(--ovulatory)', examples: true },
];

const shortOf = (d?: string) => {
  if (!d) return '';
  const s = d.split(/(?<=[.?!])\s/)[0];
  return s.length > 110 ? s.slice(0, 110) + '…' : s;
};

export function ArtifactsPage({
  resources, page, isExample = () => false,
  profileGroupLabel = () => null,
  profileGroups = [],
}: {
  resources: CycleResource[];
  page: (r: CycleResource) => string;
  isExample?: (r: CycleResource) => boolean;
  profileGroupLabel?: (id: string) => string | null;
  profileGroups?: readonly ProfileGroup[];
}) {
  const profileGroupRank = new Map<string, number>();
  for (const [i, group] of profileGroups.entries()) {
    for (const id of group.ids) profileGroupRank.set(id, i);
  }
  const orderRows = (rows: CycleResource[], title: string) => {
    if (title !== 'Profiles' || !profileGroups.length) return rows;
    return [...rows].sort((a, b) =>
      (profileGroupRank.get(a.id) ?? 100000) - (profileGroupRank.get(b.id) ?? 100000)
    );
  };
  const detail = (r: CycleResource) => (
    <div className="art-detail">
      {r.description || <em>No description.</em>}
      <div style={{ marginTop: 8 }}>
        <span className="art-action">Open →</span>
      </div>
    </div>
  );

  return (
    <>
      <section id="overview">
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', letterSpacing: 'var(--tracking-eyebrow)', textTransform: 'uppercase', color: 'var(--menstrual-deep)', fontWeight: 600 }}>Artifact index</div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 'var(--text-3xl)', letterSpacing: 'var(--tracking-tight)', margin: '6px 0 12px', lineHeight: 'var(--leading-tight)' }}>Artifacts</h1>
        <p style={{ font: 'var(--type-lead)', color: 'var(--ink-700)', maxWidth: '62ch', margin: '0 0 8px' }}>
          Everything this IG defines, rendered deterministically from one verified, closed IG build.
        </p>
      </section>

      {GROUPS.map((g) => {
        const rows = orderRows(resources.filter((r) => g.examples ? isExample(r) : g.types.includes(r.type)), g.title);
        if (!rows.length) return null;
        return (
          <section key={g.title} id={g.title.toLowerCase().replace(/\s+/g, '-')} style={{ marginTop: 30 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12 }}>
              <span style={{ width: 9, height: 9, borderRadius: 999, background: g.accent }} />
              <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 'var(--text-lg)', margin: 0, border: 'none', padding: 0 }}>{g.title}</h2>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-2xs)', color: 'var(--ink-300)' }}>{rows.length}</span>
            </div>
            <div className="art-card">
              {rows.map((r, i) => {
                const groupLabel = g.title === 'Profiles' ? profileGroupLabel(r.id) : null;
                const priorGroupLabel = g.title === 'Profiles' && i > 0 ? profileGroupLabel(rows[i - 1].id) : null;
                return (
                  <React.Fragment key={r.id}>
                    {groupLabel && groupLabel !== priorGroupLabel && <div className="art-subgroup">{groupLabel}</div>}
                    <a className="art-row" href={page(r)} aria-label={`Open ${r.title || r.name || r.id}`}>
                      <div className="art-summary">
                        <span className="art-name">{r.title || r.name || r.id}</span>
                        <span className="art-kind"><Tag>{r.sdType || r.type}</Tag></span>
                        <span className="art-short">{shortOf(r.description ?? undefined)}</span>
                      </div>
                      {detail(r)}
                    </a>
                  </React.Fragment>
                );
              })}
            </div>
          </section>
        );
      })}
    </>
  );
}
