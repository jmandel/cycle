import React from 'react';
import { Badge } from '../ds/Badge.jsx';
import { PageHeader, StatusBadge, Tag, SectionHeading } from '../chrome/Parts';
import type { ResourceRow } from '../core/db';

export interface Concept { Key: number; ParentKey: number | null; Code: string; Display?: string; Definition?: string }

export function CodeSystemPage({ r, data, concepts }: { r: ResourceRow; data: any; concepts: Concept[] }) {
  // build hierarchy
  const byParent = new Map<number | null, Concept[]>();
  for (const c of concepts) {
    const k = c.ParentKey ?? null;
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k)!.push(c);
  }
  const rows: { c: Concept; depth: number }[] = [];
  const walk = (parent: number | null, depth: number) => {
    for (const c of byParent.get(parent) || []) { rows.push({ c, depth }); walk(c.Key, depth + 1); }
  };
  walk(null, 0);

  return (
    <>
      <PageHeader
        eyebrow="Code system"
        eyebrowColor="var(--luteal-deep)"
        title={r.Title || r.Name || r.Id}
        badges={<><StatusBadge status={r.Status} /><Badge tone="luteal" variant="soft">{concepts.length} concepts</Badge>{data.caseSensitive && <Badge tone="neutral" variant="outline">case-sensitive</Badge>}</>}
        lead={r.Description}
        meta={[
          ['Official URL', <Tag>{r.Url}</Tag>],
          ['Computable', <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)' }}>{r.Name}</span>],
          ['Status', `${r.Status} · v${r.Version}`],
          ['Content', data.content || 'complete'],
        ]}
      />
      <section className="art-section" id="concepts">
        <SectionHeading id="concepts">Concepts</SectionHeading>
        <table className="cycle-table">
          <thead><tr><th>Code</th><th>Display</th><th>Definition</th></tr></thead>
          <tbody>
            {rows.map(({ c, depth }) => (
              <tr key={c.Key}>
                <td style={{ paddingLeft: 14 + depth * 18 }}><code style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{c.Code}</code></td>
                <td>{c.Display || ''}</td>
                <td className="muted" style={{ color: 'var(--ink-700)' }}>{c.Definition || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
