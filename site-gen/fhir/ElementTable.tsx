import React from 'react';
import { Cardinality } from '../ds/Cardinality.jsx';
import { Tag } from '../ds/Tag.jsx';
import { Badge } from '../ds/Badge.jsx';

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

function fixedValue(e: El): { label: string; value: string } | null {
  for (const k of Object.keys(e)) {
    if (k.startsWith('fixed') || k.startsWith('pattern')) {
      const v = (e as any)[k];
      if (v == null) continue;
      const s = typeof v === 'object' ? (v.code || v.coding?.[0]?.code || v.text || JSON.stringify(v)) : String(v);
      return { label: k.startsWith('fixed') ? 'fixed' : 'pattern', value: s };
    }
  }
  return null;
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
  const parts = e.path.split('.');
  const depth = parts.length - 1;
  let name = parts[parts.length - 1];
  if (e.sliceName) name = `${name}:${e.sliceName}`;
  const fixed = fixedValue(e);
  const constraints = (e.constraint || []).filter((c: any) => c.human);
  const hasDeep = (e.definition && e.definition !== e.short) || e.comment || constraints.length > 0;
  const indent = { paddingLeft: 14 + Math.max(0, depth - 1) * 18 };

  const head = (
    <div className="el-head">
      <code className="el-name" id={e.path}>{name}</code>
      <Cardinality min={e.min ?? 0} max={e.max ?? '*'} mustSupport={e.mustSupport} modifier={e.isModifier} summary={e.isSummary} />
      <TypeRefs types={e.type} resolve={resolve} />
    </div>
  );
  const body = (e.short || fixed || e.binding) && (
    <div className="el-body">
      {(fixed || e.binding) && (
        <span className="el-marks">
          {fixed && <Badge tone="menstrual" variant="soft">{fixed.label}: {fixed.value}</Badge>}
          {e.binding?.valueSet && (
            <Badge tone="ovulatory" variant="outline">
              <a href={resolve('ValueSet', e.binding.valueSet)} style={{ color: 'inherit', textDecoration: 'none' }}>binding: {e.binding.strength}</a>
            </Badge>
          )}
        </span>
      )}
      {e.short && <span className="el-short">{e.short}</span>}
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
      <summary>{head}{body}</summary>
      {deep}
    </details>
  );
}

/** Pre-compute the three element views from a StructureDefinition. */
export function elementViews(snapshot: El[] = [], differential: El[] = [], rootType = '') {
  const diffPaths = new Set(differential.map((e) => e.path));
  const all = snapshot.filter((e) => e.path !== rootType);
  return {
    key: all.filter((e) => diffPaths.has(e.path) || e.mustSupport || (e.min ?? 0) > 0),
    differential: all.filter((e) => diffPaths.has(e.path)),
    snapshot: all,
  };
}

export function ElementTable({ elements, resolve }: { elements: El[]; resolve: ResolveType }) {
  if (!elements.length) return <p className="muted">No elements.</p>;
  return (
    <div className="el-list" role="table" aria-label="Elements">
      <div className="el-list-head" role="row"><span>Element · cardinality · type</span></div>
      {elements.map((e) => <ElementRow key={e.id || e.path} e={e} resolve={resolve} />)}
    </div>
  );
}
