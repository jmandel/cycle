import { Badge } from '../ds/Badge';
import { PageHeader, StatusBadge, SectionHeading } from '../chrome/Parts';
import { CopyValue } from '../ds/CopyValue';
import type { CycleConcept, CycleResource } from '../core/semantic-site-build';

export function CodeSystemPage({ r, data, concepts }: { r: CycleResource; data: any; concepts: CycleConcept[] }) {
  const rows: { concept: CycleConcept; depth: number; path: string }[] = [];
  const walk = (items: readonly CycleConcept[], depth: number, parent = '') => {
    for (const [index, concept] of items.entries()) {
      const path = `${parent}/${index}:${concept.code}`;
      rows.push({ concept, depth, path });
      walk(concept.children, depth + 1, path);
    }
  };
  walk(concepts, 0);

  return (
    <>
      <PageHeader
        eyebrow="Code system"
        eyebrowColor="var(--luteal-deep)"
        title={r.title || r.name || r.id}
        badges={<><StatusBadge status={r.status ?? undefined} /><Badge tone="luteal" variant="soft">{rows.length} concepts</Badge>{data.caseSensitive && <Badge tone="neutral" variant="outline">case-sensitive</Badge>}</>}
        lead={r.description}
        meta={[
          ['Official URL', <CopyValue value={r.url ?? undefined} label="official URL" truncate="middle" />],
          ['Computable', <CopyValue value={r.name ?? undefined} label="computable name" />],
          ['Status', `${r.status} · v${r.version}`],
          ['Content', data.content || 'complete'],
        ]}
      />
      <section className="art-section" id="concepts">
        <SectionHeading id="concepts">Concepts</SectionHeading>
        <div className="table-scroll">
          <table className="cycle-table">
            <thead><tr><th>Code</th><th>Display</th><th>Definition</th></tr></thead>
            <tbody>
              {rows.map(({ concept, depth, path }) => (
                <tr key={path}>
                  <td style={{ paddingLeft: 14 + depth * 18 }}><code style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{concept.code}</code></td>
                  <td>{concept.display || ''}</td>
                  <td className="muted" style={{ color: 'var(--ink-700)' }}>{concept.definition || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
