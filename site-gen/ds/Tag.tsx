import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';

const TONES = {
  neutral: 'var(--ink-700)',
  menstrual: 'var(--menstrual-deep)',
  ovulatory: 'var(--ovulatory-deep)',
  luteal: 'var(--luteal-deep)',
  follicular: 'var(--follicular-deep)',
} as const;

type TagProps = HTMLAttributes<HTMLElement> & {
  children: ReactNode;
  tone?: keyof typeof TONES;
  href?: string;
  style?: CSSProperties;
};

/** Tag — monospace label for FHIR paths, resource types, codes. */
export function Tag({ children, tone = 'neutral', href, style, ...rest }: TagProps) {
  const css: CSSProperties = {
    display: 'inline-flex', alignItems: 'center',
    padding: '1px 6px', borderRadius: 'var(--radius-xs)',
    background: 'var(--paper-sunken)', border: 'var(--border-hair)',
    fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)',
    fontWeight: 500, color: TONES[tone],
    letterSpacing: '-0.01em', whiteSpace: 'nowrap', textDecoration: 'none',
    ...style,
  };
  if (href) return <a href={href} style={css} {...rest}>{children}</a>;
  return <code style={css} {...rest}>{children}</code>;
}
