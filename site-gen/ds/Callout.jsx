import React from 'react';
import { Icon } from './Icon';

/**
 * Callout — admonition. Marks normative vs informative EXPLICITLY
 * (worded label, not just color). variant: note|tip|warning|danger|
 * example|normative|informative
 */
const VARIANTS = {
  note:        { label: 'Note',        icon: 'info',      accent: 'var(--luteal)',     tint: 'var(--luteal-tint)',     deep: 'var(--luteal-deep)' },
  tip:         { label: 'Tip',         icon: 'lightbulb', accent: 'var(--ovulatory)',  tint: 'var(--ovulatory-tint)',  deep: 'var(--ovulatory-deep)' },
  warning:     { label: 'Warning',     icon: 'warning',   accent: 'var(--follicular)', tint: 'var(--follicular-tint)', deep: 'var(--follicular-deep)' },
  danger:      { label: 'Important',   icon: 'alert',     accent: 'var(--menstrual)',  tint: 'var(--menstrual-tint)',  deep: 'var(--menstrual-deep)' },
  example:     { label: 'Example',     icon: 'flask',     accent: 'var(--ink-500)',    tint: 'var(--paper-sunken)',    deep: 'var(--ink-700)' },
  normative:   { label: 'Normative',   icon: 'check',     accent: 'var(--menstrual)',  tint: 'var(--menstrual-tint)',  deep: 'var(--menstrual-deep)' },
  informative: { label: 'Informative', icon: 'bookOpen',  accent: 'var(--ink-300)',    tint: 'var(--paper-sunken)',    deep: 'var(--ink-500)' },
};

export function Callout({ variant = 'note', title, children, style, ...rest }) {
  const v = VARIANTS[variant] || VARIANTS.note;
  const showHead = title || variant === 'normative' || variant === 'informative';
  return (
    <div
      role="note"
      style={{
        position: 'relative', display: 'flex', gap: '12px',
        padding: '14px 16px 14px 15px', background: v.tint,
        borderRadius: 'var(--radius-md)', borderLeft: `3px solid ${v.accent}`,
        ...style,
      }}
      {...rest}
    >
      <div style={{ color: v.accent, marginTop: '1px' }}>
        <Icon name={v.icon} size={19} strokeWidth={2.25} />
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: showHead ? '4px' : 0 }}>
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)',
            fontWeight: 'var(--weight-semibold)', letterSpacing: 'var(--tracking-eyebrow)',
            textTransform: 'uppercase', color: v.deep,
          }}>{v.label}</span>
          {title && (
            <span style={{ fontFamily: 'var(--font-body)', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--ink-900)' }}>{title}</span>
          )}
        </div>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 'var(--text-sm)', lineHeight: 'var(--leading-normal)', color: 'var(--ink-700)' }}>
          {children}
        </div>
      </div>
    </div>
  );
}
