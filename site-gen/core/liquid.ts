/**
 * core/liquid.ts — GENERIC safe Liquid layer (knows nothing FHIR- or
 * project-specific). LiquidJS with strict filters and NO filesystem includes:
 * `{% include NAME %}` resolves through the injected registry or through a
 * an authored text asset in the closed SiteBuild. Unknown includes throw (fail
 * loud, never silent passthrough).
 */
import { Liquid } from 'liquidjs';

export type IncludeParams = Record<string, string>;
export type IncludeRegistry = Record<string, (ig: any, params: IncludeParams) => string>;

function stripQuotes(s: string): string {
  return s.trim().replace(/^(['"])([\s\S]*)\1$/, '$2');
}

function parseIncludeArgs(args: string): { name: string; params: IncludeParams } {
  const trimmed = args.trim();
  const first = trimmed.match(/^("[^"]+"|'[^']+'|\S+)([\s\S]*)$/);
  if (!first) throw new Error('Empty include tag');
  const name = stripQuotes(first[1]);
  const rest = first[2] || '';
  const params: IncludeParams = {};
  const attrRe = /([A-Za-z_][\w-]*)\s*=\s*("[^"]*"|'[^']*'|[^\s]+)/g;
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(rest))) params[m[1]] = stripQuotes(m[2]);
  return { name, params };
}

export function renderLiquid(src: string, opts: { includes: IncludeRegistry; ig: any; siteData?: Record<string, any>; assetInclude?: (name: string) => string | null; fragment?: (args: string) => string }): string {
  const engine = new Liquid({ strictFilters: true, strictVariables: false, extname: '' });
  const renderContext = { site: { data: opts.siteData || { fhir: { ig: opts.ig } } } };
  const registerNamedFragmentTag = (tagName: string) => engine.registerTag(tagName, {
    parse(token: any) {
      const parsed = parseIncludeArgs(token.args);
      this.name = parsed.name;
      this.params = parsed.params;
    },
    *render() {
      const gen = opts.includes[this.name];
      if (gen) return gen(opts.ig, this.params || {});
      const asset = opts.assetInclude?.(this.name);
      if (asset != null) return engine.parseAndRenderSync(asset, { ...renderContext, include: this.params || {} });
      throw new Error(`Unknown include '${this.name}' — register it in project/includes.ts or ingest a same-named asset before use.`);
    },
  });
  registerNamedFragmentTag('include');
  registerNamedFragmentTag('lang-fragment');
  engine.registerTag('fragment', {
    parse(token: any) {
      this.args = token.args || '';
    },
    *render() {
      if (!opts.fragment) throw new Error('fragment tag used, but no fragment renderer was provided');
      return opts.fragment(this.args);
    },
  });
  const rendered = engine.parseAndRenderSync(src, renderContext);
  // The Java Publisher evaluates {% fragment %} even when authors wrap it in
  // {% raw %} to protect literal handlebars inside the generated JSON. LiquidJS
  // correctly preserves raw blocks, so run one final fragment pass over the
  // rendered text to match the Publisher authoring pattern.
  return rendered.replace(/{%-?\s*fragment\s+([\s\S]*?)\s*-?%\}/g, (_m: string, args: string) => {
    if (!opts.fragment) throw new Error('fragment tag used, but no fragment renderer was provided');
    return opts.fragment(args);
  });
}
