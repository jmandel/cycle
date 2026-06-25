import React from 'react';
import { Badge } from '../ds/Badge.jsx';
import { PageHeader, StatusBadge, Tag, SectionHeading } from '../chrome/Parts';
import { CopyValue } from '../ds/CopyValue.jsx';
import { Callout } from '../ds/Callout.jsx';
import { ElementTable, elementViews, ResolveType } from './ElementTable';
import { Tabs } from '../chrome/Tabs';
import type { ResourceRow } from '../core/db';

export function ProfilePage({ r, data, resolve }: { r: ResourceRow; data: any; resolve: ResolveType }) {
  const rootType = r.sdType || data.type;
  const baseName = r.base ? (r.base.split('/').pop() || r.base) : rootType;
  return (
    <>
      <PageHeader
        eyebrow={`Profile · ${rootType}`}
        title={r.Title || r.Name || r.Id}
        badges={<><StatusBadge status={r.Status} /><Badge tone="neutral" variant="outline">{r.derivation === 'constraint' ? 'Constraint' : r.derivation || 'Profile'}</Badge></>}
        lead={r.Description}
        meta={[
          ['Official URL', <CopyValue value={r.Url} label="official URL" />],
          ['Computable', <CopyValue value={r.Name} label="computable name" />],
          ['Status', `${r.Status} · v${r.Version}`],
          ['Base', <Tag tone="luteal" href={resolve(rootType!, r.base)}>{baseName}</Tag>],
        ]}
      />

      <section className="art-section" id="elements">
        <div className="eyebrow" style={{ color: 'var(--ovulatory-deep)' }}>Formal content</div>
        <SectionHeading id="elements">Formal definition</SectionHeading>
        {(() => {
          const v = elementViews(data.snapshot?.element, data.differential?.element, rootType);
          return (
            <Tabs id="elements" tabs={[
              { label: `Key elements (${v.key.length})`, content: <ElementTable elements={v.key} resolve={resolve} /> },
              { label: `Differential (${v.differential.length})`, content: <ElementTable elements={v.differential} resolve={resolve} /> },
              { label: `Snapshot (${v.snapshot.length})`, content: <ElementTable elements={v.snapshot} resolve={resolve} /> },
            ]} />
          );
        })()}
        <p className="flag-legend">
          Flags — <strong>S</strong> Must Support · <strong>?!</strong> Modifier · <strong>Σ</strong> In summary. Required elements (min&nbsp;≥&nbsp;1) shown in coral. <strong>Key elements</strong> = what this profile constrains; <strong>Snapshot</strong> = the full resolved structure.
        </p>
      </section>
    </>
  );
}
