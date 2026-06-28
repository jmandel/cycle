import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertValueSetExpansionSupported,
  classifyValueSet,
  codeSystemSearchRequest,
  codeSystemValidateCodeRequest,
  defaultTerminologyServerForFhirVersion,
  expandValueSet,
  fetchCodeSystemMetadata,
  isOptionalCodeSystemMetadataMiss,
  prepareValueSetExpansions,
  terminologyResourceContext,
  validateCodeResultFromParameters,
  validateValueSetCode,
  valueSetExpandRequest,
  valueSetStrategySummaries,
  valueSetValidateCodeRequest,
} from './terminology';
import { txRequestKey, writeTxCache } from './tx-cache';

const localCodeSystem = {
  resourceType: 'CodeSystem',
  url: 'https://example.org/CodeSystem/local',
  content: 'complete',
  concept: [
    { code: 'a', display: 'A' },
    { code: 'b', display: 'B' },
  ],
};

describe('ValueSet terminology classification', () => {
  test('chooses a default terminology server from FHIR version', () => {
    expect(defaultTerminologyServerForFhirVersion('3.0.2')).toBe('https://tx.fhir.org/r3');
    expect(defaultTerminologyServerForFhirVersion('4.0.1')).toBe('https://tx.fhir.org/r4');
    expect(defaultTerminologyServerForFhirVersion('4.3.0')).toBe('https://tx.fhir.org/r4');
    expect(defaultTerminologyServerForFhirVersion('5.0.0')).toBe('https://tx.fhir.org/r5');
    expect(defaultTerminologyServerForFhirVersion('6.0.0-ballot3')).toBe('https://tx.fhir.org/r6');
    expect(() => defaultTerminologyServerForFhirVersion('2.0.0')).toThrow('PUBLISHER_TX_SERVER');
  });

  test('selects the active highest-version CodeSystem from metadata search results', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'terminology-codesystem-metadata-'));
    const request = codeSystemSearchRequest('http://loinc.org', {
      mode: 'cache',
      cacheDir: dir,
      server: 'https://tx.fhir.org/r4',
      fhirVersion: '4.0.1',
    });
    writeTxCache(dir, request, {
      resourceType: 'Bundle',
      total: 3,
      entry: [
        { resource: { resourceType: 'CodeSystem', url: 'http://loinc.org', version: '2.82', status: 'retired' } },
        { resource: { resourceType: 'CodeSystem', url: 'http://loinc.org', version: '2.77', status: 'active' } },
        { resource: { resourceType: 'CodeSystem', url: 'http://loinc.org', version: '2.82', status: 'active' } },
      ],
    });

    try {
      const result = await fetchCodeSystemMetadata('http://loinc.org', {
        mode: 'cache',
        cacheDir: dir,
        server: 'https://tx.fhir.org/r4',
        fhirVersion: '4.0.1',
      });
      expect(result.source).toBe('tx-cache');
      expect(result.codeSystem.version).toBe('2.82');
      expect(result.codeSystem.status).toBe('active');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('recognizes optional CodeSystem metadata misses without matching unrelated terminology failures', () => {
    expect(isOptionalCodeSystemMetadataMiss(
      new Error('Terminology server https://tx.fhir.org/r4/CodeSystem?url=https%3A%2F%2Fcodesystem.x12.org%2F005010%2F1365 returned an uncacheable response: Refusing to cache terminology response for CodeSystem?url: expected at least one matching CodeSystem entry, got 0'),
      'online',
    )).toBe(true);
    expect(isOptionalCodeSystemMetadataMiss(
      new Error('Missing terminology cache entry: input/tx-cache/CodeSystem?url/sha256-example.json'),
      'cache',
    )).toBe(true);
    expect(isOptionalCodeSystemMetadataMiss(
      new Error('Terminology server https://tx.fhir.org/r4/ValueSet/$expand failed: HTTP 500'),
      'online',
    )).toBe(false);
    expect(isOptionalCodeSystemMetadataMiss(
      new Error('Missing terminology cache entry: input/tx-cache/CodeSystem?url/sha256-example.json'),
      'online',
    )).toBe(false);
  });

  test('classifies local explicit concepts as locally expandable', () => {
    const vs = {
      resourceType: 'ValueSet',
      url: 'https://example.org/ValueSet/local',
      compose: {
        include: [
          { system: localCodeSystem.url, concept: [{ code: 'a' }] },
        ],
      },
    };

    expect(classifyValueSet(vs, [localCodeSystem, vs]).kind).toBe('local-extensional');
    expect(() => assertValueSetExpansionSupported([localCodeSystem, vs])).not.toThrow();
  });

  test('allows explicit external concept lists without pretending to validate them', () => {
    const vs = {
      resourceType: 'ValueSet',
      url: 'https://example.org/ValueSet/external',
      compose: {
        include: [
          { system: 'http://snomed.info/sct', concept: [{ code: '25064002', display: 'Headache' }] },
        ],
      },
    };

    const classification = classifyValueSet(vs, [vs]);
    expect(classification.kind).toBe('external-extensional');
    expect(classification.reasons[0]).toContain('without a complete local CodeSystem http://snomed.info/sct');
    expect(() => assertValueSetExpansionSupported([vs])).not.toThrow();
  });

  test('rejects filters without terminology service support', () => {
    const vs = {
      resourceType: 'ValueSet',
      url: 'https://example.org/ValueSet/filter',
      compose: {
        include: [
          { system: 'http://snomed.info/sct', filter: [{ property: 'concept', op: 'is-a', value: '404684003' }] },
        ],
      },
    };

    expect(classifyValueSet(vs, [vs]).kind).toBe('unsupported-without-tx');
    expect(() => assertValueSetExpansionSupported([vs])).toThrow('uses filter');
  });

  test('expands nested local valueSet imports', () => {
    const child = {
      resourceType: 'ValueSet',
      url: 'https://example.org/ValueSet/child',
      compose: {
        include: [
          { system: localCodeSystem.url, concept: [{ code: 'a' }] },
        ],
      },
    };
    const vs = {
      resourceType: 'ValueSet',
      url: 'https://example.org/ValueSet/nested',
      compose: {
        include: [
          { valueSet: [child.url] },
          { system: localCodeSystem.url, concept: [{ code: 'b' }] },
        ],
      },
    };

    expect(classifyValueSet(vs, [localCodeSystem, child, vs]).kind).toBe('local-extensional');
    expect(expandValueSet(vs, [localCodeSystem, child, vs]).map((c) => c.code)).toEqual(['a', 'b']);
    expect(() => assertValueSetExpansionSupported([localCodeSystem, child, vs])).not.toThrow();
  });

  test('expands whole-system includes for available complete CodeSystems', () => {
    const nestedCodeSystem = {
      ...localCodeSystem,
      concept: [
        { code: 'a', display: 'A' },
        { code: 'b', display: 'B', concept: [{ code: 'b1', display: 'B one' }] },
      ],
    };
    const vs = {
      resourceType: 'ValueSet',
      url: 'https://example.org/ValueSet/whole-system',
      compose: {
        include: [
          { system: nestedCodeSystem.url },
        ],
      },
    };

    expect(classifyValueSet(vs, [nestedCodeSystem, vs]).kind).toBe('local-extensional');
    expect(expandValueSet(vs, [nestedCodeSystem, vs])).toEqual([
      { system: nestedCodeSystem.url, version: null, code: 'a', display: 'A' },
      { system: nestedCodeSystem.url, version: null, code: 'b', display: 'B' },
      { system: nestedCodeSystem.url, version: null, code: 'b1', display: 'B one' },
    ]);
  });

  test('classifies whole-system includes without expanding past the configured local limit', async () => {
    const codeSystem = {
      ...localCodeSystem,
      concept: [
        { code: 'a', display: 'A' },
        { code: 'b', display: 'B' },
        { code: 'c', display: 'C' },
      ],
    };
    const vs = {
      resourceType: 'ValueSet',
      id: 'whole-system',
      url: 'https://example.org/ValueSet/whole-system',
      compose: {
        include: [
          { system: codeSystem.url },
        ],
      },
    };
    const options = {
      mode: 'local' as const,
      cacheDir: '/tmp/cache',
      server: 'https://tx.example.org/r4',
      fhirVersion: '4.0.1',
      maxExpansionCodes: 2,
    };

    expect(valueSetStrategySummaries([codeSystem, vs], options)).toEqual([{
      ref: 'ValueSet/whole-system',
      url: 'https://example.org/ValueSet/whole-system',
      classification: 'local-extensional',
      reasons: ['all includes expand from available complete CodeSystems and available ValueSets'],
      expansion: { mode: 'local', status: 'not-requested', maxExpansionCodes: 2 },
    }]);
    await expect(prepareValueSetExpansions([vs], options, [codeSystem, vs])).rejects.toThrow('above PUBLISHER_TX_MAX_CODES=2');
  });

  test('requires terminology support for unavailable whole-system includes', () => {
    const vs = {
      resourceType: 'ValueSet',
      url: 'https://example.org/ValueSet/unavailable-system',
      compose: {
        include: [
          { system: 'http://snomed.info/sct' },
        ],
      },
    };

    expect(classifyValueSet(vs, [vs])).toEqual({
      kind: 'unsupported-without-tx',
      reasons: ['https://example.org/ValueSet/unavailable-system.compose.include[0]: whole-system include for http://snomed.info/sct is not available locally'],
    });
    expect(() => assertValueSetExpansionSupported([vs])).toThrow('whole-system include');
  });

  test('rejects whole-system includes for incomplete CodeSystems', () => {
    const fragmentSystem = { ...localCodeSystem, content: 'fragment' };
    const vs = {
      resourceType: 'ValueSet',
      url: 'https://example.org/ValueSet/fragment-whole-system',
      compose: {
        include: [
          { system: fragmentSystem.url },
        ],
      },
    };

    expect(classifyValueSet(vs, [fragmentSystem, vs]).kind).toBe('unsupported-without-tx');
    expect(() => assertValueSetExpansionSupported([fragmentSystem, vs])).toThrow('content=fragment');
  });

  test('expands current ValueSets against package/resource context without emitting imported ValueSet rows', async () => {
    const packageCodeSystem = {
      resourceType: 'CodeSystem',
      url: 'https://package.example.org/CodeSystem/package',
      content: 'complete',
      concept: [
        { code: 'pkg-a', display: 'Package A' },
      ],
    };
    const packageValueSet = {
      resourceType: 'ValueSet',
      id: 'package-child',
      url: 'https://package.example.org/ValueSet/package-child',
      compose: {
        include: [
          { system: packageCodeSystem.url, concept: [{ code: 'pkg-a' }] },
        ],
      },
    };
    const currentValueSet = {
      resourceType: 'ValueSet',
      id: 'current-parent',
      url: 'https://current.example.org/ValueSet/current-parent',
      compose: {
        include: [
          { valueSet: [packageValueSet.url] },
        ],
      },
    };
    const options = {
      mode: 'local' as const,
      cacheDir: '/tmp/cache',
      server: 'https://tx.example.org/r4',
      fhirVersion: '4.0.1',
      maxExpansionCodes: 100,
    };
    const context = terminologyResourceContext([currentValueSet, packageValueSet, packageCodeSystem]);

    expect(classifyValueSet(currentValueSet, [currentValueSet]).kind).toBe('unsupported-without-tx');
    expect(classifyValueSet(currentValueSet, context).kind).toBe('local-extensional');

    const expansions = await prepareValueSetExpansions([currentValueSet], options, context);
    expect([...expansions.keys()]).toEqual(['ValueSet/current-parent']);
    expect(expansions.get('ValueSet/current-parent')?.codes).toEqual([
      { system: packageCodeSystem.url, version: null, code: 'pkg-a', display: 'Package A' },
    ]);
  });

  test('applies explicit excludes as set subtraction', () => {
    const vs = {
      resourceType: 'ValueSet',
      url: 'https://example.org/ValueSet/exclude',
      compose: {
        include: [
          { system: localCodeSystem.url, concept: [{ code: 'a' }, { code: 'b' }] },
        ],
        exclude: [
          { system: localCodeSystem.url, concept: [{ code: 'b' }] },
        ],
      },
    };

    expect(classifyValueSet(vs, [localCodeSystem, vs]).kind).toBe('local-extensional');
    expect(expandValueSet(vs, [localCodeSystem, vs]).map((c) => c.code)).toEqual(['a']);
    expect(() => assertValueSetExpansionSupported([localCodeSystem, vs])).not.toThrow();
  });

  test('rejects missing nested valueSet imports', () => {
    const vs = {
      resourceType: 'ValueSet',
      url: 'https://example.org/ValueSet/missing',
      compose: {
        include: [
          { valueSet: ['https://example.org/ValueSet/other'] },
        ],
      },
    };

    expect(classifyValueSet(vs, [vs]).kind).toBe('unsupported-without-tx');
    expect(() => assertValueSetExpansionSupported([vs])).toThrow('not available locally');
  });

  test('rejects recursive nested valueSet imports', () => {
    const a = {
      resourceType: 'ValueSet',
      url: 'https://example.org/ValueSet/a',
      compose: { include: [{ valueSet: ['https://example.org/ValueSet/b'] }] },
    };
    const b = {
      resourceType: 'ValueSet',
      url: 'https://example.org/ValueSet/b',
      compose: { include: [{ valueSet: ['https://example.org/ValueSet/a'] }] },
    };

    expect(classifyValueSet(a, [a, b]).kind).toBe('unsupported-without-tx');
    expect(() => assertValueSetExpansionSupported([a, b])).toThrow('recursive ValueSet import cycle');
  });

  test('uses explicit concepts from incomplete CodeSystems without treating them as complete', () => {
    const fragmentSystem = { ...localCodeSystem, content: 'fragment' };
    const vs = {
      resourceType: 'ValueSet',
      url: 'https://example.org/ValueSet/fragment',
      compose: {
        include: [
          { system: fragmentSystem.url, concept: [{ code: 'a' }] },
        ],
      },
    };

    expect(classifyValueSet(vs, [fragmentSystem, vs])).toEqual({
      kind: 'external-extensional',
      reasons: ['explicit concept list from system without a complete local CodeSystem https://example.org/CodeSystem/local'],
    });
    expect(expandValueSet(vs, [fragmentSystem, vs])).toEqual([
      { system: fragmentSystem.url, version: null, code: 'a', display: 'A' },
    ]);
  });

  test('summarizes ValueSet strategy without expanding when terminology mode is off', () => {
    const local = {
      resourceType: 'ValueSet',
      id: 'local',
      url: 'https://example.org/ValueSet/local',
      name: 'LocalVS',
      compose: {
        include: [
          { system: localCodeSystem.url, concept: [{ code: 'a' }] },
        ],
      },
    };
    const filtered = {
      resourceType: 'ValueSet',
      id: 'filtered',
      url: 'https://example.org/ValueSet/filtered',
      compose: {
        include: [
          { system: 'http://snomed.info/sct', filter: [{ property: 'concept', op: 'is-a', value: '404684003' }] },
        ],
      },
    };

    expect(valueSetStrategySummaries([localCodeSystem, local, filtered], { mode: 'off', maxExpansionCodes: 100 })).toEqual([
      {
        ref: 'ValueSet/filtered',
        url: 'https://example.org/ValueSet/filtered',
        classification: 'unsupported-without-tx',
        reasons: ['https://example.org/ValueSet/filtered.compose.include[0]: include for http://snomed.info/sct uses filter'],
        expansion: { mode: 'off', status: 'not-requested', maxExpansionCodes: 100 },
      },
      {
        ref: 'ValueSet/local',
        url: 'https://example.org/ValueSet/local',
        name: 'LocalVS',
        classification: 'local-extensional',
        reasons: ['all includes expand from available complete CodeSystems and available ValueSets'],
        expansion: { mode: 'off', status: 'not-requested', maxExpansionCodes: 100 },
      },
    ]);
  });

  test('cache mode fails clearly when a terminology expansion is required but absent', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tx-cache-miss-'));
    const vs = {
      resourceType: 'ValueSet',
      id: 'filter',
      url: 'https://example.org/ValueSet/filter',
      compose: {
        include: [
          { system: 'http://snomed.info/sct', filter: [{ property: 'concept', op: 'is-a', value: '404684003' }] },
        ],
      },
    };
    try {
      await expect(prepareValueSetExpansions([vs], {
        mode: 'cache',
        cacheDir: dir,
        server: 'https://tx.example.org/r4',
        fhirVersion: '4.0.1',
        maxExpansionCodes: 100,
      })).rejects.toThrow('Missing terminology cache entry');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('cache mode uses a reviewed terminology expansion for filters', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tx-cache-hit-'));
    const vs = {
      resourceType: 'ValueSet',
      id: 'filter',
      url: 'https://example.org/ValueSet/filter',
      compose: {
        include: [
          { system: 'http://snomed.info/sct', filter: [{ property: 'concept', op: 'is-a', value: '404684003' }] },
        ],
      },
    };
    const options = {
      mode: 'cache' as const,
      cacheDir: dir,
      server: 'https://tx.example.org/r4',
      fhirVersion: '4.0.1',
      maxExpansionCodes: 100,
    };
    try {
      writeTxCache(dir, valueSetExpandRequest(vs, options), {
        resourceType: 'ValueSet',
        expansion: {
          contains: [
            { system: 'http://snomed.info/sct', code: '25064002', display: 'Headache' },
          ],
        },
      });
      const expansions = await prepareValueSetExpansions([vs], options);
      expect(expansions.get('ValueSet/filter')?.source).toBe('tx-cache');
      expect(expansions.get('ValueSet/filter')?.codes).toEqual([
        { system: 'http://snomed.info/sct', version: null, code: '25064002', display: 'Headache' },
      ]);
      expect(valueSetStrategySummaries([vs], options, expansions)[0]).toMatchObject({
        ref: 'ValueSet/filter',
        classification: 'unsupported-without-tx',
        expansion: { mode: 'cache', status: 'expanded', source: 'tx-cache', codeCount: 1, maxExpansionCodes: 100 },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('expansion cache key ignores generated non-semantic metadata', () => {
    const base = {
      resourceType: 'ValueSet',
      id: 'external',
      url: 'https://example.org/ValueSet/external',
      compose: {
        include: [
          { system: 'http://snomed.info/sct', concept: [{ code: '25064002', display: 'Headache' }] },
        ],
      },
    };
    const options = {
      mode: 'cache' as const,
      cacheDir: '/tmp/cache',
      server: 'https://tx.example.org/r4',
      fhirVersion: '4.0.1',
      maxExpansionCodes: 100,
    };
    const a = valueSetExpandRequest({ ...base, date: '2026-01-01', text: { status: 'generated', div: '<div />' } }, options);
    const b = valueSetExpandRequest({ ...base, date: '2026-06-01', text: { status: 'generated', div: '<div>changed</div>' } }, options);
    expect(txRequestKey(a)).toBe(txRequestKey(b));
  });

  test('validate-code cache key ignores generated non-semantic ValueSet metadata', () => {
    const base = {
      resourceType: 'ValueSet',
      id: 'external',
      url: 'https://example.org/ValueSet/external',
      compose: {
        include: [
          { system: 'http://snomed.info/sct', concept: [{ code: '25064002', display: 'Headache' }] },
        ],
      },
    };
    const options = {
      mode: 'cache' as const,
      cacheDir: '/tmp/cache',
      server: 'https://tx.example.org/r4',
      fhirVersion: '4.0.1',
      maxExpansionCodes: 100,
    };
    const input = { system: 'http://snomed.info/sct', code: '25064002', valueSet: base };
    const a = valueSetValidateCodeRequest({
      ...input,
      valueSet: { ...base, date: '2026-01-01', text: { status: 'generated', div: '<div />' } },
    }, options);
    const b = valueSetValidateCodeRequest({
      ...input,
      valueSet: { ...base, date: '2026-06-01', text: { status: 'generated', div: '<div>changed</div>' } },
    }, options);
    expect(txRequestKey(a)).toBe(txRequestKey(b));
  });

  test('builds standard ValueSet and CodeSystem validate-code requests', () => {
    const options = {
      mode: 'cache' as const,
      cacheDir: '/tmp/cache',
      server: 'https://tx.example.org/r4/',
      fhirVersion: '4.0.1',
      maxExpansionCodes: 100,
    };
    expect(valueSetValidateCodeRequest({
      valueSetUrl: 'https://example.org/ValueSet/symptoms',
      valueSetVersion: '2026',
      system: 'http://snomed.info/sct',
      systemVersion: '20250101',
      code: '25064002',
      display: 'Headache',
    }, options)).toMatchObject({
      operation: 'ValueSet/$validate-code',
      server: 'https://tx.example.org/r4',
      parameters: {
        resourceType: 'Parameters',
        parameter: [
          { name: 'url', valueUri: 'https://example.org/ValueSet/symptoms' },
          { name: 'valueSetVersion', valueString: '2026' },
          { name: 'system', valueUri: 'http://snomed.info/sct' },
          { name: 'systemVersion', valueString: '20250101' },
          { name: 'code', valueCode: '25064002' },
          { name: 'display', valueString: 'Headache' },
        ],
      },
    });

    expect(codeSystemValidateCodeRequest({
      codeSystemUrl: 'http://snomed.info/sct',
      version: '20250101',
      code: '25064002',
      display: 'Headache',
    }, options)).toMatchObject({
      operation: 'CodeSystem/$validate-code',
      server: 'https://tx.example.org/r4',
      parameters: {
        resourceType: 'Parameters',
        parameter: [
          { name: 'url', valueUri: 'http://snomed.info/sct' },
          { name: 'version', valueString: '20250101' },
          { name: 'code', valueCode: '25064002' },
          { name: 'display', valueString: 'Headache' },
        ],
      },
    });
  });

  test('parses cached validate-code results and preserves false as a real result', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tx-validate-cache-hit-'));
    const options = {
      mode: 'cache' as const,
      cacheDir: dir,
      server: 'https://tx.example.org/r4',
      fhirVersion: '4.0.1',
      maxExpansionCodes: 100,
    };
    const input = {
      valueSetUrl: 'https://example.org/ValueSet/symptoms',
      system: 'http://snomed.info/sct',
      code: 'not-a-code',
    };
    try {
      writeTxCache(dir, valueSetValidateCodeRequest(input, options), {
        resourceType: 'Parameters',
        parameter: [
          { name: 'result', valueBoolean: false },
          { name: 'message', valueString: 'Unknown code' },
        ],
      });
      const result = await validateValueSetCode(input, options);
      expect(result).toMatchObject({
        result: false,
        message: 'Unknown code',
        source: 'tx-cache',
      });
      expect(result.cachePath).toContain('ValueSet-validate-code');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('validate-code result parser rejects non-Parameters responses', () => {
    expect(() => validateCodeResultFromParameters({ resourceType: 'ValueSet', expansion: {} })).toThrow('expected Parameters');
    expect(() => validateCodeResultFromParameters({ resourceType: 'Parameters', parameter: [] })).toThrow('boolean result');
  });
});
