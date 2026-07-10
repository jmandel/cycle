import React from 'react';
import { CodeBlock } from '../ds/CodeBlock';
import { PageHeader, Tag, SectionHeading } from '../chrome/Parts';
import type { ResourceRow } from '../core/site-build';

export function ResourcePage({ r, data }: { r: ResourceRow; data: any }) {
  const json = JSON.stringify(data, null, 2);
  const jsonFile = `${r.Type}-${r.Id}.json`;
  return (
    <>
      <PageHeader
        eyebrow={`FHIR ${data.resourceType || r.Type}`}
        eyebrowColor="var(--ovulatory-deep)"
        title={r.Title || r.Name || r.Id}
        lead={r.Description}
        meta={[
          ['Type', <Tag>{data.resourceType || r.Type}</Tag>],
          ['Id', <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)' }}>{r.Id}</span>],
          ...(r.Url ? [['Canonical', <code>{r.Url}</code>] as [string, React.ReactNode]] : []),
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
