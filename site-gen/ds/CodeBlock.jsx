import React from 'react';
import { Icon } from './Icon.jsx';

/** CodeBlock — dark warm panel for fenced code. Lightweight JSON highlight → phase palette. */
const JSON_RE = /("(?:\\.|[^"\\])*"\s*:)|("(?:\\.|[^"\\])*")|(\b(?:true|false|null)\b)|(-?\d+\.?\d*(?:[eE][+-]?\d+)?)|([{}\[\],])/g;

function tokenizeJson(line, keyPrefix) {
  const out = []; let last = 0, m, i = 0; JSON_RE.lastIndex = 0;
  while ((m = JSON_RE.exec(line)) !== null) {
    if (m.index > last) out.push(<span key={keyPrefix + i++}>{line.slice(last, m.index)}</span>);
    let color = 'var(--code-fg)';
    if (m[1]) color = 'var(--code-type)';
    else if (m[2]) color = 'var(--code-str)';
    else if (m[3] || m[4]) color = 'var(--code-num)';
    else if (m[5]) color = 'var(--code-comment)';
    out.push(<span key={keyPrefix + i++} style={{ color }}>{m[0]}</span>);
    last = m.index + m[0].length;
  }
  if (last < line.length) out.push(<span key={keyPrefix + i++}>{line.slice(last)}</span>);
  return out;
}

function renderLine(line, lang, idx) {
  if (lang === 'json') return tokenizeJson(line, `l${idx}-`);
  if ((lang === 'bash' || lang === 'sh' || lang === 'fsh' || lang === 'text') && line.trimStart().startsWith('#'))
    return <span style={{ color: 'var(--code-comment)' }}>{line}</span>;
  return line === '' ? ' ' : line;
}

export function CodeBlock({ code = '', lang = 'json', filename, showLines = false, copy = true, style, ...rest }) {
  const [copied, setCopied] = React.useState(false);
  const text = typeof code === 'string' ? code.replace(/\n$/, '') : '';
  const lines = text.split('\n');
  const doCopy = () => { try { navigator.clipboard.writeText(text); } catch (e) {} setCopied(true); setTimeout(() => setCopied(false), 1400); };
  return (
    <div style={{ background: 'var(--code-bg)', borderRadius: 'var(--radius-md)', border: '1px solid var(--code-line)', overflow: 'hidden', boxShadow: 'var(--shadow-sm)', ...style }} {...rest}>
      {(filename || copy || lang) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 10px 8px 14px', borderBottom: '1px solid var(--code-line)', background: 'var(--code-bg-2)' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--code-fg)', fontWeight: 500, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{filename || ''}</span>
          {lang && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-2xs)', letterSpacing: 'var(--tracking-eyebrow)', textTransform: 'uppercase', color: 'var(--code-gutter)' }}>{lang}</span>}
          {copy && (
            <button type="button" onClick={doCopy} aria-label="Copy code" style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: 'transparent', border: 'none', cursor: 'pointer', color: copied ? 'var(--code-str)' : 'var(--code-gutter)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-2xs)', padding: '2px 4px' }}>
              <Icon name={copied ? 'check' : 'copy'} size={13} strokeWidth={2.25} />{copied ? 'Copied' : 'Copy'}
            </button>
          )}
        </div>
      )}
      <pre style={{ margin: 0, padding: '14px 16px', overflowX: 'auto', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', lineHeight: 'var(--leading-code)', color: 'var(--code-fg)' }}>
        <code style={{ display: 'block' }}>
          {lines.map((ln, i) => (
            <div key={i} style={{ display: 'flex', whiteSpace: 'pre' }}>
              {showLines && <span style={{ display: 'inline-block', width: '2.4em', marginRight: '1em', textAlign: 'right', color: 'var(--code-gutter)', userSelect: 'none', flex: 'none' }}>{i + 1}</span>}
              <span style={{ flex: 1 }}>{renderLine(ln, lang, i)}</span>
            </div>
          ))}
        </code>
      </pre>
    </div>
  );
}
