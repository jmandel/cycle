import * as fhirpath from 'fhirpath';
import r4Model from 'fhirpath/fhir-context/r4';
import r5Model from 'fhirpath/fhir-context/r5';
import stu3Model from 'fhirpath/fhir-context/stu3';
import { XMLBuilder } from 'fast-xml-parser';

type Json = Record<string, any>;

type FragmentDirective =
  | { kind: 'BASE'; expression: string }
  | { kind: 'EXCEPT'; expression: string; base?: string }
  | { kind: 'ELIDE'; expression: string; base?: string };
type FragmentPlan = {
  base: string | null;
  excepts: { expression: string; base?: string }[];
  elides: string[];
};
type HiddenState = {
  objectKeys: WeakMap<object, Set<string>>;
  arrayIndexes: WeakMap<any[], Set<number>>;
};

export type FragmentResourceResolver = (type: string, id: string) => Json | null;
type FragmentOptions = {
  fhirVersion?: string | null;
};

const xmlBuilder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  format: true,
  suppressEmptyNode: true,
});

function escHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function splitTopLevel(value: string, separator: string): string[] {
  const out: string[] = [];
  let current = '';
  let quote: string | null = null;
  let paren = 0;
  let bracket = 0;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (quote) {
      current += ch;
      if (ch === quote && value[i - 1] !== '\\') quote = null;
      continue;
    }
    if (ch === '\'' || ch === '"' || ch === '`') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '(') paren++;
    else if (ch === ')') paren = Math.max(0, paren - 1);
    else if (ch === '[') bracket++;
    else if (ch === ']') bracket = Math.max(0, bracket - 1);
    if (ch === separator && paren === 0 && bracket === 0) {
      const trimmed = current.trim();
      if (trimmed) out.push(trimmed);
      current = '';
      continue;
    }
    current += ch;
  }
  const trimmed = current.trim();
  if (trimmed) out.push(trimmed);
  return out;
}

function parseDirectives(input: string): FragmentDirective[] {
  const out: FragmentDirective[] = [];
  const marker = /\b(BASE|EXCEPT|ELIDE):/g;
  const matches = [...input.matchAll(marker)];
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const kind = match[1] as FragmentDirective['kind'];
    const start = (match.index || 0) + match[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index || input.length : input.length;
    const expression = input.slice(start, end).trim();
    if (!expression) throw new Error(`Empty ${kind}: directive in fragment tag`);
    out.push({ kind, expression });
  }
  return out;
}

function planFromDirectives(directives: FragmentDirective[]): FragmentPlan {
  let base: string | null = null;
  let currentExcept: { expression: string; base?: string } | null = null;
  const excepts: { expression: string; base?: string }[] = [];
  const elides: string[] = [];
  for (const directive of directives) {
    if (directive.kind === 'BASE') {
      if (currentExcept) {
        if (currentExcept.base) throw new Error(`Cannot have more than one BASE: declaration for EXCEPT:${currentExcept.expression}`);
        currentExcept.base = directive.expression;
      } else {
        if (base) throw new Error('Cannot have more than one top-level BASE: declaration in fragment tag');
        base = directive.expression;
      }
      continue;
    }
    if (directive.kind === 'EXCEPT') {
      currentExcept = { expression: directive.expression };
      excepts.push(currentExcept);
      continue;
    }
    elides.push(directive.expression);
  }
  return { base, excepts, elides };
}

function parseFragmentArgs(args: string): { type: string; id: string; format: 'JSON' | 'XML'; plan: FragmentPlan } {
  const match = args.trim().match(/^([A-Za-z][A-Za-z0-9]*)\/([^\s]+)\s+(JSON|XML)\b([\s\S]*)$/i);
  if (!match) {
    throw new Error(`Unsupported fragment syntax '${args.trim()}'. Expected: Type/id JSON|XML [BASE:/EXCEPT:/ELIDE:]`);
  }
  return {
    type: match[1],
    id: match[2],
    format: match[3].toUpperCase() as 'JSON' | 'XML',
    plan: planFromDirectives(parseDirectives(match[4] || '')),
  };
}

function decodeBase64Utf8(value: string): string | null {
  try {
    const bytes = Uint8Array.from(atob(value), (ch) => ch.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

function binaryPayload(resource: Json): Json {
  const contentType = String(resource.contentType || '').toLowerCase();
  if (!contentType.includes('json') || typeof resource.data !== 'string') return resource;
  const decoded = decodeBase64Utf8(resource.data);
  if (!decoded) return resource;
  try {
    return JSON.parse(decoded);
  } catch {
    return resource;
  }
}

function fragmentPayload(resource: Json): Json {
  return resource.resourceType === 'Binary' ? binaryPayload(resource) : resource;
}

function normalizeFragmentExpression(expression: string): string {
  return expression
    // The Publisher fragment dialect commonly uses descendants().select(item)
    // to mean "all nested Questionnaire.item nodes". fhirpath.js evaluates
    // that expression literally against descendants and misses top-level items,
    // while repeat(item) matches the intended authoring pattern.
    .replace(/\bdescendants\(\)\.select\(\s*item\s*\)/g, 'repeat(item)')
    .replace(/\bselect\(\s*item\s*\)/g, 'item');
}

function fhirPathModelForVersion(fhirVersion: string | null | undefined): Json | undefined {
  if (!fhirVersion) return undefined;
  if (fhirVersion.startsWith('3.0.')) return stu3Model as Json;
  if (fhirVersion.startsWith('4.0.') || fhirVersion.startsWith('4.3.')) return r4Model as Json;
  if (fhirVersion.startsWith('5.') || fhirVersion.startsWith('6.')) return r5Model as Json;
  return undefined;
}

function evalPath(context: unknown, expression: string, model?: Json, resource?: Json): any[] {
  const normalized = normalizeFragmentExpression(expression);
  try {
    return fhirpath.evaluate(context, normalized, resource ? { resource } : {}, model);
  } catch (e) {
    throw new Error(`FHIRPath '${expression}' failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function containsSelected(value: any, selected: Set<any>): boolean {
  if (selected.has(value)) return true;
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((item) => containsSelected(item, selected));
  return Object.values(value).some((child) => containsSelected(child, selected));
}

function hiddenState(): HiddenState {
  return { objectKeys: new WeakMap(), arrayIndexes: new WeakMap() };
}

function hiddenObjectKeys(state: HiddenState, object: object): Set<string> {
  let keys = state.objectKeys.get(object);
  if (!keys) state.objectKeys.set(object, keys = new Set());
  return keys;
}

function hiddenArrayIndexes(state: HiddenState, array: any[]): Set<number> {
  let indexes = state.arrayIndexes.get(array);
  if (!indexes) state.arrayIndexes.set(array, indexes = new Set());
  return indexes;
}

function markImmediateChildrenHidden(base: any, state: HiddenState): void {
  if (!base || typeof base !== 'object') return;
  if (Array.isArray(base)) {
    const indexes = hiddenArrayIndexes(state, base);
    for (let i = 0; i < base.length; i++) indexes.add(i);
    return;
  }
  const keys = hiddenObjectKeys(state, base);
  for (const [key, child] of Object.entries(base)) {
    if (key === 'resourceType') continue;
    if (Array.isArray(child)) {
      const indexes = hiddenArrayIndexes(state, child);
      for (let i = 0; i < child.length; i++) indexes.add(i);
    } else {
      keys.add(key);
    }
  }
}

function unhideSelected(base: any, selectedValues: any[], state: HiddenState): void {
  if (!base || typeof base !== 'object') return;
  const selected = new Set(selectedValues);
  if (Array.isArray(base)) {
    const indexes = hiddenArrayIndexes(state, base);
    for (let i = 0; i < base.length; i++) if (containsSelected(base[i], selected)) indexes.delete(i);
    return;
  }
  const keys = hiddenObjectKeys(state, base);
  for (const [key, child] of Object.entries(base)) {
    if (key === 'resourceType') continue;
    if (selected.has(child)) {
      keys.delete(key);
      continue;
    }
    if (Array.isArray(child)) {
      const indexes = hiddenArrayIndexes(state, child);
      for (let i = 0; i < child.length; i++) if (containsSelected(child[i], selected)) indexes.delete(i);
      continue;
    }
    if (child && typeof child === 'object') {
      if (containsSelected(child, selected)) keys.delete(key);
      continue;
    }
    if (selectedValues.some((selectedValue) => Object.is(selectedValue, child))) keys.delete(key);
  }
}

function markByIdentity(root: any, targets: Set<any>, state: HiddenState): boolean {
  if (!root || typeof root !== 'object') return false;
  if (Array.isArray(root)) {
    let changed = false;
    const indexes = hiddenArrayIndexes(state, root);
    for (let i = 0; i < root.length; i++) {
      if (targets.has(root[i])) {
        indexes.add(i);
        changed = true;
      } else if (markByIdentity(root[i], targets, state)) {
        changed = true;
      }
    }
    return changed;
  }
  let changed = false;
  const keys = hiddenObjectKeys(state, root);
  for (const [key, child] of Object.entries(root)) {
    if (targets.has(child)) {
      keys.add(key);
      changed = true;
    } else if (markByIdentity(child, targets, state)) {
      changed = true;
    }
  }
  return changed;
}

function markSimpleKeyHidden(target: any, key: string, state: HiddenState): boolean {
  if (!target || typeof target !== 'object') return false;
  if (Array.isArray(target)) return target.some((item) => markSimpleKeyHidden(item, key, state));
  if (Object.prototype.hasOwnProperty.call(target, key)) {
    hiddenObjectKeys(state, target).add(key);
    return true;
  }
  return false;
}

function finalizeHidden(value: any, state: HiddenState): any {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    const hidden = state.arrayIndexes.get(value) || new Set<number>();
    const out: any[] = [];
    for (let i = 0; i < value.length; i++) {
      if (hidden.has(i)) continue;
      out.push(finalizeHidden(value[i], state));
    }
    return out;
  }
  const hidden = state.objectKeys.get(value) || new Set<string>();
  const out: Json = {};
  for (const [key, child] of Object.entries(value)) {
    if (hidden.has(key)) continue;
    out[key] = finalizeHidden(child, state);
  }
  return out;
}

function applyExcept(root: Json, fragmentRoots: any[], except: { expression: string; base?: string }, model: Json | undefined, state: HiddenState): void {
  const baseContexts = except.base
    ? fragmentRoots.flatMap((fragmentRoot) => evalPath(fragmentRoot, except.base!, model, root))
    : fragmentRoots;
  if (!baseContexts.length) throw new Error(`Unable to find matching BASE elements for EXCEPT:${except.expression}`);
  for (const context of baseContexts) {
    markImmediateChildrenHidden(context, state);
    const selectedValues: any[] = [];
    for (const expression of splitTopLevel(except.expression, '|')) {
      const selected = evalPath(context, expression, model, root);
      selectedValues.push(...selected);
    }
    if (!selectedValues.length) throw new Error(`Unable to find matching EXCEPT elements for EXCEPT:${except.expression}`);
    unhideSelected(context, selectedValues, state);
  }
}

function applyElide(root: Json, fragmentRoots: any[], expressionList: string, model: Json | undefined, state: HiddenState): void {
  for (const expression of splitTopLevel(expressionList, '|')) {
    for (const context of fragmentRoots) {
      if (/^[A-Za-z_][A-Za-z0-9_-]*$/.test(expression)) {
        markSimpleKeyHidden(context, expression, state);
        continue;
      }
      const selected = evalPath(context, expression, model, root);
      const targets = new Set(selected.filter((value) => value && typeof value === 'object'));
      if (targets.size) markByIdentity(context, targets, state);
      const primitiveValues = selected.filter((value) => !value || typeof value !== 'object');
      for (const primitiveValue of primitiveValues) {
        if (context && typeof context === 'object') {
          for (const [key, child] of Object.entries(context)) {
            if (Object.is(child, primitiveValue)) hiddenObjectKeys(state, context).add(key);
          }
        }
      }
    }
  }
}

function baseRootName(expression: string | null, fallbackType: string): string {
  if (!expression) return fallbackType || 'fragment';
  const select = expression.match(/select\(\s*([A-Za-z_][\w-]*)\s*\)/);
  if (select) return select[1];
  const pieces = expression
    .replace(/\([^)]*\)/g, '')
    .split('.')
    .map((p) => p.replace(/\[[^\]]+\]/g, '').trim())
    .filter(Boolean);
  return pieces.at(-1) || fallbackType || 'fragment';
}

function codeBlock(code: string, lang: string): string {
  return `<pre class="fragment-code"><code class="language-${escHtml(lang)}">${escHtml(code)}</code></pre>`;
}

function jsonFragment(value: unknown[]): string {
  const body = value.length === 1 ? value[0] : value;
  return codeBlock(JSON.stringify(body, null, 2), 'json');
}

function primitiveXml(name: string, value: unknown): Json {
  return { [name]: { '@_value': String(value) } };
}

function jsonElementToXml(name: string, value: any): Json[] {
  if (value == null) return [{ [name]: {} }];
  if (Array.isArray(value)) return value.flatMap((item) => jsonElementToXml(name, item));
  if (typeof value !== 'object') return [primitiveXml(name, value)];
  if (value.resourceType) return [jsonObjectToXml(value.resourceType, value)];
  return [jsonObjectToXml(name, value)];
}

function jsonObjectToXml(name: string, value: Json): Json {
  const node: Json = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === 'resourceType' || key.startsWith('_')) continue;
    if (Array.isArray(child)) {
      for (const wrapped of child.flatMap((item) => jsonElementToXml(key, item))) {
        const childValue = wrapped[key];
        if (node[key] === undefined) node[key] = childValue;
        else node[key] = Array.isArray(node[key]) ? [...node[key], childValue] : [node[key], childValue];
      }
      continue;
    }
    const wrapped = jsonElementToXml(key, child)[0];
    node[key] = wrapped[key];
  }
  return { [name]: node };
}

function xmlFragment(value: unknown[], rootName: string): string {
  const xml = value
    .map((item: any) => {
      const name = item?.resourceType || rootName || 'fragment';
      return xmlBuilder.build(jsonObjectToXml(name, item));
    })
    .join('\n');
  return codeBlock(xml, 'xml');
}

export function renderResourceFragment(args: string, resolveResource: FragmentResourceResolver, options: FragmentOptions = {}): string {
  const parsed = parseFragmentArgs(args);
  const resource = resolveResource(parsed.type, parsed.id);
  if (!resource) throw new Error(`fragment resource not found: ${parsed.type}/${parsed.id}`);
  const working = cloneJson(fragmentPayload(resource));
  const model = fhirPathModelForVersion(options.fhirVersion);
  const base = parsed.plan.base;
  const fragmentRoots = base ? evalPath(working, base, model, working) : [working];
  if (base && fragmentRoots.length !== 1) {
    throw new Error(fragmentRoots.length
      ? `Fragment BASE:${base} matched ${fragmentRoots.length} elements; Publisher fragments require exactly one`
      : `Unable to resolve BASE:${base} to a fragment within resource`);
  }
  const state = hiddenState();
  for (const except of parsed.plan.excepts) applyExcept(working, fragmentRoots, except, model, state);
  for (const elide of parsed.plan.elides) applyElide(working, fragmentRoots, elide, model, state);
  const rendered = finalizeHidden(working, state);
  const values = base ? evalPath(rendered, base, model, rendered) : [rendered];
  const nonEmptyValues = values.length ? values : [];
  return parsed.format === 'JSON'
    ? jsonFragment(nonEmptyValues)
    : xmlFragment(nonEmptyValues, baseRootName(base, parsed.type));
}
