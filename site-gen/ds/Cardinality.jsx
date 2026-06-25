import React from 'react';

/**
 * Cardinality — FHIR element cardinality + conformance flags, rendered
 * EXPLICITLY (each flag carries a worded title — never color/glyph alone).
 */
export function Cardinality({ min = 0, max = '1', mustSupport, modifier, summary, style, ...rest }) {
  const required = min >= 1;
  const card = `${min}..${max}`;
  const flag = (txt, label, color) => (
    <abbr
      title={label}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        minWidth: '18px', height: '18px', padding: '0 4px',
        borderRadius: 'var(--radius-xs)', background: 'var(--paper-sunken)',
        border: 'var(--border-hair)', textDecoration: 'none', cursor: 'help',
        fontFamily: 'var(--font-mono)', fontSize: 'var(--text-2xs)',
        fontWeight: 'var(--weight-bold)', color, lineHeight: 1,
      }}
    >
      {txt}
    </abbr>
  );
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', ...style }} {...rest}>
      <code
        title={required ? 'Required' : 'Optional'}
        style={{
          fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)',
          fontWeight: 'var(--weight-semibold)',
          color: required ? 'var(--fhir-required)' : 'var(--ink-300)',
        }}
      >
        {card}
      </code>
      {mustSupport && flag('S', 'Must Support', 'var(--fhir-mustsupport)')}
      {modifier && flag('?!', 'Modifier element', 'var(--menstrual-deep)')}
      {summary && flag('Σ', 'Included in summary', 'var(--luteal-deep)')}
    </span>
  );
}
