/**
 * config.ts — link-classification helper. The project's externalLinks list lives
 * in project/cycle.ts (the visible project contract); this just compiles it into
 * a matcher the link checker uses for artifacts injected by a later build step.
 */
import { project } from './project/cycle';

const toRegex = (glob: string) =>
  new RegExp('^' + glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
const matchers = project.externalLinks.map(toRegex);

/** True if an href is satisfied by an externally-provided artifact (project-declared). */
export function isExternalLink(href: string): boolean {
  const target = href.split('#')[0];
  return matchers.some((m) => m.test(target));
}
