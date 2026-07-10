const utf8 = new TextEncoder();

/**
 * Rust-compatible UTF-8 byte order shared by Bun and browsers.
 *
 * JavaScript's relational string comparison uses UTF-16 code units. That
 * differs from Rust `String::cmp` for some non-BMP text, so it is not suitable
 * for a cross-runtime content-addressed contract.
 */
export function compareUtf8(left: string, right: string): number {
  if (left === right) return 0;
  const a = utf8.encode(left);
  const b = utf8.encode(right);
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index++) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

/** Canonical locale-independent text order used throughout the renderer. */
export const compareText = compareUtf8;
