import { describe, expect, test } from 'bun:test';
import type { CanonicalIndex, IndexedResource } from './canonical';
import {
  additionalBindingValueSetUrls,
  deriveIndexedListRows,
  externalValueSetWeb,
  implicitValueSetForUrl,
  packageSourceLabel,
  questionnaireAnswerValueSetUrlOccurrences,
  questionnaireAnswerValueSetUrls,
  sourceForSystem,
  structureDefinitionBindingValueSetUrls,
  valueSetSystemSource,
} from './indexed-lists';

function emptyIndex(): CanonicalIndex {
  return {
    byCanonical: new Map(),
    byCodeSystemUrl: new Map(),
    byNamingSystemUri: new Map(),
    packages: [],
  };
}

function indexedCodeSystem(url: string, packageName: string): IndexedResource {
  return {
    key: { resourceType: 'CodeSystem', url },
    package: { name: packageName, version: '1.0.0' },
    sourcePath: `/packages/${packageName}/CodeSystem.json`,
    resource: { resourceType: 'CodeSystem', url },
  };
}

function indexedNamingSystem(uri: string, packageName: string): IndexedResource {
  return {
    key: { resourceType: 'NamingSystem', url: uri },
    package: { name: packageName, version: '1.0.0' },
    sourcePath: `/packages/${packageName}/NamingSystem.json`,
    resource: { resourceType: 'NamingSystem', uniqueId: [{ type: 'uri', value: uri }] },
  };
}

function indexedValueSetSource(packageName: string, version: string, manifest: Record<string, any> = {}): IndexedResource {
  return {
    key: { resourceType: 'ValueSet', url: 'http://example.org/ValueSet/source' },
    package: {
      name: packageName,
      version,
      manifest,
      dir: `/packages/${packageName}#${version}/package`,
      acquisition: { source: 'cache', packageDir: '' },
      resolution: { role: 'ambient', loadDependencies: false },
    },
    sourcePath: `/packages/${packageName}/ValueSet.json`,
    resource: { resourceType: 'ValueSet', url: 'http://example.org/ValueSet/source' },
  };
}

function indexedValueSet(valueSet: Record<string, any>, packageName = 'hl7.fhir.r4.core'): IndexedResource {
  return {
    key: { resourceType: 'ValueSet', url: valueSet.url, version: valueSet.version },
    package: { name: packageName, version: '1.0.0' },
    sourcePath: `/packages/${packageName}/${valueSet.id || 'ValueSet'}.json`,
    resource: valueSet,
  };
}

describe('publisher list-index helpers', () => {
  test('uses Publisher-style source labels without treating them as terminology semantics', () => {
    expect(valueSetSystemSource('http://snomed.info/sct')).toBe('SCT');
    expect(valueSetSystemSource('http://loinc.org')).toBe('LOINC');
    expect(valueSetSystemSource('http://dicom.nema.org/resources/ontology/DCM')).toBe('DICOM');
    expect(valueSetSystemSource('http://dicom.nema.org/other')).toBe('Other');
    expect(valueSetSystemSource('http://unitsofmeasure.org')).toBe('UCUM');
    expect(valueSetSystemSource('http://www.nlm.nih.gov/research/umls/rxnorm')).toBe('RxNorm');
    expect(valueSetSystemSource('http://terminology.hl7.org/CodeSystem/v2-0203')).toBe('THO (V2)');
    expect(valueSetSystemSource('http://terminology.hl7.org/CodeSystem/v3-ActCode')).toBe('THO (V3)');
    expect(valueSetSystemSource('http://terminology.hl7.org/CodeSystem/observation-category')).toBe('THO');
    expect(valueSetSystemSource('https://example.org/v2-local')).toBe('Other');
    expect(valueSetSystemSource('http://hl7.org/fhir/sid/icd-10-cm')).toBe('FHIR');
    expect(valueSetSystemSource('http://hl7.org/fhir/sid/icd-10-cm', new Set(), 'hl7.fhir.r4.core')).toBe('hl7.fhir.r4.core');
    expect(valueSetSystemSource('https://example.org/external', new Set(), 'example.package')).toBe('example.package');
    expect(valueSetSystemSource('https://example.org/CodeSystem/local', new Set(['https://example.org/CodeSystem/local']))).toBe('Internal');
    expect(valueSetSystemSource('http://snomed.info/sct', new Set(['http://snomed.info/sct']), 'example.package')).toBe('Internal');
    expect(valueSetSystemSource('http://terminology.hl7.org/CodeSystem/v3-ActCode', new Set(), 'example.package')).toBe('THO (V3)');
  });

  test('derives package source labels from CodeSystems but not NamingSystem URI aliases', () => {
    const core = emptyIndex();
    const dependencies = emptyIndex();
    dependencies.byCodeSystemUrl.set('urn:ietf:bcp:47', indexedCodeSystem('urn:ietf:bcp:47', 'hl7.terminology.r4'));
    dependencies.byNamingSystemUri.set('urn:oid:2.16.840.1.113883.6.96', indexedNamingSystem('urn:oid:2.16.840.1.113883.6.96', 'hl7.terminology.r4'));

    const label = sourceForSystem({ core, dependencies }, new Set());
    expect(label('urn:ietf:bcp:47')).toBe('hl7.terminology.r4');
    expect(label('urn:oid:2.16.840.1.113883.6.96')).toBe('Other');
  });

  test('uses FHIR core as the package source for FHIR-owned systems before xver copies', () => {
    const core = emptyIndex();
    const dependencies = emptyIndex();
    const system = 'http://hl7.org/fhir/administrative-gender';
    core.byCodeSystemUrl.set(system, indexedCodeSystem(system, 'hl7.fhir.r4.core'));
    dependencies.byCodeSystemUrl.set(system, indexedCodeSystem(system, 'hl7.fhir.uv.xver-r5.r4'));

    expect(sourceForSystem({ core, dependencies }, new Set())(system)).toBe('hl7.fhir.r4.core');
  });

  test('normalizes known core package source labels across FHIR versions', () => {
    const core = emptyIndex();
    const dependencies = emptyIndex();
    core.byCodeSystemUrl.set('http://r3.example', indexedCodeSystem('http://r3.example', 'hl7.fhir.r3.core'));
    core.byCodeSystemUrl.set('http://r4b.example', indexedCodeSystem('http://r4b.example', 'hl7.fhir.r4b.core'));
    core.byCodeSystemUrl.set('http://r6.example', indexedCodeSystem('http://r6.example', 'hl7.fhir.r6.core'));
    dependencies.byCodeSystemUrl.set('http://tx-r5.example', indexedCodeSystem('http://tx-r5.example', 'hl7.terminology.r5'));
    dependencies.byCodeSystemUrl.set('http://tx-r6.example', indexedCodeSystem('http://tx-r6.example', 'hl7.terminology.r6'));

    expect(packageSourceLabel({ core, dependencies }, 'http://r3.example')).toBe('hl7.fhir.r3.core');
    expect(packageSourceLabel({ core, dependencies }, 'http://r4b.example')).toBe('hl7.fhir.r4b.core');
    expect(packageSourceLabel({ core, dependencies }, 'http://r6.example')).toBe('hl7.fhir.r6.core');
    expect(packageSourceLabel({ core, dependencies }, 'http://tx-r5.example')).toBe('hl7.terminology.r5');
    expect(packageSourceLabel({ core, dependencies }, 'http://tx-r6.example')).toBe('hl7.terminology.r6');
  });

  test('extracts primary and additional binding ValueSet URLs', () => {
    const additionalBinding = {
      url: 'http://hl7.org/fhir/tools/StructureDefinition/additional-binding',
      extension: [
        { url: 'purpose', valueCode: 'maximum' },
        { url: 'valueSet', valueCanonical: 'http://example.org/ValueSet/additional|1.0.0' },
      ],
    };
    const binding = {
      strength: 'preferred',
      valueSet: 'http://example.org/ValueSet/primary|1.0.0',
      extension: [additionalBinding],
    };
    expect(additionalBindingValueSetUrls(binding)).toEqual(['http://example.org/ValueSet/additional']);

    const sd = {
      resourceType: 'StructureDefinition',
      snapshot: { element: [{ id: 'Observation.code', binding }] },
      differential: { element: [] },
    };
    expect(structureDefinitionBindingValueSetUrls(sd, 'snapshot')).toEqual([
      'http://example.org/ValueSet/primary',
      'http://example.org/ValueSet/additional',
    ]);
  });

  test('extracts nested Questionnaire answer ValueSet URLs', () => {
    const questionnaire = {
      resourceType: 'Questionnaire',
      item: [
        { answerValueSet: 'http://example.org/ValueSet/root|1.0.0' },
        { answerValueSet: 'http://example.org/ValueSet/root|1.0.0' },
        { answerValueSet: '#contained' },
        { item: [{ answerValueSet: 'http://example.org/ValueSet/child' }] },
      ],
    };
    expect(questionnaireAnswerValueSetUrlOccurrences(questionnaire)).toEqual([
      'http://example.org/ValueSet/root',
      'http://example.org/ValueSet/root',
      'http://example.org/ValueSet/child',
    ]);
    expect(questionnaireAnswerValueSetUrls(questionnaire)).toEqual([
      'http://example.org/ValueSet/child',
      'http://example.org/ValueSet/root',
    ]);
  });

  test('matches Publisher implicit ValueSet metadata for common terminology URLs', () => {
    expect(implicitValueSetForUrl('http://loinc.org/vs/LL1-9')).toMatchObject({
      resourceType: 'ValueSet',
      url: 'http://loinc.org/vs/LL1-9',
      status: 'active',
      name: 'LOINCAnswersLL1-9',
      title: 'LOINC Answer Codes for LL1-9',
      compose: { include: [{ system: 'http://loinc.org', filter: [{ property: 'LIST', op: '=', value: 'LL1-9' }] }] },
    });
    expect(implicitValueSetForUrl('http://snomed.info/sct?fhir_vs')).toMatchObject({
      resourceType: 'ValueSet',
      url: 'http://snomed.info/sct?fhir_vs',
      status: 'active',
      name: 'SCTValueSetAll',
      title: 'All Codes SCT ValueSet',
      description: 'Value Set for All SNOMED CT Concepts',
      compose: { include: [{ system: 'http://snomed.info/sct' }] },
    });
  });

  test('uses the source FHIR core package when building external ValueSet links', () => {
    expect(externalValueSetWeb(
      { resourceType: 'ValueSet', id: 'observation-codes', url: 'http://hl7.org/fhir/ValueSet/observation-codes' },
      indexedValueSetSource('hl7.fhir.r4.core', '4.0.1', { url: 'http://hl7.org/fhir/R4' }),
    )).toBe('http://hl7.org/fhir/R4/valueset-observation-codes.html');

    expect(externalValueSetWeb(
      { resourceType: 'ValueSet', id: 'observation-codes', url: 'http://hl7.org/fhir/ValueSet/observation-codes' },
      indexedValueSetSource('hl7.fhir.r5.core', '5.0.0', { url: 'http://hl7.org/fhir/R5/' }),
    )).toBe('http://hl7.org/fhir/R5/valueset-observation-codes.html');

    expect(externalValueSetWeb(
      { resourceType: 'ValueSet', id: 'v3-ActCode', url: 'http://terminology.hl7.org/ValueSet/v3-ActCode' },
      indexedValueSetSource('hl7.fhir.r4b.core', '4.3.0', { url: 'http://hl7.org/fhir/R4B' }),
    )).toBe('http://hl7.org/fhir/R4B/v3/ActCode/vs.html');

    expect(externalValueSetWeb(
      { resourceType: 'ValueSet', id: 'v2-0203', url: 'http://terminology.hl7.org/ValueSet/v2-0203' },
      indexedValueSetSource('hl7.fhir.r6.core', '6.0.0-ballot3'),
    )).toBe('http://hl7.org/fhir/6.0.0-ballot3/v2/0203/index.html');
  });

  test('derives indexed ValueSet and CodeSystem list rows without SQLite', () => {
    const codeSystem = {
      resourceType: 'CodeSystem',
      id: 'cycle',
      url: 'http://example.org/CodeSystem/cycle',
      version: '1.0.0',
      name: 'CycleCodes',
      identifier: [{ system: 'urn:ietf:rfc:3986', value: 'urn:oid:1.2.3' }],
    };
    const valueSet = {
      resourceType: 'ValueSet',
      id: 'flow',
      url: 'http://example.org/ValueSet/flow',
      version: '1.0.0',
      name: 'Flow',
      compose: { include: [{ system: codeSystem.url, concept: [{ code: 'light' }] }] },
    };
    const profile = {
      resourceType: 'StructureDefinition',
      id: 'flow-profile',
      url: 'http://example.org/StructureDefinition/flow-profile',
      differential: { element: [{ id: 'Observation.value', binding: { valueSet: valueSet.url } }] },
      snapshot: { element: [{ id: 'Observation.value', binding: { valueSet: valueSet.url } }] },
    };
    const resources = [codeSystem, valueSet, profile];
    const current = emptyIndex();
    current.byCanonical.set('CodeSystem|http://example.org/CodeSystem/cycle', {
      key: { resourceType: 'CodeSystem', url: codeSystem.url },
      sourcePath: 'current:CodeSystem/cycle',
      resource: codeSystem,
    });
    const rows = deriveIndexedListRows(
      resources,
      new Map([
        ['CodeSystem/cycle', 1],
        ['ValueSet/flow', 2],
        ['StructureDefinition/flow-profile', 3],
      ]),
      { current, core: emptyIndex(), dependencies: emptyIndex() },
    );

    expect(rows.valueSetRows.map((row) => [row.key, row.viewType, row.resourceKey, row.url])).toEqual([
      [1, 1, 2, valueSet.url],
      [2, 2, 2, valueSet.url],
      [3, 3, 2, valueSet.url],
    ]);
    expect(rows.valueSetRefRows).toEqual([
      {
        valueSetListKey: 2,
        type: 'StructureDefinition',
        id: 'flow-profile',
        resourceKey: 3,
        title: 'flow-profile',
        web: 'StructureDefinition-flow-profile.html',
      },
      {
        valueSetListKey: 3,
        type: 'StructureDefinition',
        id: 'flow-profile',
        resourceKey: 3,
        title: 'flow-profile',
        web: 'StructureDefinition-flow-profile.html',
      },
    ]);
    expect(rows.valueSetSystemRows).toEqual([
      { valueSetListKey: 1, url: codeSystem.url },
      { valueSetListKey: 2, url: codeSystem.url },
      { valueSetListKey: 3, url: codeSystem.url },
    ]);
    expect(rows.valueSetSourceRows).toEqual([
      { valueSetListKey: 1, source: 'Internal' },
      { valueSetListKey: 2, source: 'Internal' },
      { valueSetListKey: 3, source: 'Internal' },
    ]);
    expect(rows.codeSystemRows.map((row) => [row.key, row.viewType, row.resourceKey, row.url])).toEqual([
      [1, 1, 1, codeSystem.url],
      [2, 2, 1, codeSystem.url],
      [3, 3, 1, codeSystem.url],
    ]);
    expect(rows.codeSystemOidRows).toEqual([
      { codeSystemListKey: 1, oid: '1.2.3' },
      { codeSystemListKey: 2, oid: '1.2.3' },
      { codeSystemListKey: 3, oid: '1.2.3' },
    ]);
  });

  test('adds local oids.ini assignments to local list rows only', () => {
    const localValueSet = {
      resourceType: 'ValueSet',
      id: 'local-values',
      url: 'http://example.org/ValueSet/local-values',
      compose: { include: [{ system: 'http://example.org/CodeSystem/local-codes' }] },
    };
    const localCodeSystem = {
      resourceType: 'CodeSystem',
      id: 'local-codes',
      url: 'http://example.org/CodeSystem/local-codes',
    };
    const resources = [localCodeSystem, localValueSet];
    const current = emptyIndex();
    current.byCanonical.set('CodeSystem|http://example.org/CodeSystem/local-codes', {
      key: { resourceType: 'CodeSystem', url: localCodeSystem.url },
      sourcePath: 'current:CodeSystem/local-codes',
      resource: localCodeSystem,
    });
    const oidAssignments = new Map([
      ['CodeSystem', new Map([['local-codes', '1.2.3.16.1']])],
      ['ValueSet', new Map([['local-values', '1.2.3.48.1']])],
    ]);

    const rows = deriveIndexedListRows(
      resources,
      new Map([
        ['CodeSystem/local-codes', 1],
        ['ValueSet/local-values', 2],
      ]),
      { current, core: emptyIndex(), dependencies: emptyIndex() },
      { oidAssignments },
    );

    expect(rows.valueSetOidRows).toEqual([
      { valueSetListKey: 1, oid: '1.2.3.48.1' },
      { valueSetListKey: 2, oid: '1.2.3.48.1' },
      { valueSetListKey: 3, oid: '1.2.3.48.1' },
    ]);
    expect(rows.codeSystemOidRows).toEqual([
      { codeSystemListKey: 1, oid: '1.2.3.16.1' },
      { codeSystemListKey: 2, oid: '1.2.3.16.1' },
      { codeSystemListKey: 3, oid: '1.2.3.16.1' },
    ]);
  });

  test('derives ValueSet refs from Questionnaire answerValueSet fields', () => {
    const valueSet = {
      resourceType: 'ValueSet',
      id: 'answers',
      url: 'http://example.org/ValueSet/answers',
      compose: { include: [{ system: 'http://example.org/CodeSystem/answers' }] },
    };
    const questionnaire = {
      resourceType: 'Questionnaire',
      id: 'survey',
      title: 'Survey',
      item: [{ linkId: 'q1', answerValueSet: valueSet.url }],
    };
    const rows = deriveIndexedListRows(
      [valueSet, questionnaire],
      new Map([
        ['ValueSet/answers', 1],
        ['Questionnaire/survey', 2],
      ]),
      { current: emptyIndex(), core: emptyIndex(), dependencies: emptyIndex() },
    );

    expect(rows.valueSetRefRows).toEqual([
      {
        valueSetListKey: 2,
        type: 'Questionnaire',
        id: 'survey',
        resourceKey: 2,
        title: 'Survey',
        web: 'Questionnaire-survey.html',
      },
      {
        valueSetListKey: 3,
        type: 'Questionnaire',
        id: 'survey',
        resourceKey: 2,
        title: 'Survey',
        web: 'Questionnaire-survey.html',
      },
    ]);
  });

  test('preserves duplicate rows for implicit Questionnaire answer ValueSets', () => {
    const questionnaire = {
      resourceType: 'Questionnaire',
      id: 'survey',
      title: 'Survey',
      item: [
        { linkId: 'q1', answerValueSet: 'http://loinc.org/vs/LL1-9' },
        { linkId: 'q2', answerValueSet: 'http://loinc.org/vs/LL1-9' },
      ],
    };
    const rows = deriveIndexedListRows(
      [questionnaire],
      new Map([['Questionnaire/survey', 1]]),
      { current: emptyIndex(), core: emptyIndex(), dependencies: emptyIndex() },
    );

    expect(rows.valueSetRows.filter((row) => row.viewType === 2).map((row) => [row.url, row.name, row.title])).toEqual([
      ['http://loinc.org/vs/LL1-9', 'LOINCAnswersLL1-9', 'LOINC Answer Codes for LL1-9'],
      ['http://loinc.org/vs/LL1-9', 'LOINCAnswersLL1-9', 'LOINC Answer Codes for LL1-9'],
    ]);
    expect(rows.valueSetRows.filter((row) => row.viewType === 3).map((row) => row.url)).toEqual([
      'http://loinc.org/vs/LL1-9',
      'http://loinc.org/vs/LL1-9',
    ]);
    expect(rows.valueSetRefRows.map((row) => [row.valueSetListKey, row.type, row.id])).toEqual([
      [1, 'Questionnaire', 'survey'],
      [2, 'Questionnaire', 'survey'],
      [3, 'Questionnaire', 'survey'],
      [4, 'Questionnaire', 'survey'],
    ]);
  });

  test('keeps package-resolved Questionnaire answer ValueSets as a single indexed row', () => {
    const valueSet = {
      resourceType: 'ValueSet',
      id: 'administrative-gender',
      url: 'http://hl7.org/fhir/ValueSet/administrative-gender',
      status: 'active',
      compose: { include: [{ system: 'http://hl7.org/fhir/administrative-gender' }] },
    };
    const core = emptyIndex();
    const source = indexedValueSet(valueSet);
    core.byCanonical.set(`ValueSet|${valueSet.url}`, source);
    const questionnaire = {
      resourceType: 'Questionnaire',
      id: 'survey',
      title: 'Survey',
      item: [
        { linkId: 'q1', answerValueSet: valueSet.url },
        { linkId: 'q2', answerValueSet: valueSet.url },
      ],
    };
    const rows = deriveIndexedListRows(
      [questionnaire],
      new Map([['Questionnaire/survey', 1]]),
      { current: emptyIndex(), core, dependencies: emptyIndex() },
    );

    expect(rows.valueSetRows.filter((row) => row.viewType === 2).map((row) => row.url)).toEqual([valueSet.url]);
    expect(rows.valueSetRows.filter((row) => row.viewType === 3).map((row) => row.url)).toEqual([valueSet.url]);
    expect(rows.valueSetRefRows.map((row) => [row.valueSetListKey, row.type, row.id])).toEqual([
      [1, 'Questionnaire', 'survey'],
      [2, 'Questionnaire', 'survey'],
    ]);
  });

  test('indexes direct Questionnaire-contained ValueSets and their imports', () => {
    const bodyWeight = {
      resourceType: 'ValueSet',
      id: 'ucum-bodyweight',
      url: 'http://hl7.org/fhir/ValueSet/ucum-bodyweight',
      status: 'active',
      compose: { include: [{ system: 'http://unitsofmeasure.org' }] },
    };
    const core = emptyIndex();
    core.byCanonical.set(`ValueSet|${bodyWeight.url}`, indexedValueSet(bodyWeight));
    const questionnaire = {
      resourceType: 'Questionnaire',
      id: 'profile-example',
      title: 'Profile Example',
      contained: [
        {
          resourceType: 'ValueSet',
          id: 'WeightUnits',
          name: 'WeightUnits',
          compose: {
            include: [
              { system: 'http://terminology.hl7.org/CodeSystem/data-absent-reason' },
              { valueSet: [bodyWeight.url] },
            ],
          },
        },
        {
          resourceType: 'ValueSet',
          id: 'LL358-3',
          url: 'http://example.org/ValueSet/LL358-3',
          name: 'ContainedAnswerList',
          compose: { include: [{ system: 'http://loinc.org' }] },
        },
      ],
      item: [{ linkId: 'q1', answerValueSet: '#WeightUnits' }],
    };

    const rows = deriveIndexedListRows(
      [questionnaire],
      new Map([['Questionnaire/profile-example', 1]]),
      { current: emptyIndex(), core, dependencies: emptyIndex() },
    );

    expect(rows.valueSetRows.filter((row) => row.viewType === 2).map((row) => [row.url, row.name])).toEqual([
      [null, 'WeightUnits'],
      ['http://example.org/ValueSet/LL358-3', 'ContainedAnswerList'],
      [bodyWeight.url, null],
    ]);
    expect(rows.valueSetRows.filter((row) => row.viewType === 3).map((row) => [row.url, row.name])).toEqual([
      [null, 'WeightUnits'],
      ['http://example.org/ValueSet/LL358-3', 'ContainedAnswerList'],
      [bodyWeight.url, null],
    ]);
    expect(rows.valueSetRefRows).toEqual([
      {
        valueSetListKey: 3,
        type: 'ValueSet',
        id: 'WeightUnits',
        resourceKey: null,
        title: 'WeightUnits',
        web: 'ValueSet-profile-example_WeightUnits.html',
      },
      {
        valueSetListKey: 6,
        type: 'ValueSet',
        id: 'WeightUnits',
        resourceKey: null,
        title: 'WeightUnits',
        web: 'ValueSet-profile-example_WeightUnits.html',
      },
    ]);
  });
});
