import React from 'react';
import { CodeBlock } from '../ds/CodeBlock';
import { PageHeader, Tag, SectionHeading } from '../chrome/Parts';
import type { ResourceRow } from '../core/site-build';

export function ExamplePage({ r, data }: { r: ResourceRow; data: any }) {
  const json = JSON.stringify(data, null, 2);
  const jsonFile = `${r.Type}-${r.Id}.json`;
  const previewLines = json.split('\n');
  const maxPreviewLines = 220;
  const truncated = previewLines.length > maxPreviewLines;
  const preview = previewLines.length > maxPreviewLines
    ? [
      ...previewLines.slice(0, maxPreviewLines),
      '',
      `... ${previewLines.length - maxPreviewLines} more lines; open the full JSON file below`,
    ].join('\n')
    : json;
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
        <p className="muted">
          Preview only. The full JSON is published as <a href={jsonFile}><code>{jsonFile}</code></a>.
        </p>
        <CodeBlock lang="json" filename={`${jsonFile} preview`} code={preview} showLines copy={false} />
        {truncated && (
          <p className="source-action">
            <a href={jsonFile}>Open full JSON: <code>{jsonFile}</code> ({previewLines.length.toLocaleString()} lines) →</a>
          </p>
        )}
      </section>
    </>
  );
}
