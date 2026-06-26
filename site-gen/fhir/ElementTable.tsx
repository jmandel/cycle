import React from 'react';
import { Tag } from '../ds/Tag.jsx';
import { Badge } from '../ds/Badge.jsx';
import { CopyValue } from '../ds/CopyValue.jsx';

export type ResolveType = (code: string, profileUrl?: string) => string;

interface El {
  path: string;
  id?: string;
  sliceName?: string;
  min?: number;
  max?: string;
  mustSupport?: boolean;
  isModifier?: boolean;
  isSummary?: boolean;
  short?: string;
  type?: { code: string; profile?: string[]; targetProfile?: string[] }[];
  binding?: { strength?: string; valueSet?: string };
  [k: string]: any;
}

function localName(path = ''): string {
  const parts = path.split('.');
  return parts[parts.length - 1] || path;
}

function depthFromRoot(path = ''): number {
  return Math.max(0, path.split('.').length - 1);
}

export function canonicalLabel(url = ''): string {
  if (!url) return '';
  if (url === 'https://cycle.fhir.me/CodeSystem/cycle') return 'Cycle codes';
  if (url === 'http://loinc.org') return 'LOINC';
  if (url === 'http://snomed.info/sct') return 'SNOMED CT';
  if (url === 'http://terminology.hl7.org/CodeSystem/observation-category') return 'Observation category';
  return url.split('/').pop() || url;
}

function jsonSnippet(value: any): string {
  if (value == null) return '';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return JSON.stringify(value);
}

function fixedValue(e: El): { label: string; value: string } | null {
  for (const k of Object.keys(e)) {
    if (k.startsWith('fixed') || k.startsWith('pattern')) {
      const v = (e as any)[k];
      if (v == null) continue;
      return { label: k.startsWith('fixed') ? 'Fixed value' : 'Required pattern', value: jsonSnippet(v) };
    }
  }
  return null;
}

function bindingInfo(e: El): { strength: string; valueSet: string; label: string } | null {
  const valueSet = e.binding?.valueSet;
  if (!valueSet) return null;
  return {
    strength: e.binding?.strength || 'binding',
    valueSet,
    label: canonicalLabel(valueSet),
  };
}

function TypeRefs({ types, resolve }: { types?: El['type']; resolve: ResolveType }) {
  if (!types || types.length === 0) return null;
  const out: React.ReactNode[] = [];
  types.forEach((t, i) => {
    const targets = t.targetProfile || (t.code === 'Reference' || t.code === 'canonical' ? [] : t.profile);
    if (targets && targets.length) {
      targets.forEach((tp, j) => {
        const name = tp.split('/').pop() || tp;
        out.push(<Tag key={`${i}-${j}`} tone="luteal" href={resolve(t.code, tp)}>{t.code}({name})</Tag>);
      });
    } else {
      out.push(<Tag key={i} tone="luteal" href={resolve(t.code)}>{t.code}</Tag>);
    }
  });
  return <span className="el-types">{out}</span>;
}

/** One element = a fused block: a tight header line, then full-width detail.
 *  Deep detail (definition, comment, invariants) goes in a native <details> so
 *  it stays in the DOM (works JS-off, Ctrl-F-able, deep-linkable). */
function ElementRow({ e, resolve }: { e: El; resolve: ResolveType }) {
  const depth = depthFromRoot(e.path);
  let name = localName(e.path);
  if (e.sliceName) name = `${name}:${e.sliceName}`;
  const fixed = fixedValue(e);
  const binding = fixed ? null : bindingInfo(e);
  const constraints = (e.constraint || []).filter((c: any) => c.human);
  const hasDeep = (e.definition && e.definition !== e.short) || e.comment || constraints.length > 0;
  const indent = { paddingLeft: 14 + Math.max(0, depth - 1) * 18 };

  const head = (
    <div className="el-head">
      <div className="el-identity">
        <code className="el-name" id={e.path}>{name}</code>
        <span className={(e.min ?? 0) > 0 ? 'el-cardinality is-required' : 'el-cardinality'}>{e.min ?? 0}..{e.max ?? '*'}</span>
      </div>
      <TypeRefs types={e.type} resolve={resolve} />
    </div>
  );
  const details = [
    fixed && { label: fixed.label, value: <CopyValue value={fixed.value} label={`${name} ${fixed.label}`} className="copy-value--codeblock" /> },
    binding && {
      label: 'Binding',
      value: (
        <span className="el-binding-value">
          <Badge tone="ovulatory" variant="outline">{binding.strength}</Badge>
          <a href={resolve('ValueSet', binding.valueSet)}>{binding.label}</a>
        </span>
      ),
    },
  ].filter(Boolean) as { label: string; value: React.ReactNode }[];

  const body = (e.short || details.length) && (
    <div className="el-body">
      {e.short && <span className="el-short">{e.short}</span>}
      {details.length > 0 && (
        <dl className="el-constraints">
          {details.map((item) => (
            <React.Fragment key={item.label}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </React.Fragment>
          ))}
        </dl>
      )}
    </div>
  );
  const deep = hasDeep && (
    <div className="el-deep">
      {e.definition && e.definition !== e.short && <div className="el-def"><span className="el-k">Definition</span>{e.definition}</div>}
      {e.comment && <div className="el-def"><span className="el-k">Comment</span>{e.comment}</div>}
      {constraints.map((c: any) => (
        <div className="el-inv" key={c.key}><span className="el-k">{c.key} · {c.severity}</span>{c.human} {c.expression && <code>{c.expression}</code>}</div>
      ))}
    </div>
  );

  if (!hasDeep) return <div className="el" style={indent}>{head}{body}</div>;
  return (
    <details className="el" style={indent}>
      <summary>
        <span className="el-summary-main">{head}{body}</span>
        <span className="el-detail-action" aria-hidden="true"></span>
      </summary>
      {deep}
    </details>
  );
}

/** Pre-compute the three element views from a StructureDefinition.
 *  `inheritedCommentPaths` lists element paths where an IG ancestor profile
 *  authored a comment; only those inherit through to the snapshot text so generic
 *  base-FHIR comments stay suppressed while IG guidance carries to derived profiles. */
export function elementViews(snapshot: El[] = [], differential: El[] = [], rootType = '', inheritedCommentPaths: Set<string> = new Set()) {
  const diffByPath = new Map(differential.map((e) => [e.path, e]));
  const diffPaths = new Set(diffByPath.keys());
  const all = snapshot.filter((e) => e.path !== rootType);
  const byPath = new Map(all.map((e) => [e.path, e]));
  const requiredTopLevel = new Set(['status', 'type', 'entry', 'code', 'effective[x]', 'value[x]']);
  const hiddenObservationKeys = new Set(['category', 'issued', 'interpretation', 'bodySite', 'method']);

  const isHidden = (e: El) => rootType === 'Observation' && hiddenObservationKeys.has(localName(e.path));
  const topLevel = (e: El) => depthFromRoot(e.path) === 1;
  const hasProjectBinding = (e: El) => e.binding?.valueSet?.startsWith('https://cycle.fhir.me/');
  const constrainedInDifferential = (e: El) => {
    const d = diffByPath.get(e.path);
    if (!d) return false;
    return Boolean(
      d.mustSupport
      || d.min != null
      || d.max != null
      || d.short
      || d.definition
      || d.type?.length
      || fixedValue(d)
      || hasProjectBinding(d),
    );
  };

  const addAncestors = (paths: Set<string>) => {
    for (const path of Array.from(paths)) {
      const parts = path.split('.');
      while (parts.length > 2) {
        parts.pop();
        const parent = parts.join('.');
        if (parent !== rootType && byPath.has(parent)) paths.add(parent);
      }
    }
  };

  const localize = (e: El) => {
    const d = diffByPath.get(e.path);
    if (!d) return e;
    return {
      ...e,
      short: d.short ?? e.short,
      definition: d.definition ?? e.definition,
      // Comments inherit selectively: show the differential comment when the
      // profile restates one, otherwise fall back to the resolved snapshot comment
      // only where an IG ancestor authored it. This carries IG guidance to derived
      // profiles while suppressing generic base-FHIR background comments.
      comment: d.comment ?? (inheritedCommentPaths.has(e.path) ? e.comment : undefined),
      constraint: d.constraint,
    };
  };

  const keyPaths = new Set(all
    .filter((e) => !isHidden(e))
    .filter((e) => {
      if (constrainedInDifferential(e)) return true;
      if (topLevel(e) && e.mustSupport) return true;
      if (topLevel(e) && fixedValue(e)) return true;
      if (topLevel(e) && (e.min ?? 0) > 0 && requiredTopLevel.has(localName(e.path))) return true;
      return false;
    })
    .map((e) => e.path));
  addAncestors(keyPaths);

  const differentialPaths = new Set([...diffPaths].filter((path) => byPath.has(path)));
  addAncestors(differentialPaths);

  return {
    key: all.filter((e) => keyPaths.has(e.path)).map(localize),
    differential: all.filter((e) => differentialPaths.has(e.path)).map(localize),
    snapshot: all,
  };
}

export function ElementTable({ elements, resolve }: { elements: El[]; resolve: ResolveType }) {
  if (!elements.length) return <p className="muted">No elements.</p>;
  return (
    <div className="el-list" role="table" aria-label="Elements">
      <div className="el-list-head" role="row">
        <span>Element · cardinality · type</span>
        <button
          type="button"
          className="el-toggle-all"
          data-toggle-all="details.el"
          data-toggle-scope=".el-list"
          data-label-collapsed="Expand all details"
          data-label-expanded="Collapse all details"
        >
          Expand all details
        </button>
      </div>
      {elements.map((e) => <ElementRow key={e.id || e.path} e={e} resolve={resolve} />)}
    </div>
  );
}
