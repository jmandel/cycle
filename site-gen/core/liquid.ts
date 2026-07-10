/**
 * core/liquid.ts — GENERIC safe Liquid layer (knows nothing FHIR- or
 * project-specific). LiquidJS with strict filters and NO filesystem includes:
 * `{% include NAME %}` resolves through the injected registry or through a
 * previously-ingested DB asset. Unknown includes throw (fail loud, never silent
 * passthrough).
 */
import { Liquid } from 'liquidjs';

export type IncludeParams = Record<string, string>;
export type IncludeRegistry = Record<string, (ig: any, params: IncludeParams) => string>;
export type SqlExecutor = (query: string) => Record<string, any>[];
type SqlColumn = { source?: string; name?: string; title?: string; type?: string; target?: string; system?: string; display?: string; version?: string; width?: string; minWidth?: string };
type SqlColumnStats = {
  codeOnly: boolean;
  hasCode: boolean;
  maxCodeChars: number;
  maxChars: number;
  avgChars: number;
  weight: number;
};

function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function inlineMarkdown(s: unknown): string {
  return esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');
}

function assertSafeSelect(query: string): string {
  const normalized = query.trim();
  if (!normalized) throw new Error('Empty SQL block');
  if (normalized.includes(';')) throw new Error('SQL blocks must contain one SELECT/WITH query without semicolons');
  if (!/^(select|with)\b/i.test(normalized)) throw new Error('SQL blocks may only run SELECT/WITH queries');
  if (/\b(attach|detach|pragma|insert|update|delete|drop|alter|create|replace|vacuum)\b/i.test(normalized)) {
    throw new Error('SQL block contains a disallowed statement keyword');
  }
  return normalized;
}

function columnHintLooksLikeCode(column: string): boolean {
  return /\b(code|system|url|uri|canonical|id|json|value|pattern)\b/i.test(column);
}

function valueLooksLikeCode(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value !== 'string' && typeof value !== 'number') return false;
  const s = String(value).trim();
  if (!s || /\s/.test(s)) return false;
  return /^(https?:\/\/|urn:|[A-Za-z][A-Za-z0-9+.-]*:\/\/)/.test(s) || /[#/{}_.:-]|\d/.test(s);
}

function markdownCodeTokens(value: unknown): string[] {
  const tokens: string[] = [];
  const s = String(value ?? '');
  s.replace(/`([^`]+)`/g, (_m, token) => {
    tokens.push(token);
    return '';
  });
  return tokens;
}

function safeCssSize(value: string | undefined): string | undefined {
  const s = String(value || '').trim();
  return /^[-\w\s.%(),]+$/.test(s) ? s : undefined;
}

function columnStats(rows: Record<string, any>[], col: SqlColumn, codeHint: boolean): SqlColumnStats {
  const source = col.source || col.name || '';
  const values = rows.map((row) => row[source]).filter((v) => v != null && String(v).trim() !== '');
  const chars = values.map((v) => String(v).trim().length);
  const codeTokens = values.flatMap((v) => markdownCodeTokens(v));
  const valueCodeOnly = values.length > 0 && values.every(valueLooksLikeCode);
  const codeOnly = codeHint || valueCodeOnly;
  const hasCode = codeOnly || codeTokens.length > 0;
  const maxChars = Math.max(...chars, 0);
  const avgChars = chars.length ? chars.reduce((a, b) => a + b, 0) / chars.length : 0;
  const maxCodeChars = Math.max(...codeTokens.map((s) => s.length), ...(codeOnly ? chars : []), 0);
  const weight = codeOnly
    ? Math.min(Math.max(maxCodeChars + 2, 8), 26)
    : Math.min(Math.max(Math.sqrt(Math.max(avgChars, 12)) * 4, hasCode ? 18 : 14), 44);
  return { codeOnly, hasCode, maxCodeChars, maxChars, avgChars, weight };
}

function columnClass(stats: SqlColumnStats): string {
  if (stats.codeOnly) return 'code-col sql-code-col';
  if (stats.hasCode) return 'sql-mixed-code-col';
  return 'sql-prose-col';
}

function renderSqlTable(rows: Record<string, any>[], control: { class?: string; titles?: boolean; columns?: SqlColumn[] } = {}): string {
  if (!rows.length) return '<p class="muted">No rows.</p>';
  const columns: SqlColumn[] = control.columns?.length
    ? control.columns
    : Object.keys(rows[0]).map((name) => ({ source: name, name, title: name, type: 'auto' }));
  const stats = columns.map((col) => {
    const label = col.title || col.name || col.source || '';
    return columnStats(rows, col, columnHintLooksLikeCode(label));
  });
  const totalWeight = stats.reduce((sum, s) => sum + s.weight, 0) || 1;
  const colgroup = `<colgroup>${columns.map((col, i) => {
    const width = safeCssSize(col.width) || `${Math.round((stats[i].weight / totalWeight) * 1000) / 10}%`;
    const minWidth = safeCssSize(col.minWidth);
    const style = `width:${width};${minWidth ? `min-width:${minWidth};` : ''}`;
    return `<col class="${columnClass(stats[i])}" style="${style}">`;
  }).join('')}</colgroup>`;
  const tableClass = `cycle-table sql-table sql-table--balanced${control.class ? ` ${esc(control.class)}` : ''}`;
  const head = control.titles === false ? '' : `<thead><tr>${columns.map((c, i) => {
    const label = c.title || c.name || c.source || '';
    return `<th class="${columnClass(stats[i])}">${esc(label)}</th>`;
  }).join('')}</tr></thead>`;
  const renderCell = (row: Record<string, any>, col: SqlColumn, isCodeColumn: boolean) => {
    const source = col.source || col.name || '';
    const value = row[source];
    const type = col.type || 'auto';
    if ((type === 'link' || type === 'url' || type === 'canonical') && value != null) {
      const href = row[col.target || source] ?? value;
      return `<a href="${esc(href)}">${esc(value)}</a>`;
    }
    if (type === 'coding') {
      const system = col.system ? (row[col.system] ?? col.system) : undefined;
      const display = col.display ? (row[col.display] ?? col.display) : undefined;
      return `<span class="sql-coding">${system ? `<span>${esc(system)}</span> ` : ''}<code>${esc(value)}</code>${display ? ` <span>${esc(display)}</span>` : ''}</span>`;
    }
    if (type === 'markdown' || type === 'inlineMarkdown') return inlineMarkdown(value);
    return isCodeColumn ? `<code>${esc(value)}</code>` : esc(value);
  };
  const body = rows.map((row) => {
    const cells = columns.map((c, i) => {
      return `<td class="${columnClass(stats[i])}">${renderCell(row, c, stats[i].codeOnly)}</td>`;
    }).join('');
    return `<tr>${cells}</tr>`;
  }).join('');
  return `<div class="table-scroll"><table class="${tableClass}">${colgroup}${head}<tbody>${body}</tbody></table></div>`;
}

function renderSqlResult(rows: Record<string, any>[], control: { class?: string; titles?: boolean; columns?: SqlColumn[] } = {}): string {
  const keys = Object.keys(rows[0] || {});
  if (rows.length === 1 && keys.length === 1 && !control.columns?.length) return esc(rows[0][keys[0]]);
  return renderSqlTable(rows, control);
}

function runSqlDirective(args: string, runSql?: SqlExecutor): string {
  if (!runSql) throw new Error('SQL tag used, but no SQL executor was provided');
  const trimmed = args.trim();
  if (!trimmed) throw new Error('Empty SQL tag');
  if (trimmed.startsWith('{')) {
    const control = JSON.parse(trimmed);
    if (!control.query) throw new Error('SQL JSON control must include query');
    return renderSqlResult(runSql(assertSafeSelect(control.query)), control);
  }
  return renderSqlResult(runSql(assertSafeSelect(trimmed)));
}

function renderSqlToData(src: string, runSql: SqlExecutor | undefined, data: Record<string, any>): string {
  return src.replace(/{%-?\s*sqlToData\s+([A-Za-z_][A-Za-z0-9_]*)\s+([\s\S]*?)\s*-?%\}/gi, (_m, name, query) => {
    if (!runSql) throw new Error('sqlToData tag used, but no SQL executor was provided');
    data[name] = runSql(assertSafeSelect(query));
    return '';
  });
}

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

export function renderLiquid(src: string, opts: { includes: IncludeRegistry; ig: any; siteData?: Record<string, any>; assetInclude?: (name: string) => string | null; sql?: SqlExecutor; fragment?: (args: string) => string }): string {
  const sqlData: Record<string, any> = {};
  let withSql = renderSqlToData(src, opts.sql, sqlData);
  withSql = withSql.replace(/{%-?\s*sql\s+([\s\S]*?)\s*-?%\}/gi, (_m, args) => runSqlDirective(args, opts.sql));
  const engine = new Liquid({ strictFilters: true, strictVariables: false, extname: '' });
  const renderContext = { ...sqlData, site: { data: opts.siteData || { fhir: { ig: opts.ig } } } };
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
  const rendered = engine.parseAndRenderSync(withSql, renderContext);
  // The Java Publisher evaluates {% fragment %} even when authors wrap it in
  // {% raw %} to protect literal handlebars inside the generated JSON. LiquidJS
  // correctly preserves raw blocks, so run one final fragment pass over the
  // rendered text to match the Publisher authoring pattern.
  return rendered.replace(/{%-?\s*fragment\s+([\s\S]*?)\s*-?%\}/g, (_m: string, args: string) => {
    if (!opts.fragment) throw new Error('fragment tag used, but no fragment renderer was provided');
    return opts.fragment(args);
  });
}
