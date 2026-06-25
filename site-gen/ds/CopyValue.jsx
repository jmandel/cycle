import React from 'react';
import { Icon } from './Icon.jsx';

/** CopyValue — long canonical IDs/URLs that must remain visible and easy to copy. */
export function CopyValue({ value, label = 'value' }) {
  const text = value == null ? '' : String(value);
  return (
    <span className="copy-value">
      <code className="copy-value-code">{text}</code>
      <button type="button" className="copy-value-button" data-copy-value aria-label={`Copy ${label}`}>
        <Icon name="copy" size={13} strokeWidth={2.25} />
        <span data-copy-label>Copy</span>
      </button>
    </span>
  );
}
