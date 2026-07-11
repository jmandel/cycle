import { Badge } from '../ds/Badge';
import { CodeBlock } from '../ds/CodeBlock';
import { PageHeader, StatusBadge, Tag, SectionHeading } from '../chrome/Parts';
import { CopyValue } from '../ds/CopyValue';
import { Icon } from '../ds/Icon';
import { ElementTable, elementViews, ResolveType } from './ElementTable';
import { Tabs } from '../chrome/Tabs';
import type { CycleResource } from '../core/semantic-site-build';

export interface ProfileRequirement {
  key: string;
  severity?: string;
  human?: string;
  expression?: string;
}

export interface ProfileExampleUse {
  title: string;
  href: string;
  jsonHref?: string;
  count: number;
  direct: boolean;
  resourceTypes: string[];
  preview?: {
    filename: string;
    code: string;
  };
}

function FormalConstraints({ requirements }: { requirements: ProfileRequirement[] }) {
  if (!requirements.length) return null;
  return (
    <div className="formal-constraints">
      <h3>Additional constraints</h3>
      <ul>
        {requirements.map((c) => (
          <li key={c.key}>
            {c.human || c.key}
            {c.severity && <span className="constraint-severity">{c.severity}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ProfileInlineExampleDetail({ examples }: { examples: ProfileExampleUse[] }) {
  const example = examples.find((e) => e.direct && e.preview);
  if (!example?.preview) return null;
  return (
    <div className="profile-inline-example">
      <h3 className="profile-inline-heading">Standalone example</h3>
      <p className="section-lead">
        A minimal standalone resource showing this profile in use. It is generated from the same worked export as the sample SMART Health Link.
      </p>
      <CodeBlock lang="json" filename={example.preview.filename} code={example.preview.code} copy />
      <div className="split-action">
        <a className="split-action-main" href={example.href}>Open example page</a>
        {example.jsonHref && (
          <div className="split-action-menu">
            <button type="button" className="split-action-toggle" aria-label="More example actions">
              <Icon name="chevronDown" size={16} strokeWidth={2.4} />
            </button>
            <div className="split-action-options">
              <a href={example.jsonHref}>Open raw JSON</a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ProfileExamplesSection({ examples }: { examples: ProfileExampleUse[] }) {
  if (!examples.length) return null;
  return (
    <section className="art-section" id="examples">
      <SectionHeading id="examples">Examples</SectionHeading>
      <div className="profile-example-list">
        {examples.map((e) => (
          <a className="profile-example" href={e.href} key={e.href}>
            <span>
              <strong>{e.title}</strong>
              <span>{e.direct ? 'Direct profile use' : 'Use through derived profiles'}</span>
            </span>
            <span>{e.count.toLocaleString()} {e.count === 1 ? 'resource' : 'resources'}</span>
            <span>{e.resourceTypes.join(', ')}</span>
            <span className="profile-example-action">Open example</span>
          </a>
        ))}
      </div>
      <ProfileInlineExampleDetail examples={examples} />
    </section>
  );
}

export function ProfilePage({
  r, data, resolve, requirements = [], examples = [], authoredElementChain,
}: {
  r: CycleResource;
  data: any;
  resolve: ResolveType;
  requirements?: ProfileRequirement[];
  examples?: ProfileExampleUse[];
  authoredElementChain?: any[];
}) {
  const rootType = r.sdType || data.type;
  const baseName = r.base ? (r.base.split('/').pop() || r.base) : rootType;
  return (
    <>
      <PageHeader
        eyebrow={`Profile · ${rootType}`}
        title={r.title || r.name || r.id}
        badges={<><StatusBadge status={r.status ?? undefined} /><Badge tone="neutral" variant="outline">{r.derivation === 'constraint' ? 'Constraint' : r.derivation || 'Profile'}</Badge></>}
        lead={r.description}
        meta={[
          ['Official URL', <CopyValue value={r.url ?? undefined} label="official URL" truncate="middle" />],
          ['Computable', <CopyValue value={r.name ?? undefined} label="computable name" />],
          ['Status', `${r.status} · v${r.version}`],
          ['Base', <Tag tone="luteal" href={resolve(rootType!, r.base ?? undefined)}>{baseName}</Tag>],
        ]}
      />
      <ProfileExamplesSection examples={examples} />

      <section className="art-section" id="elements">
        <div className="eyebrow" style={{ color: 'var(--ovulatory-deep)' }}>Formal content</div>
        <SectionHeading id="elements">Formal definition</SectionHeading>
        <p className="section-lead">Start with Key elements for the constrained contract; Differential shows authored changes, and Snapshot shows the fully resolved FHIR structure.</p>
        {(() => {
          const v = elementViews(data.snapshot?.element, data.differential?.element, rootType, authoredElementChain);
          return (
            <Tabs id="elements" tabs={[
              { label: `Key elements (${v.key.length})`, content: <ElementTable elements={v.key} resolve={resolve} /> },
              { label: `Differential (${v.differential.length})`, content: <ElementTable elements={v.differential} resolve={resolve} /> },
              { label: `Snapshot (${v.snapshot.length})`, content: <ElementTable elements={v.snapshot} resolve={resolve} /> },
            ]} />
          );
        })()}
        <p className="flag-legend">
          Required elements (min&nbsp;≥&nbsp;1) are shown in coral. <strong>Key elements</strong> = what this profile constrains; <strong>Snapshot</strong> = the full resolved structure.
        </p>
        <FormalConstraints requirements={requirements} />
      </section>
    </>
  );
}
