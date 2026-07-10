import { Badge } from '../ds/Badge';
import { PageHeader, StatusBadge, SectionHeading } from '../chrome/Parts';
import { CopyValue } from '../ds/CopyValue';
import type { ResourceRow } from '../core/site-build';

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
        badges={<><StatusBadge status={r.Status ?? undefined} /><Badge tone="luteal" variant="soft">{concepts.length} concepts</Badge>{data.caseSensitive && <Badge tone="neutral" variant="outline">case-sensitive</Badge>}</>}
        lead={r.Description}
        meta={[
          ['Official URL', <CopyValue value={r.Url ?? undefined} label="official URL" truncate="middle" />],
          ['Computable', <CopyValue value={r.Name ?? undefined} label="computable name" />],
          ['Status', `${r.Status} · v${r.Version}`],
          ['Content', data.content || 'complete'],
        ]}
      />
      <section className="art-section" id="concepts">
        <SectionHeading id="concepts">Concepts</SectionHeading>
        <div className="table-scroll">
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
        </div>
      </section>
    </>
  );
}
