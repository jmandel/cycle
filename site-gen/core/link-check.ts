/**
 * core/link-check.ts — GENERIC internal-link checker for the emitted static site.
 * Scans href/src/srcset; treats http(s)/mailto/tel/#/data/absolute as out of scope;
 * rejects javascript: links; honors a project-supplied externalLinks predicate for
 * artifacts injected by a later build step. Fails-loud is the caller's job.
 */
import { readFileSync, existsSync } from 'node:fs';
import { posix as path } from 'node:path';

/** Candidate internal refs from href / src / srcset. */
export function collectLocalRefs(html: string): string[] {
  const searchable = html.replace(/<!--[\s\S]*?-->/g, '');
  const refs = [...searchable.matchAll(/\b(?:href|src)=["']([^"']+)["']/g)].map((m) => m[1]);
  for (const m of searchable.matchAll(/\bsrcset=["']([^"']+)["']/g)) {
    for (const candidate of m[1].split(',')) {
      const url = candidate.trim().split(/\s+/)[0];
      if (url) refs.push(url);
    }
  }
  return refs;
}

/** Returns broken/forbidden internal links across `files` (relative to outDir). */
export function checkInternalLinks(args: {
  outDir: string;
  emitted: Set<string>;
  files: Iterable<string>;
  isExternalLink: (href: string) => boolean;
}): string[] {
  const broken: string[] = [];
  for (const file of args.files) {
    const html = readFileSync(`${args.outDir}/${file}`, 'utf8');
    for (const h of collectLocalRefs(html)) {
      if (/^\s*javascript:/i.test(h)) { broken.push(`${file} → ${h} (forbidden javascript: link)`); continue; }
      if (/^(?:[a-z][a-z0-9+.-]*:|#|\/)/i.test(h)) continue;
      const target = h.split('#')[0].split('?')[0];
      if (!target) continue;
      const resolved = path.normalize(path.join(path.dirname(file), target));
      if (args.isExternalLink(h) || args.isExternalLink(resolved)) continue; // injected by a later build step (config-declared)
      if (resolved.startsWith('../')) { broken.push(`${file} → ${h} (escapes output directory)`); continue; }
      if (!args.emitted.has(resolved) && !existsSync(`${args.outDir}/${resolved}`)) broken.push(`${file} → ${h}`);
    }
  }
  return broken;
}
