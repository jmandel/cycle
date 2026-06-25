import React from 'react';
import { CodeBlock } from '../ds/CodeBlock.jsx';
import { Island } from '../chrome/Island';
import { PageHeader, Tag, SectionHeading } from '../chrome/Parts';
import type { ResourceRow } from '../core/db';

export function ExamplePage({ r, data }: { r: ResourceRow; data: any }) {
  const json = JSON.stringify(data, null, 2);
  return (
    <>
      <PageHeader
        eyebrow={`Example · ${data.resourceType}`}
        eyebrowColor="var(--ovulatory-deep)"
        title={r.Title || r.Name || r.Id}
        lead={r.Description}
        meta={[
          ['Type', <Tag>{data.resourceType}</Tag>],
          ['Id', <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)' }}>{r.Id}</span>],
          ...(data.entry ? [['Entries', String(data.entry.length)] as [string, React.ReactNode]] : []),
        ]}
      />
      <section className="art-section" id="source">
        <SectionHeading id="source">Source</SectionHeading>
        <Island name="CodeBlock" component={CodeBlock} props={{ lang: 'json', filename: `${r.Type}-${r.Id}.json`, code: json, showLines: true }} />
      </section>
    </>
  );
}
