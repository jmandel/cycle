import React from 'react';

/** Tag — monospace label for FHIR paths, resource types, codes. */
export function Tag({ children, tone = 'neutral', href, style, ...rest }) {
  const tones = {
    neutral:   'var(--ink-700)',
    menstrual: 'var(--menstrual-deep)',
    ovulatory: 'var(--ovulatory-deep)',
    luteal:    'var(--luteal-deep)',
    follicular:'var(--follicular-deep)',
  };
  const css = {
    display: 'inline-flex', alignItems: 'center',
    padding: '1px 6px', borderRadius: 'var(--radius-xs)',
    background: 'var(--paper-sunken)', border: 'var(--border-hair)',
    fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)',
    fontWeight: 500, color: tones[tone] || tones.neutral,
    letterSpacing: '-0.01em', whiteSpace: 'nowrap', textDecoration: 'none',
    ...style,
  };
  if (href) return <a href={href} style={css} {...rest}>{children}</a>;
  return <code style={css} {...rest}>{children}</code>;
}
