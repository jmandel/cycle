/** Locale-independent text order shared by Bun and browsers. */
export function compareText(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}
