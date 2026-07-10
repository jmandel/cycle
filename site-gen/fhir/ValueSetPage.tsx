import { Badge } from '../ds/Badge';
import { PageHeader, StatusBadge, Tag, SectionHeading } from '../chrome/Parts';
import { CopyValue } from '../ds/CopyValue';
import type { ResolveType } from './ElementTable';
import type { ResourceRow } from '../core/site-build';

interface ExpansionCode { system: string; code: string; display?: string }

export function ValueSetPage({ r, data, resolve, expansion }: { r: ResourceRow; data: any; resolve: ResolveType; expansion: ExpansionCode[] }) {
  const includes: any[] = data.compose?.include || [];
  return (
    <>
      <PageHeader
        eyebrow="Value set"
        title={r.Title || r.Name || r.Id}
        badges={<><StatusBadge status={r.Status ?? undefined} /><Badge tone="neutral" variant="outline">{(expansion.length || includes.reduce((n, i) => n + (i.concept?.length || 0), 0))} codes</Badge></>}
        lead={r.Description}
        meta={[
          ['Official URL', <CopyValue value={r.Url ?? undefined} label="official URL" truncate="middle" />],
          ['Computable', <CopyValue value={r.Name ?? undefined} label="computable name" />],
          ['Status', `${r.Status} · v${r.Version}`],
        ]}
      />

      <section className="art-section" id="definition">
        <SectionHeading id="definition">Composition</SectionHeading>
        {includes.map((inc, i) => {
          const systemUrl = inc.system || '—';
          const systemHref = inc.system?.startsWith('https://cycle.fhir.me/')
            ? resolve('CodeSystem', inc.system)
            : inc.system;
          return (
            <div key={i} style={{ marginBottom: 18 }}>
              <p style={{ margin: '0 0 8px', fontSize: 'var(--text-sm)', color: 'var(--ink-700)' }}>
                Include {inc.concept ? `${inc.concept.length} code${inc.concept.length === 1 ? '' : 's'} from` : 'all codes from'}{' '}
                <Tag tone="luteal" href={systemHref}>{systemUrl}</Tag>
              </p>
              {inc.concept && (
                <div className="table-scroll">
                  <table className="cycle-table">
                    <thead><tr><th>Code</th><th>Display</th></tr></thead>
                    <tbody>
                      {inc.concept.map((c: any) => (
                        <tr key={c.code}><td><code style={{ fontFamily: 'var(--font-mono)' }}>{c.code}</code></td><td>{c.display || ''}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
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
          <div className="table-scroll">
            <table className="cycle-table">
              <thead><tr><th>Code</th><th>Display</th><th>System</th></tr></thead>
              <tbody>
                {expansion.map((c, i) => (
                  <tr key={i}>
                    <td><code style={{ fontFamily: 'var(--font-mono)' }}>{c.code}</code></td>
                    <td>{c.display || ''}</td>
                    <td><code style={{ fontFamily: 'var(--font-mono)' }}>{c.system}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
