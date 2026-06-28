import type { Json } from './packages';
import { readOrFetchTx, stableJson, txCachePath, type TxRequest } from './tx-cache';

export type ValueSetClassification =
  | { kind: 'local-extensional'; reasons: string[] }
  | { kind: 'external-extensional'; reasons: string[] }
  | { kind: 'unsupported-without-tx'; reasons: string[] };

export type ExpandedValueSetCode = {
  system: string;
  version?: string | null;
  code: string;
  display?: string | null;
};

export type TerminologyMode = 'off' | 'local' | 'cache' | 'online' | 'refresh';
export type TerminologyMetadataMode = 'off' | 'cache' | 'online' | 'refresh';

export type TerminologyOptions = {
  mode: TerminologyMode;
  cacheDir: string;
  server: string;
  fhirVersion: string;
  maxExpansionCodes: number;
  activeOnly?: boolean;
  profile?: boolean;
};

export type TerminologyMetadataOptions = {
  mode: TerminologyMetadataMode;
  cacheDir: string;
  server: string;
  fhirVersion: string;
  profile?: boolean;
};

export type PreparedValueSetExpansion = {
  valueSet: Json;
  classification: ValueSetClassification;
  codes: ExpandedValueSetCode[];
  source: 'local' | 'tx-cache' | 'tx-online';
};

export type TerminologyResourceContext = {
  resources: Json[];
  completeSystems: Set<string>;
  contentBySystem: Map<string, string>;
  conceptsBySystem: Map<string, Map<string, Json>>;
  valueSets: Map<string, Json[]>;
};

export type ValueSetStrategySummary = {
  ref: string;
  url?: string;
  version?: string;
  name?: string;
  title?: string;
  classification: ValueSetClassification['kind'];
  reasons: string[];
  expansion: {
    mode: TerminologyMode;
    status: 'not-requested' | 'expanded' | 'requires-terminology-service';
    source?: PreparedValueSetExpansion['source'];
    codeCount?: number;
    maxExpansionCodes: number;
  };
};

export type CodeToValidate = {
  system?: string;
  code: string;
  display?: string;
  systemVersion?: string;
  date?: string;
  abstract?: boolean;
  displayLanguage?: string;
};

export type ValueSetValidateCodeInput = CodeToValidate & {
  valueSet?: Json;
  valueSetUrl?: string;
  valueSetVersion?: string;
};

export type CodeSystemValidateCodeInput = {
  codeSystem?: Json;
  codeSystemUrl?: string;
  code: string;
  version?: string;
  display?: string;
  date?: string;
  abstract?: boolean;
  displayLanguage?: string;
};

export type ValidateCodeResult = {
  result: boolean;
  message?: string;
  display?: string;
  source: 'tx-cache' | 'tx-online';
  cachePath: string;
};

function codeSystemContentByUrl(resources: Json[]): Map<string, string> {
  return new Map(resources.filter((r) => r.resourceType === 'CodeSystem' && r.url).map((r) => [r.url, r.content || 'complete']));
}

function completeCodeSystemUrls(resources: Json[]): Set<string> {
  return new Set(
    resources
      .filter((r) => r.resourceType === 'CodeSystem' && r.url && (r.content || 'complete') === 'complete')
      .map((r) => r.url),
  );
}

function canonicalNoVersion(url: string): string {
  return String(url).split('|')[0];
}

function valueSetVersion(url: string): string | undefined {
  return String(url).includes('|') ? String(url).split('|').slice(1).join('|') : undefined;
}

function valueSetsByUrl(resources: Json[]): Map<string, Json[]> {
  const out = new Map<string, Json[]>();
  for (const vs of resources.filter((r) => r.resourceType === 'ValueSet' && r.url)) {
    const key = canonicalNoVersion(vs.url);
    out.set(key, [...(out.get(key) || []), vs]);
  }
  return out;
}

function resolveValueSet(url: string, byUrl: Map<string, Json[]>): Json | undefined {
  const clean = canonicalNoVersion(url);
  const version = valueSetVersion(url);
  const matches = byUrl.get(clean) || [];
  return version ? matches.find((vs) => vs.version === version) : matches[0];
}

function codeSystemConceptsByUrl(resources: Json[]): Map<string, Map<string, Json>> {
  const out = new Map<string, Map<string, Json>>();
  for (const cs of resources.filter((r) => r.resourceType === 'CodeSystem' && r.url)) {
    const concepts = new Map<string, Json>();
    const walk = (items: Json[] = []) => {
      for (const c of items) {
        if (c.code) concepts.set(c.code, c);
        if (Array.isArray(c.concept)) walk(c.concept);
      }
    };
    walk(cs.concept || []);
    out.set(cs.url, concepts);
  }
  return out;
}

function codeKey(c: ExpandedValueSetCode): string {
  return `${c.system}\u0000${c.version || ''}\u0000${c.code}`;
}

function uniqueCodes(codes: ExpandedValueSetCode[]): ExpandedValueSetCode[] {
  const byKey = new Map<string, ExpandedValueSetCode>();
  for (const c of codes) byKey.set(codeKey(c), c);
  return [...byKey.values()].sort((a, b) =>
    a.system.localeCompare(b.system)
    || String(a.version || '').localeCompare(String(b.version || ''))
    || a.code.localeCompare(b.code)
  );
}

function valueSetRef(vs: Json): string {
  return `${vs.resourceType || 'ValueSet'}/${vs.id || canonicalNoVersion(vs.url) || '(anonymous)'}`;
}

function subtractCodes(base: ExpandedValueSetCode[], excluded: ExpandedValueSetCode[]): ExpandedValueSetCode[] {
  const excludedKeys = new Set(excluded.map(codeKey));
  return base.filter((c) => !excludedKeys.has(codeKey(c)));
}

function assertExpansionLimit(count: number, maxCodes: number | undefined, location: string): void {
  if (maxCodes !== undefined && count > maxCodes) {
    throw new Error(`${location}: local expansion returned ${count} codes, above PUBLISHER_TX_MAX_CODES=${maxCodes}`);
  }
}

function uniqueCodesWithinLimit(codes: ExpandedValueSetCode[], ctx: ExpansionContext, location: string): ExpandedValueSetCode[] {
  const unique = uniqueCodes(codes);
  assertExpansionLimit(unique.length, ctx.maxCodes, location);
  return unique;
}

function codesForAvailableCodeSystem(system: string, version: string | null | undefined, ctx: ExpansionContext, location: string): ExpandedValueSetCode[] {
  const content = ctx.contentBySystem.get(system);
  if (content && content !== 'complete') {
    throw new Error(`${location}: local CodeSystem ${system} has content=${content}, not complete`);
  }
  if (!ctx.completeSystems.has(system)) {
    throw new Error(`${location}: whole-system include for ${system} is not available locally`);
  }
  const concepts = [...(ctx.conceptsBySystem.get(system)?.values() || [])];
  assertExpansionLimit(concepts.length, ctx.maxCodes, location);
  return concepts.map((concept) => ({
    system,
    version: version ?? null,
    code: concept.code,
    display: concept.display ?? null,
  }));
}

type ExpansionContext = {
  resources: Json[];
  completeSystems: Set<string>;
  contentBySystem: Map<string, string>;
  conceptsBySystem: Map<string, Map<string, Json>>;
  valueSets: Map<string, Json[]>;
  stack: string[];
  maxCodes?: number;
};

type TerminologyResourceInput = Json[] | TerminologyResourceContext;
type ExpandValueSetOptions = {
  maxCodes?: number;
};

type ClassificationScan = {
  externalSystems: Set<string>;
  unsupportedReasons: string[];
};

export function terminologyResourceContext(resources: Json[]): TerminologyResourceContext {
  return {
    resources,
    completeSystems: completeCodeSystemUrls(resources),
    contentBySystem: codeSystemContentByUrl(resources),
    conceptsBySystem: codeSystemConceptsByUrl(resources),
    valueSets: valueSetsByUrl(resources),
  };
}

function asTerminologyResourceContext(input: TerminologyResourceInput): TerminologyResourceContext {
  return Array.isArray(input) ? terminologyResourceContext(input) : input;
}

function emptyClassificationScan(): ClassificationScan {
  return { externalSystems: new Set(), unsupportedReasons: [] };
}

function mergeClassificationScans(...scans: ClassificationScan[]): ClassificationScan {
  return {
    externalSystems: new Set(scans.flatMap((scan) => [...scan.externalSystems])),
    unsupportedReasons: scans.flatMap((scan) => scan.unsupportedReasons),
  };
}

function scanClassifiedComponent(component: Json, ctx: ExpansionContext, location: string): ClassificationScan {
  const out = emptyClassificationScan();
  if (Array.isArray(component.filter) && component.filter.length) {
    out.unsupportedReasons.push(`${location}: include for ${component.system || '(no system)'} uses filter`);
    return out;
  }

  const hasExplicitConcepts = Array.isArray(component.concept) && component.concept.length > 0;
  const hasValueSetImports = Array.isArray(component.valueSet) && component.valueSet.length > 0;

  if (hasExplicitConcepts) {
    if (!component.system) out.unsupportedReasons.push(`${location}: explicit concepts require a system`);
    else if (!ctx.completeSystems.has(component.system)) out.externalSystems.add(component.system);
  }

  if (hasValueSetImports) {
    for (const nestedUrl of component.valueSet) {
      const nested = resolveValueSet(nestedUrl, ctx.valueSets);
      if (!nested) {
        out.unsupportedReasons.push(`${location}: imported ValueSet ${nestedUrl} is not available locally`);
        continue;
      }
      const nestedScan = scanClassifiedValueSet(nested, ctx);
      out.unsupportedReasons.push(...nestedScan.unsupportedReasons);
      for (const system of nestedScan.externalSystems) out.externalSystems.add(system);
    }
  }

  if (!hasExplicitConcepts && !hasValueSetImports && component.system) {
    const content = ctx.contentBySystem.get(component.system);
    if (content && content !== 'complete') {
      out.unsupportedReasons.push(`${location}: local CodeSystem ${component.system} has content=${content}, not complete`);
    } else if (!ctx.completeSystems.has(component.system)) {
      out.unsupportedReasons.push(`${location}: whole-system include for ${component.system} is not available locally`);
    }
  }

  if (!hasExplicitConcepts && !hasValueSetImports && !component.system) {
    out.unsupportedReasons.push(`${location}: include for (no system) does not enumerate concepts or import an available ValueSet`);
  }

  return out;
}

function scanClassifiedValueSet(vs: Json, ctx: ExpansionContext): ClassificationScan {
  const key = canonicalNoVersion(vs.url || vs.id || '(anonymous)');
  if (ctx.stack.includes(key)) {
    return {
      externalSystems: new Set(),
      unsupportedReasons: [`${key}: recursive ValueSet import cycle: ${[...ctx.stack, key].join(' -> ')}`],
    };
  }
  const next: ExpansionContext = { ...ctx, stack: [...ctx.stack, key] };
  return mergeClassificationScans(
    ...(vs.compose?.include || []).map((inc: Json, i: number) => scanClassifiedComponent(inc, next, `${key}.compose.include[${i}]`)),
    ...(vs.compose?.exclude || []).map((exc: Json, i: number) => scanClassifiedComponent(exc, next, `${key}.compose.exclude[${i}]`)),
  );
}

function expandComponent(component: Json, ctx: ExpansionContext, location: string): ExpandedValueSetCode[] {
  const out: ExpandedValueSetCode[] = [];
  if (Array.isArray(component.filter) && component.filter.length) {
    throw new Error(`${location}: include for ${component.system || '(no system)'} uses filter`);
  }

  const hasExplicitConcepts = Array.isArray(component.concept) && component.concept.length > 0;
  const hasValueSetImports = Array.isArray(component.valueSet) && component.valueSet.length > 0;

  if (hasExplicitConcepts) {
    if (!component.system) throw new Error(`${location}: explicit concepts require a system`);
    const localConcepts = ctx.conceptsBySystem.get(component.system);
    for (const c of component.concept) {
      if (!c.code) throw new Error(`${location}: concept without code`);
      const local = localConcepts?.get(c.code);
      out.push({
        system: component.system,
        version: component.version ?? null,
        code: c.code,
        display: c.display ?? local?.display ?? null,
      });
    }
  }

  if (hasValueSetImports) {
    for (const nestedUrl of component.valueSet) {
      const nested = resolveValueSet(nestedUrl, ctx.valueSets);
      if (!nested) throw new Error(`${location}: imported ValueSet ${nestedUrl} is not available locally`);
      out.push(...expandValueSetInternal(nested, ctx));
    }
  }

  if (!hasExplicitConcepts && !hasValueSetImports && component.system) {
    out.push(...codesForAvailableCodeSystem(component.system, component.version, ctx, location));
  }

  if (!out.length) {
    if (component.system && !hasExplicitConcepts && !hasValueSetImports) return [];
    throw new Error(`${location}: include for ${component.system || '(no system)'} does not enumerate concepts or import an available ValueSet`);
  }
  return uniqueCodesWithinLimit(out, ctx, location);
}

function expandValueSetInternal(vs: Json, ctx: ExpansionContext): ExpandedValueSetCode[] {
  const key = canonicalNoVersion(vs.url || vs.id || '(anonymous)');
  if (ctx.stack.includes(key)) throw new Error(`${key}: recursive ValueSet import cycle: ${[...ctx.stack, key].join(' -> ')}`);
  const next: ExpansionContext = { ...ctx, stack: [...ctx.stack, key] };

  let codes = uniqueCodesWithinLimit((vs.compose?.include || []).flatMap((inc: Json, i: number) => expandComponent(inc, next, `${key}.compose.include[${i}]`)), next, key);
  for (const [i, exc] of (vs.compose?.exclude || []).entries()) {
    codes = uniqueCodesWithinLimit(subtractCodes(codes, expandComponent(exc, next, `${key}.compose.exclude[${i}]`)), next, key);
  }
  return codes;
}

export function expandValueSet(vs: Json, resources: TerminologyResourceInput, options: ExpandValueSetOptions = {}): ExpandedValueSetCode[] {
  const context = asTerminologyResourceContext(resources);
  return expandValueSetInternal(vs, {
    ...context,
    stack: [],
    maxCodes: options.maxCodes,
  });
}

export function classifyValueSet(vs: Json, resources: TerminologyResourceInput): ValueSetClassification {
  const context = asTerminologyResourceContext(resources);
  const scan = scanClassifiedValueSet(vs, { ...context, stack: [] });

  if (scan.unsupportedReasons.length) {
    return { kind: 'unsupported-without-tx', reasons: scan.unsupportedReasons };
  }
  if (scan.externalSystems.size) {
    return {
      kind: 'external-extensional',
      reasons: [...scan.externalSystems].map((s) => `explicit concept list from system without a complete local CodeSystem ${s}`),
    };
  }
  return { kind: 'local-extensional', reasons: ['all includes expand from available complete CodeSystems and available ValueSets'] };
}

export function assertValueSetExpansionSupported(resources: Json[], context: TerminologyResourceInput = resources): void {
  const terminologyContext = asTerminologyResourceContext(context);
  const failures: string[] = [];
  for (const vs of resources.filter((r) => r.resourceType === 'ValueSet')) {
    const classification = classifyValueSet(vs, terminologyContext);
    if (classification.kind === 'unsupported-without-tx') {
      failures.push(`${vs.url || vs.id}: ${classification.reasons.join('; ')}`);
    }
  }
  if (failures.length) {
    throw new Error([
      'Cannot populate ValueSet_Codes without terminology support for these ValueSet constructs:',
      ...failures.map((f) => `  - ${f}`),
      'Set PUBLISHER_TX=online/cache after terminology-service support exists, or rewrite the ValueSet as an explicit extensional list.',
    ].join('\n'));
  }
}

export function summarizeValueSetStrategies(resources: Json[], context: TerminologyResourceInput = resources): string[] {
  const terminologyContext = asTerminologyResourceContext(context);
  return resources
    .filter((r) => r.resourceType === 'ValueSet')
    .sort((a, b) => String(a.url || a.id).localeCompare(String(b.url || b.id)))
    .map((vs) => {
      const classification = classifyValueSet(vs, terminologyContext);
      return `${vs.url || vs.id}: ${classification.kind}${classification.reasons.length ? ` (${classification.reasons.join('; ')})` : ''}`;
    });
}

export function valueSetStrategySummaries(
  resources: Json[],
  options: Pick<TerminologyOptions, 'mode' | 'maxExpansionCodes'>,
  expansions: Map<string, PreparedValueSetExpansion> = new Map(),
  context: TerminologyResourceInput = resources,
): ValueSetStrategySummary[] {
  const terminologyContext = asTerminologyResourceContext(context);
  return resources
    .filter((r) => r.resourceType === 'ValueSet')
    .sort((a, b) => valueSetRef(a).localeCompare(valueSetRef(b)))
    .map((vs) => {
      const ref = valueSetRef(vs);
      const prepared = expansions.get(ref);
      const classification = prepared?.classification || classifyValueSet(vs, terminologyContext);
      const status = prepared
        ? 'expanded'
        : options.mode === 'off'
          ? 'not-requested'
          : classification.kind === 'unsupported-without-tx'
            ? 'requires-terminology-service'
            : 'not-requested';
      return {
        ref,
        ...(vs.url ? { url: vs.url } : {}),
        ...(vs.version ? { version: vs.version } : {}),
        ...(vs.name ? { name: vs.name } : {}),
        ...(vs.title ? { title: vs.title } : {}),
        classification: classification.kind,
        reasons: classification.reasons,
        expansion: {
          mode: options.mode,
          status,
          ...(prepared ? { source: prepared.source, codeCount: prepared.codes.length } : {}),
          maxExpansionCodes: options.maxExpansionCodes,
        },
      };
    });
}

export function terminologyModeFromEnv(env: Record<string, string | undefined> = process.env): TerminologyMode {
  if (env.PUBLISHER_EXPERIMENT_EXPAND_VALUESETS === '1' && !env.PUBLISHER_TX) return 'local';
  const mode = env.PUBLISHER_TX || 'off';
  if (mode === 'off' || mode === 'local' || mode === 'cache' || mode === 'online' || mode === 'refresh') return mode;
  throw new Error(`Invalid PUBLISHER_TX=${mode}. Expected off, local, cache, online, or refresh.`);
}

export function terminologyMetadataModeFromEnv(env: Record<string, string | undefined> = process.env): TerminologyMetadataMode {
  const explicit = env.PUBLISHER_TX_METADATA;
  if (explicit) {
    if (explicit === 'off' || explicit === 'cache' || explicit === 'online' || explicit === 'refresh') return explicit;
    throw new Error(`Invalid PUBLISHER_TX_METADATA=${explicit}. Expected off, cache, online, or refresh.`);
  }
  const tx = env.PUBLISHER_TX;
  if (tx === 'cache' || tx === 'online' || tx === 'refresh') return tx;
  return 'off';
}

export function defaultTerminologyServerForFhirVersion(fhirVersion: string): string {
  if (fhirVersion.startsWith('3.0.')) return 'https://tx.fhir.org/r3';
  if (fhirVersion.startsWith('4.0.') || fhirVersion.startsWith('4.3.')) return 'https://tx.fhir.org/r4';
  if (fhirVersion.startsWith('5.')) return 'https://tx.fhir.org/r5';
  if (fhirVersion.startsWith('6.')) return 'https://tx.fhir.org/r6';
  throw new Error(`No default terminology server mapping for fhirVersion=${fhirVersion}; set PUBLISHER_TX_SERVER explicitly.`);
}

export function maxExpansionCodesFromEnv(env: Record<string, string | undefined> = process.env): number {
  const raw = env.PUBLISHER_TX_MAX_CODES;
  if (raw == null || raw === '') return 10000;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`Invalid PUBLISHER_TX_MAX_CODES=${raw}. Expected a positive integer.`);
  return parsed;
}

function valueSetForExpansionRequest(resource: Json): Json {
  const out: Json = { resourceType: 'ValueSet' };
  for (const field of ['id', 'url', 'version', 'name', 'title', 'status', 'experimental', 'immutable', 'compose', 'contained']) {
    if (resource[field] !== undefined) out[field] = resource[field];
  }
  return out;
}

function codeSystemForValidateRequest(resource: Json): Json {
  const out: Json = { resourceType: 'CodeSystem' };
  for (const field of ['id', 'url', 'version', 'name', 'title', 'status', 'experimental', 'caseSensitive', 'content', 'property', 'concept']) {
    if (resource[field] !== undefined) out[field] = resource[field];
  }
  return out;
}

function parametersResource(parameters: Json[]): Json {
  return { resourceType: 'Parameters', parameter: parameters };
}

function valueParameter(name: string, fhirType: 'Uri' | 'String' | 'Code' | 'DateTime' | 'Boolean', value: unknown): Json[] {
  if (value === undefined || value === null || value === '') return [];
  return [{ name, [`value${fhirType}`]: value }];
}

export function valueSetExpandRequest(vs: Json, options: TerminologyOptions): TxRequest {
  const parameters: Json[] = [
    { name: 'valueSet', resource: valueSetForExpansionRequest(vs) },
  ];
  if (options.activeOnly !== undefined) parameters.push({ name: 'activeOnly', valueBoolean: options.activeOnly });
  return {
    operation: 'ValueSet/$expand',
    fhirVersion: options.fhirVersion,
    server: options.server.replace(/\/+$/, ''),
    parameters: {
      resourceType: 'Parameters',
      parameter: parameters,
    },
  };
}

export function valueSetValidateCodeRequest(input: ValueSetValidateCodeInput, options: TerminologyOptions | TerminologyMetadataOptions): TxRequest {
  if (!input.valueSet && !input.valueSetUrl) throw new Error('ValueSet $validate-code requires valueSet or valueSetUrl');
  const parameters: Json[] = [
    ...(input.valueSet ? [{ name: 'valueSet', resource: valueSetForExpansionRequest(input.valueSet) }] : valueParameter('url', 'Uri', input.valueSetUrl)),
    ...valueParameter('valueSetVersion', 'String', input.valueSetVersion),
    ...valueParameter('system', 'Uri', input.system),
    ...valueParameter('systemVersion', 'String', input.systemVersion),
    ...valueParameter('code', 'Code', input.code),
    ...valueParameter('display', 'String', input.display),
    ...valueParameter('date', 'DateTime', input.date),
    ...valueParameter('abstract', 'Boolean', input.abstract),
    ...valueParameter('displayLanguage', 'Code', input.displayLanguage),
  ];
  return {
    operation: 'ValueSet/$validate-code',
    fhirVersion: options.fhirVersion,
    server: options.server.replace(/\/+$/, ''),
    parameters: parametersResource(parameters),
  };
}

export function codeSystemValidateCodeRequest(input: CodeSystemValidateCodeInput, options: TerminologyOptions | TerminologyMetadataOptions): TxRequest {
  if (!input.codeSystem && !input.codeSystemUrl) throw new Error('CodeSystem $validate-code requires codeSystem or codeSystemUrl');
  const parameters: Json[] = [
    ...(input.codeSystem ? [{ name: 'codeSystem', resource: codeSystemForValidateRequest(input.codeSystem) }] : valueParameter('url', 'Uri', input.codeSystemUrl)),
    ...valueParameter('version', 'String', input.version),
    ...valueParameter('code', 'Code', input.code),
    ...valueParameter('display', 'String', input.display),
    ...valueParameter('date', 'DateTime', input.date),
    ...valueParameter('abstract', 'Boolean', input.abstract),
    ...valueParameter('displayLanguage', 'Code', input.displayLanguage),
  ];
  return {
    operation: 'CodeSystem/$validate-code',
    fhirVersion: options.fhirVersion,
    server: options.server.replace(/\/+$/, ''),
    parameters: parametersResource(parameters),
  };
}

export function codeSystemSearchRequest(system: string, options: TerminologyMetadataOptions): TxRequest {
  return {
    operation: 'CodeSystem?url',
    fhirVersion: options.fhirVersion,
    server: options.server.replace(/\/+$/, ''),
    parameters: { url: system },
  };
}

function parameterValue(response: Json, name: string, fhirType: 'Boolean' | 'String'): any {
  const match = (response.parameter || []).find((p: Json) => p.name === name && p[`value${fhirType}`] !== undefined);
  return match?.[`value${fhirType}`];
}

export function validateCodeResultFromParameters(response: Json): Omit<ValidateCodeResult, 'source' | 'cachePath'> {
  if (response.resourceType === 'OperationOutcome') {
    throw new Error(`terminology server returned OperationOutcome: ${operationOutcomeMessage(response)}`);
  }
  if (response.resourceType !== 'Parameters') {
    throw new Error(`terminology server returned ${response.resourceType || 'non-FHIR JSON'}, expected Parameters`);
  }
  const result = parameterValue(response, 'result', 'Boolean');
  if (typeof result !== 'boolean') throw new Error('terminology validate-code response did not include boolean result');
  return {
    result,
    message: parameterValue(response, 'message', 'String'),
    display: parameterValue(response, 'display', 'String'),
  };
}

function codeSystemFromSearchResponse(system: string, response: Json): Json {
  if (response.resourceType === 'OperationOutcome') {
    throw new Error(`${system}: terminology server returned OperationOutcome: ${operationOutcomeMessage(response)}`);
  }
  if (response.resourceType === 'CodeSystem') {
    if (response.url && response.url !== system) throw new Error(`${system}: terminology server returned CodeSystem ${response.url}`);
    return response;
  }
  if (response.resourceType !== 'Bundle') {
    throw new Error(`${system}: terminology server returned ${response.resourceType || 'non-FHIR JSON'}, expected Bundle or CodeSystem`);
  }
  const matches = (response.entry || [])
    .map((entry: Json) => entry.resource)
    .filter((resource: Json) => resource?.resourceType === 'CodeSystem' && (!resource.url || resource.url === system));
  if (!matches.length) throw new Error(`${system}: terminology server returned 0 matching CodeSystems`);
  return matches.sort(compareCodeSystemMetadata).at(-1)!;
}

function compareCodeSystemMetadata(a: Json, b: Json): number {
  return compareBoolean(a.status === 'active', b.status === 'active')
    || compareVersionLike(a.version, b.version)
    || compareDateLike(a.date, b.date)
    || stableCompare(stableJson(a), stableJson(b));
}

function compareBoolean(a: boolean, b: boolean): number {
  return Number(a) - Number(b);
}

function compareDateLike(a: unknown, b: unknown): number {
  const aTime = typeof a === 'string' ? Date.parse(a) : NaN;
  const bTime = typeof b === 'string' ? Date.parse(b) : NaN;
  if (!Number.isNaN(aTime) && !Number.isNaN(bTime) && aTime !== bTime) return aTime - bTime;
  if (!Number.isNaN(aTime) !== !Number.isNaN(bTime)) return Number(!Number.isNaN(aTime)) - Number(!Number.isNaN(bTime));
  return 0;
}

function compareVersionLike(a: unknown, b: unknown): number {
  const left = typeof a === 'string' ? a : '';
  const right = typeof b === 'string' ? b : '';
  if (left && !right) return 1;
  if (!left && right) return -1;
  return stableCompare(left, right);
}

function stableCompare(a: string, b: string): number {
  return a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });
}

function operationOutcomeMessage(outcome: Json): string {
  const issues = Array.isArray(outcome.issue) ? outcome.issue : [];
  return issues
    .map((issue: Json) => [issue.severity, issue.code, issue.diagnostics].filter(Boolean).join(': '))
    .filter(Boolean)
    .join('; ') || 'OperationOutcome returned without issue details';
}

function flattenExpansionContains(items: Json[] = [], inheritedSystem?: string, inheritedVersion?: string | null): ExpandedValueSetCode[] {
  const out: ExpandedValueSetCode[] = [];
  for (const item of items) {
    const system = item.system || inheritedSystem;
    const version = item.version ?? inheritedVersion ?? null;
    if (item.code && system) {
      out.push({
        system,
        version,
        code: item.code,
        display: item.display ?? null,
      });
    }
    if (Array.isArray(item.contains)) out.push(...flattenExpansionContains(item.contains, system, version));
  }
  return out;
}

function codesFromTxExpansion(vs: Json, response: Json, maxExpansionCodes: number): ExpandedValueSetCode[] {
  if (response.resourceType === 'OperationOutcome') {
    throw new Error(`${vs.url || vs.id}: terminology server returned OperationOutcome: ${operationOutcomeMessage(response)}`);
  }
  if (response.resourceType !== 'ValueSet') {
    throw new Error(`${vs.url || vs.id}: terminology server returned ${response.resourceType || 'non-FHIR JSON'}, expected ValueSet`);
  }
  if (!response.expansion) {
    throw new Error(`${vs.url || vs.id}: terminology server response did not include ValueSet.expansion`);
  }
  const total = typeof response.expansion.total === 'number' ? response.expansion.total : undefined;
  if (total !== undefined && total > maxExpansionCodes) {
    throw new Error(`${vs.url || vs.id}: terminology expansion has ${total} codes, above PUBLISHER_TX_MAX_CODES=${maxExpansionCodes}`);
  }
  const contains = response.expansion.contains;
  if (!Array.isArray(contains)) {
    if (total === 0) return [];
    throw new Error(`${vs.url || vs.id}: terminology expansion did not include expansion.contains; the server may have returned a summary or too-costly result`);
  }
  const codes = uniqueCodes(flattenExpansionContains(contains));
  if (codes.length > maxExpansionCodes) {
    throw new Error(`${vs.url || vs.id}: terminology expansion returned ${codes.length} codes, above PUBLISHER_TX_MAX_CODES=${maxExpansionCodes}`);
  }
  return codes;
}

function assertModeCanExpand(mode: TerminologyMode): void {
  if (mode === 'off') {
    throw new Error('PUBLISHER_TX=off does not populate ValueSet_Codes. Use PUBLISHER_TX=local, cache, online, or refresh when expansion rows are required.');
  }
}

function failUnsupportedValueSets(resources: Json[], context: TerminologyResourceInput = resources): void {
  const terminologyContext = asTerminologyResourceContext(context);
  const failures: string[] = [];
  for (const vs of resources.filter((r) => r.resourceType === 'ValueSet')) {
    const classification = classifyValueSet(vs, terminologyContext);
    if (classification.kind === 'unsupported-without-tx') {
      failures.push(`${vs.url || vs.id}: ${classification.reasons.join('; ')}`);
    }
  }
  if (failures.length) {
    throw new Error([
      'PUBLISHER_TX=local cannot expand these ValueSets without terminology-service support:',
      ...failures.map((f) => `  - ${f}`),
      'Use PUBLISHER_TX=cache with reviewed tx-cache entries, or PUBLISHER_TX=online/refresh to call a terminology server.',
    ].join('\n'));
  }
}

async function expandWithTerminologyServer(
  vs: Json,
  classification: ValueSetClassification,
  options: TerminologyOptions,
): Promise<PreparedValueSetExpansion> {
  const request = valueSetExpandRequest(vs, options);
  const { response, source, cachePath } = await readOrFetchTx(request, {
    cacheDir: options.cacheDir,
    mode: options.mode === 'refresh' ? 'refresh' : options.mode === 'online' ? 'online' : 'cache',
  });
  const codes = codesFromTxExpansion(vs, response, options.maxExpansionCodes);
  if (options.profile) {
    console.error(`[publisher-profile] tx ${source}: ${vs.url || vs.id} -> ${codes.length} codes (${cachePath})`);
  }
  return { valueSet: vs, classification, codes, source: source === 'cache' ? 'tx-cache' : 'tx-online' };
}

export async function fetchCodeSystemMetadata(
  system: string,
  options: TerminologyMetadataOptions,
): Promise<{ codeSystem: Json; source: 'tx-cache' | 'tx-online'; cachePath: string }> {
  if (options.mode === 'off') throw new Error(`Terminology metadata lookup is disabled for ${system}`);
  const request = codeSystemSearchRequest(system, options);
  const { response, source, cachePath } = await readOrFetchTx(request, {
    cacheDir: options.cacheDir,
    mode: options.mode === 'refresh' ? 'refresh' : options.mode === 'online' ? 'online' : 'cache',
  });
  const codeSystem = codeSystemFromSearchResponse(system, response);
  if (options.profile) {
    console.error(`[publisher-profile] tx ${source}: CodeSystem ${system} -> ${codeSystem.version || '(no version)'} (${cachePath})`);
  }
  return { codeSystem, source: source === 'cache' ? 'tx-cache' : 'tx-online', cachePath };
}

export function isOptionalCodeSystemMetadataMiss(error: unknown, mode: TerminologyMetadataMode): boolean {
  const message = error instanceof Error ? error.message : String(error);
  if (
    message.includes('expected at least one matching CodeSystem entry')
    || message.includes('terminology server returned 0 matching CodeSystems')
  ) {
    return true;
  }
  return mode === 'cache' && message.includes('Missing terminology cache entry:');
}

async function validateCodeWithRequest(
  request: TxRequest,
  options: TerminologyOptions | TerminologyMetadataOptions,
): Promise<ValidateCodeResult> {
  if (options.mode === 'off' || options.mode === 'local') {
    throw new Error(`Terminology validate-code requires PUBLISHER_TX=cache, online, or refresh; got ${options.mode}`);
  }
  const { response, source, cachePath } = await readOrFetchTx(request, {
    cacheDir: options.cacheDir,
    mode: options.mode === 'refresh' ? 'refresh' : options.mode === 'online' ? 'online' : 'cache',
  });
  const result = validateCodeResultFromParameters(response);
  if (options.profile) {
    console.error(`[publisher-profile] tx ${source}: ${request.operation} ${result.result ? 'valid' : 'invalid'} (${cachePath})`);
  }
  return { ...result, source: source === 'cache' ? 'tx-cache' : 'tx-online', cachePath };
}

export async function validateValueSetCode(
  input: ValueSetValidateCodeInput,
  options: TerminologyOptions | TerminologyMetadataOptions,
): Promise<ValidateCodeResult> {
  return validateCodeWithRequest(valueSetValidateCodeRequest(input, options), options);
}

export async function validateCodeSystemCode(
  input: CodeSystemValidateCodeInput,
  options: TerminologyOptions | TerminologyMetadataOptions,
): Promise<ValidateCodeResult> {
  return validateCodeWithRequest(codeSystemValidateCodeRequest(input, options), options);
}

export async function expandValueSetWithTerminology(
  vs: Json,
  resources: Json[],
  options: TerminologyOptions,
  context: TerminologyResourceInput = resources,
): Promise<PreparedValueSetExpansion> {
  assertModeCanExpand(options.mode);
  const terminologyContext = asTerminologyResourceContext(context);
  const classification = classifyValueSet(vs, terminologyContext);

  if (options.mode === 'local') {
    if (classification.kind === 'unsupported-without-tx') throw new Error(`${vs.url || vs.id}: ${classification.reasons.join('; ')}`);
    const codes = expandValueSet(vs, terminologyContext, { maxCodes: options.maxExpansionCodes });
    return { valueSet: vs, classification, codes, source: 'local' };
  }

  if (classification.kind === 'local-extensional') {
    const codes = expandValueSet(vs, terminologyContext, { maxCodes: options.maxExpansionCodes });
    return { valueSet: vs, classification, codes, source: 'local' };
  }

  return expandWithTerminologyServer(vs, classification, options);
}

export async function prepareValueSetExpansions(
  resources: Json[],
  options: TerminologyOptions,
  context: TerminologyResourceInput = resources,
): Promise<Map<string, PreparedValueSetExpansion>> {
  if (options.mode === 'off') return new Map();
  const terminologyContext = asTerminologyResourceContext(context);
  if (options.mode === 'local') failUnsupportedValueSets(resources, terminologyContext);

  const out = new Map<string, PreparedValueSetExpansion>();
  for (const vs of resources.filter((r) => r.resourceType === 'ValueSet')) {
    const prepared = await expandValueSetWithTerminology(vs, resources, options, terminologyContext);
    out.set(valueSetRef(vs), prepared);
  }
  return out;
}

export function terminologyCacheMissMessages(resources: Json[], options: TerminologyOptions, context: TerminologyResourceInput = resources): string[] {
  const terminologyContext = asTerminologyResourceContext(context);
  return resources
    .filter((r) => r.resourceType === 'ValueSet')
    .map((vs) => ({ vs, classification: classifyValueSet(vs, terminologyContext) }))
    .filter(({ classification }) => classification.kind !== 'local-extensional')
    .map(({ vs }) => `${vs.url || vs.id}: ${txCachePath(options.cacheDir, valueSetExpandRequest(vs, options))}`);
}
