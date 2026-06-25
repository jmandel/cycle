import React from 'react';
import { Badge } from '../ds/Badge.jsx';
import { PageHeader, StatusBadge, Tag, SectionHeading } from '../chrome/Parts';
import { CopyValue } from '../ds/CopyValue.jsx';
import { ElementTable, elementViews, ResolveType } from './ElementTable';
import { Tabs } from '../chrome/Tabs';
import type { ResourceRow } from '../core/db';

export interface ProfileRequirement {
  key: string;
  severity?: string;
  human?: string;
  expression?: string;
}

export interface ProfileExampleUse {
  title: string;
  href: string;
  count: number;
  direct: boolean;
  resourceTypes: string[];
}

function localName(path = ''): string {
  const parts = path.split('.');
  return parts[parts.length - 1] || path;
}

function codeSystemLabel(system = ''): string {
  if (system === 'https://cycle.fhir.me/CodeSystem/cycle') return 'cycle';
  if (system === 'http://loinc.org') return 'LOINC';
  if (system === 'http://snomed.info/sct') return 'SNOMED CT';
  if (system === 'http://terminology.hl7.org/CodeSystem/observation-category') return 'observation-category';
  return system.split('/').pop() || system;
}

function conceptLabel(v: any): string {
  const coding = v?.coding?.[0];
  if (!coding) return v?.text || JSON.stringify(v);
  return `${codeSystemLabel(coding.system)}#${coding.code}`;
}

function fixedSummary(e: any): string | null {
  for (const key of Object.keys(e || {})) {
    if (!key.startsWith('fixed') && !key.startsWith('pattern')) continue;
    const value = e[key];
    if (value == null) continue;
    const kind = key.startsWith('fixed') ? 'fixed' : 'pattern';
    const rendered = typeof value === 'object'
      ? conceptLabel(value)
      : String(value);
    return `${kind}: ${rendered}`;
  }
  return null;
}

function typeLabel(t: any): string {
  const targets = t.targetProfile || (t.code === 'Reference' || t.code === 'canonical' ? [] : t.profile);
  if (targets?.length) {
    const names = targets.map((tp: string) => tp.split('/').pop() || tp).join(' | ');
    return `${t.code}(${names})`;
  }
  return t.code;
}

function bindingLabel(e: any): string | null {
  if (!e.binding?.valueSet) return null;
  if (!e.binding.valueSet.startsWith('https://cycle.fhir.me/')) return null;
  const name = e.binding.valueSet.split('/').pop() || e.binding.valueSet;
  return `${e.binding.strength || 'binding'}: ${name}`;
}

function firstItems(items: { label: string; value: React.ReactNode }[], limit = 6) {
  const visible = items.slice(0, limit);
  if (items.length > limit) visible.push({ label: 'More', value: `${items.length - limit} additional constraints in Formal definition` });
  return visible;
}

function ProfileGlance({ data, rootType }: { data: any; rootType: string }) {
  const views = elementViews(data.snapshot?.element, data.differential?.element, rootType);
  const keyElements = views.key.filter((e: any) => e.path && e.path !== rootType);
  const topLevel = (e: any) => e.path.split('.').length === 2;
  const notable = keyElements.filter(topLevel);

  const required = firstItems(notable
    .filter((e: any) => (e.min ?? 0) > 0)
    .map((e: any) => ({ label: localName(e.path), value: `${e.min}..${e.max ?? '*'}` })));

  const fixed = firstItems(notable
    .map((e: any) => ({ e, value: fixedSummary(e) }))
    .filter((x: any) => x.value)
    .map((x: any) => ({ label: localName(x.e.path), value: x.value })));

  const types = firstItems(notable
    .filter((e: any) => e.type?.length && (e.path.includes('[x]') || ['subject', 'device'].includes(localName(e.path))))
    .map((e: any) => ({ label: localName(e.path), value: e.type.map(typeLabel).join(' | ') })));

  const bindings = firstItems(notable
    .map((e: any) => ({ e, value: bindingLabel(e) }))
    .filter((x: any) => x.value)
    .map((x: any) => ({ label: localName(x.e.path), value: x.value })));

  const groups = [
    { title: 'Required', items: required },
    { title: 'Fixed values', items: fixed },
    { title: 'Allowed types', items: types },
    { title: 'Bindings', items: bindings },
  ].filter((g) => g.items.length);

  if (!groups.length) return null;
  return (
    <section className="art-section profile-glance" id="glance">
      <SectionHeading id="glance">At a glance</SectionHeading>
      <div className="glance-grid">
        {groups.map((group) => (
          <div className="glance-card" key={group.title}>
            <h3>{group.title}</h3>
            <dl>
              {group.items.map((item) => (
                <React.Fragment key={`${item.label}-${String(item.value)}`}>
                  <dt>{item.label}</dt>
                  <dd>{item.value}</dd>
                </React.Fragment>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </section>
  );
}

function ProfileRequirements({ requirements }: { requirements: ProfileRequirement[] }) {
  if (!requirements.length) return null;
  return (
    <section className="art-section" id="requirements">
      <SectionHeading id="requirements">Profile requirements</SectionHeading>
      <div className="constraint-list">
        {requirements.map((c) => (
          <div className="constraint-card" key={c.key}>
            <div className="constraint-head">
              <code>{c.key}</code>
              {c.severity && <Badge tone="menstrual" variant="soft">{c.severity}</Badge>}
            </div>
            {c.human && <p>{c.human}</p>}
            {c.expression && <CopyValue value={c.expression} label={`${c.key} FHIRPath expression`} />}
          </div>
        ))}
      </div>
    </section>
  );
}

function ProfileExamples({ examples }: { examples: ProfileExampleUse[] }) {
  if (!examples.length) return null;
  return (
    <section className="art-section" id="examples">
      <SectionHeading id="examples">Examples using this profile</SectionHeading>
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
    </section>
  );
}

export function ProfilePage({
  r, data, resolve, requirements = [], examples = [],
}: {
  r: ResourceRow;
  data: any;
  resolve: ResolveType;
  requirements?: ProfileRequirement[];
  examples?: ProfileExampleUse[];
}) {
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
      <ProfileGlance data={data} rootType={rootType} />
      <ProfileRequirements requirements={requirements} />
      <ProfileExamples examples={examples} />

      <section className="art-section" id="elements">
        <div className="eyebrow" style={{ color: 'var(--ovulatory-deep)' }}>Formal content</div>
        <SectionHeading id="elements">Formal definition</SectionHeading>
        <p className="section-lead">Start with Key elements for the constrained contract; Differential shows authored changes, and Snapshot shows the fully resolved FHIR structure.</p>
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
