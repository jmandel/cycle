import React from 'react';
import { Icon } from '../ds/Icon.jsx';

/**
 * MachineFormats — "HTML is a view; the JSON is the truth." A light, compact set
 * of links to an artifact's machine representations. The format name is the label;
 * the full filename is the href/title (no overflowing path in the rail).
 */
export function MachineFormats({ base, formats = ['json'] }: { base: string; formats?: string[] }) {
  const labels: Record<string, string> = { json: 'JSON', xml: 'XML', ttl: 'Turtle' };
  return (
    <div className="machine">
      <div className="machine-title">Machine formats</div>
      <div className="machine-links">
        {formats.map((f) => (
          <a key={f} className="machine-link" href={`${base}.${f}`} title={`${base}.${f}`}>
            <Icon name="layers" size={13} strokeWidth={2} />{labels[f] || f.toUpperCase()}
          </a>
        ))}
      </div>
    </div>
  );
}
