import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

/** Badge — compact status / label pill. */
const TONES = {
  neutral:    { color: 'var(--ink-700)',         tint: 'var(--paper-sunken)',     solid: 'var(--ink-700)' },
  menstrual:  { color: 'var(--menstrual-deep)',  tint: 'var(--menstrual-tint)',   solid: 'var(--menstrual)' },
  follicular: { color: 'var(--follicular-deep)', tint: 'var(--follicular-tint)',  solid: 'var(--follicular)' },
  ovulatory:  { color: 'var(--ovulatory-deep)',  tint: 'var(--ovulatory-tint)',   solid: 'var(--ovulatory)' },
  luteal:     { color: 'var(--luteal-deep)',     tint: 'var(--luteal-tint)',      solid: 'var(--luteal)' },
  success:    { color: 'var(--ovulatory-deep)',  tint: 'var(--ovulatory-tint)',   solid: 'var(--ovulatory)' },
  warning:    { color: 'var(--follicular-deep)', tint: 'var(--follicular-tint)',  solid: 'var(--follicular)' },
  danger:     { color: 'var(--menstrual-deep)',  tint: 'var(--menstrual-tint)',   solid: 'var(--menstrual)' },
  info:       { color: 'var(--luteal-deep)',     tint: 'var(--luteal-tint)',      solid: 'var(--luteal)' },
} as const;

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  children: ReactNode;
  tone?: keyof typeof TONES;
  variant?: 'soft' | 'solid' | 'outline';
  icon?: IconName;
  style?: CSSProperties;
};

export function Badge({ children, tone = 'neutral', variant = 'soft', icon, style, ...rest }: BadgeProps) {
  const t = TONES[tone];
  const skin =
    variant === 'solid'
      ? { background: t.solid, color: '#fff', border: '1px solid transparent' }
      : variant === 'outline'
      ? { background: 'transparent', color: t.color, border: `1px solid ${t.solid}` }
      : { background: t.tint, color: t.color, border: '1px solid transparent' };
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '4px',
        height: '22px', padding: '0 9px',
        fontFamily: 'var(--font-body)', fontSize: 'var(--text-xs)',
        fontWeight: 'var(--weight-semibold)', letterSpacing: '0.01em',
        borderRadius: 'var(--radius-full)', whiteSpace: 'nowrap',
        ...skin, ...style,
      }}
      {...rest}
    >
      {icon && <Icon name={icon} size={13} strokeWidth={2.5} />}
      {children}
    </span>
  );
}
