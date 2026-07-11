import React from 'react';
import { CodeBlock } from '../ds/CodeBlock';
import { PageHeader, Tag, SectionHeading } from '../chrome/Parts';
import type { CycleResource } from '../core/semantic-site-build';

export function ResourcePage({ r, data }: { r: CycleResource; data: any }) {
  const json = JSON.stringify(data, null, 2);
  const jsonFile = `${r.type}-${r.id}.json`;
  return (
    <>
      <PageHeader
        eyebrow={`FHIR ${data.resourceType || r.type}`}
        eyebrowColor="var(--ovulatory-deep)"
        title={r.title || r.name || r.id}
        lead={r.description}
        meta={[
          ['Type', <Tag>{data.resourceType || r.type}</Tag>],
          ['Id', <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)' }}>{r.id}</span>],
          ...(r.url ? [['Canonical', <code>{r.url}</code>] as [string, React.ReactNode]] : []),
        ]}
      />
      <section className="art-section" id="source">
        <SectionHeading id="source">Source</SectionHeading>
        <p className="muted">
          The full JSON is published as <a href={jsonFile}><code>{jsonFile}</code></a>.
        </p>
        <CodeBlock lang="json" filename={jsonFile} code={json} showLines copy />
      </section>
    </>
  );
}
