import type { ReactNode } from 'react';
import { Icon } from './Icon';

interface CopyValueProps {
  value: unknown;
  label?: string;
  className?: string;
  truncate?: 'middle';
}

/** CopyValue — long canonical IDs/URLs that must remain visible and easy to copy. */
export function CopyValue({ value, label = 'value', className = '', truncate }: CopyValueProps) {
  const text = value == null ? '' : String(value);
  // Middle-truncate keeps the head and the full final path segment (the id)
  // on one line, ellipsing only the middle when the box is too narrow.
  // The complete text stays in the DOM, so copy + hover still see the whole URL.
  const code = truncate === 'middle' ? middleTruncate(text) : text;
  return (
    <span className={`copy-value${className ? ` ${className}` : ''}`}>
      <code className={`copy-value-code${truncate === 'middle' ? ' copy-value-code--midtrunc' : ''}`} title={truncate === 'middle' ? text : undefined}>
        {code}
      </code>
      <button type="button" className="copy-value-button" data-copy-value aria-label={`Copy ${label}`} title={`Copy ${label}`}>
        <Icon name="copy" size={13} strokeWidth={2.25} />
      </button>
    </span>
  );
}

/** Split a path-like string at its last "/" so the head can ellipse and the
 *  final segment (resource id) always stays fully visible. */
function middleTruncate(text: string): ReactNode {
  const cut = text.lastIndexOf('/');
  if (cut <= 0 || cut === text.length - 1) return text;
  const head = text.slice(0, cut);
  const tail = text.slice(cut); // includes the leading "/"
  return (
    <>
      <span className="cv-head">{head}</span>
      <span className="cv-tail">{tail}</span>
    </>
  );
}
