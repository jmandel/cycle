import React from 'react';
import { Badge } from '../ds/Badge';
import { Tag } from '../ds/Tag';

export function Eyebrow({ children, color }: { children: React.ReactNode; color?: string }) {
  return <div className="eyebrow" style={color ? { color } : undefined}>{children}</div>;
}

/** A section h2 with a durable, copyable deep-link anchor (links to its section id). */
export function SectionHeading({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 className="sec">
      {children}
      <a className="heading-anchor" href={`#${id}`} aria-label="Copy link to this section" />
    </h2>
  );
}

export function MetadataGrid({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <div className="kv">
      {rows.map(([k, v]) => (
        <div className="kv-row" key={k}><span className="kv-k">{k}</span><span className="kv-v">{v}</span></div>
      ))}
    </div>
  );
}

/** Shared artifact-page header: eyebrow · title · badges · lead · metadata grid. */
export function PageHeader({
  eyebrow, eyebrowColor, title, badges, lead, meta,
}: {
  eyebrow: React.ReactNode; eyebrowColor?: string; title: string;
  badges?: React.ReactNode; lead?: React.ReactNode; meta?: [string, React.ReactNode][];
}) {
  return (
    <section id="overview">
      <Eyebrow color={eyebrowColor}>{eyebrow}</Eyebrow>
      <h1 className="page-title">{title}</h1>
      {badges && <div className="badge-row">{badges}</div>}
      {lead && <p className="lead">{lead}</p>}
      {meta && meta.length > 0 && <MetadataGrid rows={meta} />}
    </section>
  );
}

export function StatusBadge({ status }: { status?: string }) {
  const s = status || 'draft';
  return <Badge tone="follicular" variant="soft">{s[0].toUpperCase() + s.slice(1)}</Badge>;
}

export { Tag };
