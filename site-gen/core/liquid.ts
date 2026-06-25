/**
 * core/liquid.ts — GENERIC safe Liquid layer (knows nothing FHIR- or
 * project-specific). LiquidJS with strict filters and NO filesystem includes:
 * `{% include NAME %}` resolves only through the injected registry, and an
 * unknown include throws (fail loud, never silent passthrough).
 */
import { Liquid } from 'liquidjs';

export type IncludeRegistry = Record<string, (ig: any) => string>;

export function renderLiquid(src: string, opts: { includes: IncludeRegistry; ig: any }): string {
  const engine = new Liquid({ strictFilters: true, strictVariables: false, extname: '' });
  engine.registerTag('include', {
    parse(token: any) { this.name = token.args.trim().replace(/^['"]|['"]$/g, ''); },
    *render() {
      const gen = opts.includes[this.name];
      if (!gen) throw new Error(`Unknown include '${this.name}' — register it in project/includes.ts before use.`);
      return gen(opts.ig);
    },
  });
  return engine.parseAndRenderSync(src, { site: { data: { fhir: { ig: opts.ig } } } });
}
