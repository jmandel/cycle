import React from 'react';
import { Badge } from '../ds/Badge.jsx';
import { PageHeader, StatusBadge, Tag, SectionHeading } from '../chrome/Parts';
import type { ResolveType } from './ElementTable';
import type { ResourceRow } from '../core/db';

interface ExpansionCode { system: string; code: string; display?: string }

export function ValueSetPage({ r, data, resolve, expansion }: { r: ResourceRow; data: any; resolve: ResolveType; expansion: ExpansionCode[] }) {
  const includes: any[] = data.compose?.include || [];
  return (
    <>
      <PageHeader
        eyebrow="Value set"
        title={r.Title || r.Name || r.Id}
        badges={<><StatusBadge status={r.Status} /><Badge tone="neutral" variant="outline">{(expansion.length || includes.reduce((n, i) => n + (i.concept?.length || 0), 0))} codes</Badge></>}
        lead={r.Description}
        meta={[
          ['Official URL', <Tag>{r.Url}</Tag>],
          ['Computable', <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)' }}>{r.Name}</span>],
          ['Status', `${r.Status} · v${r.Version}`],
        ]}
      />

      <section className="art-section" id="definition">
        <SectionHeading id="definition">Composition</SectionHeading>
        {includes.map((inc, i) => {
          const sysName = inc.system ? (inc.system.split('/').pop() || inc.system) : '—';
          return (
            <div key={i} style={{ marginBottom: 18 }}>
              <p style={{ margin: '0 0 8px', fontSize: 'var(--text-sm)', color: 'var(--ink-700)' }}>
                Include {inc.concept ? `${inc.concept.length} code${inc.concept.length === 1 ? '' : 's'} from` : 'all codes from'}{' '}
                <Tag tone="luteal" href={resolve('CodeSystem', inc.system)}>{sysName}</Tag>
              </p>
              {inc.concept && (
                <table className="cycle-table">
                  <thead><tr><th>Code</th><th>Display</th></tr></thead>
                  <tbody>
                    {inc.concept.map((c: any) => (
                      <tr key={c.code}><td><code style={{ fontFamily: 'var(--font-mono)' }}>{c.code}</code></td><td>{c.display || ''}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
              {inc.filter && (
                <ul style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-700)' }}>
                  {inc.filter.map((f: any, j: number) => <li key={j}><code>{f.property} {f.op} {f.value}</code></li>)}
                </ul>
              )}
            </div>
          );
        })}
      </section>

      {expansion.length > 0 && (
        <section className="art-section" id="expansion">
          <SectionHeading id="expansion">Expansion</SectionHeading>
          <table className="cycle-table">
            <thead><tr><th>Code</th><th>Display</th><th>System</th></tr></thead>
            <tbody>
              {expansion.map((c, i) => (
                <tr key={i}><td><code style={{ fontFamily: 'var(--font-mono)' }}>{c.code}</code></td><td>{c.display || ''}</td><td><span className="muted">{c.system.split('/').pop()}</span></td></tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
