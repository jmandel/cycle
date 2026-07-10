import { describe, expect, test } from 'bun:test';
import { deriveCodeSystemPropertyRows, deriveConceptRows, deriveMetadataRows, deriveResourceRows, deriveValueSetCodeRows } from './rows';

describe('package DB row derivation', () => {
  test('derives deterministic metadata rows from explicit inputs', () => {
    const rows = deriveMetadataRows({
      cfg: {
        fhirVersion: '4.0.1',
        canonical: 'https://example.org/ig',
        id: 'example.ig',
        packageId: 'example.package',
        name: 'ExampleIG',
        version: '1.2.3',
        releaseLabel: 'test-build',
      },
      ig: {
        resourceType: 'ImplementationGuide',
        id: 'ig',
        url: 'https://example.org/ig/ImplementationGuide/example.ig',
      },
      now: new Date('2026-06-27T12:34:56Z'),
      branch: 'main',
      revision: 'abc123def0',
    });

    expect(rows.map((row) => [row.key, row.name])).toEqual([
      [1, 'path'],
      [2, 'canonical'],
      [3, 'igId'],
      [4, 'igName'],
      [5, 'packageId'],
      [6, 'igVer'],
      [7, 'errorCount'],
      [8, 'version'],
      [9, 'releaseLabel'],
      [10, 'revision'],
      [11, 'versionFull'],
      [12, 'toolingVersion'],
      [13, 'toolingRevision'],
      [14, 'toolingVersionFull'],
      [15, 'genDate'],
      [16, 'genDay'],
      [17, 'gitstatus'],
    ]);
    const byName = new Map(rows.map((row) => [row.name, row.value]));
    expect(byName.get('path')).toBe('http://hl7.org/fhir/R4/');
    expect(byName.get('canonical')).toBe('https://example.org/ig');
    expect(byName.get('igId')).toBe('example.package');
    expect(byName.get('packageId')).toBe('example.package');
    expect(byName.get('versionFull')).toBe('4.0.1-abc123def0');
    expect(byName.get('gitstatus')).toBe('main');
  });

  test('uses FHIR release publication paths in metadata rows', () => {
    const baseArgs = {
      ig: { resourceType: 'ImplementationGuide', id: 'ig' },
      now: new Date('2026-06-27T12:34:56Z'),
    };

    expect(new Map(deriveMetadataRows({
      ...baseArgs,
      cfg: { fhirVersion: '4.3.0' },
    }).map((row) => [row.name, row.value])).get('path')).toBe('http://hl7.org/fhir/R4B/');

    expect(new Map(deriveMetadataRows({
      ...baseArgs,
      cfg: { fhirVersion: '5.0.0' },
    }).map((row) => [row.name, row.value])).get('path')).toBe('http://hl7.org/fhir/R5/');

    expect(new Map(deriveMetadataRows({
      ...baseArgs,
      cfg: { fhirVersion: '6.0.0-ballot3' },
    }).map((row) => [row.name, row.value])).get('path')).toBe('http://hl7.org/fhir/6.0.0-ballot3/');
  });

  test('derives nested CodeSystem concept rows with stable parent keys', () => {
    const resources = [
      { resourceType: 'ImplementationGuide', id: 'ig' },
      {
        resourceType: 'CodeSystem',
        id: 'cycle',
        concept: [
          {
            code: 'parent',
            display: 'Parent',
            concept: [
              { code: 'child', display: 'Child', definition: 'Nested child' },
            ],
          },
          { code: 'sibling', display: 'Sibling' },
        ],
      },
    ];
    const rows = deriveConceptRows(resources, new Map([['CodeSystem/cycle', 2]]));

    expect(rows).toEqual([
      { key: 1, resourceKey: 2, parentKey: null, code: 'parent', display: 'Parent', definition: null },
      { key: 2, resourceKey: 2, parentKey: 1, code: 'child', display: 'Child', definition: 'Nested child' },
      { key: 3, resourceKey: 2, parentKey: null, code: 'sibling', display: 'Sibling', definition: null },
    ]);
  });

  test('derives CodeSystem property and concept-property rows with concept keys', () => {
    const resources = [
      {
        resourceType: 'CodeSystem',
        id: 'scores',
        property: [
          {
            code: 'itemWeight',
            uri: 'http://hl7.org/fhir/concept-properties#itemWeight',
            type: 'decimal',
          },
        ],
        concept: [
          { code: 'zero', property: [{ code: 'itemWeight', valueDecimal: 0 }] },
          { code: 'one', property: [{ code: 'itemWeight', valueDecimal: 1 }] },
        ],
      },
    ];

    expect(deriveCodeSystemPropertyRows(resources, new Map([['CodeSystem/scores', 7]]))).toEqual({
      propertyRows: [
        {
          key: 1,
          resourceKey: 7,
          code: 'itemWeight',
          uri: 'http://hl7.org/fhir/concept-properties#itemWeight',
          description: null,
          type: 'decimal',
        },
      ],
      conceptPropertyRows: [
        { key: 1, resourceKey: 7, conceptKey: 1, propertyKey: 1, code: 'itemWeight', value: null },
        { key: 2, resourceKey: 7, conceptKey: 2, propertyKey: 1, code: 'itemWeight', value: null },
      ],
    });
  });

  test('derives Resources rows and the resource key map', () => {
    const resources = [
      {
        resourceType: 'ImplementationGuide',
        id: 'demo',
        url: 'http://current.example/ImplementationGuide/demo',
        packageId: 'example.package',
        name: 'DemoIG',
      },
      {
        resourceType: 'StructureDefinition',
        id: 'demo-profile',
        url: 'http://example.org/StructureDefinition/demo-profile',
        version: '1.0.0',
        name: 'DemoProfile',
        status: 'draft',
        date: '2026-01-01',
        experimental: false,
        kind: 'resource',
        type: 'Observation',
        baseDefinition: 'http://example.org/base/StructureDefinition/BaseObservation',
        derivation: 'constraint',
      },
      {
        resourceType: 'Observation',
        id: 'example',
        description: 'Resource description',
      },
      {
        resourceType: 'StructureDefinition',
        id: 'package-profile',
        url: 'http://current.example/StructureDefinition/package-profile',
        name: 'PackageProfile',
        kind: 'resource',
        type: 'Task',
        baseDefinition: 'http://package.example/StructureDefinition/BaseTask',
      },
    ];
    const metadata = new Map([
      ['StructureDefinition/demo-profile', { description: 'Profile from IG manifest' }],
      ['Observation/example', { name: 'Manifest Example', description: 'Manifest description' }],
    ]);

    const result = deriveResourceRows(resources, metadata, {
      canonical: 'http://current.example',
      packageId: 'example.package',
      fhirVersion: ['4.0.1'],
      parameters: { 'pin-canonicals': 'pin-all' },
      dependencies: [
        {
          uri: 'http://example.org/base/ImplementationGuide/base',
          version: '2.0.0',
        },
      ],
      __publisherPackageCanonicalVersions: [
        {
          canonical: 'http://package.example',
          version: '3.0.0',
          candidate: true,
        },
      ],
    });

    expect([...result.keyByRef.entries()]).toEqual([
      ['ImplementationGuide/demo', 1],
      ['StructureDefinition/demo-profile', 2],
      ['Observation/example', 3],
      ['StructureDefinition/package-profile', 4],
    ]);
    expect(result.rows).toEqual([
      expect.objectContaining({
        key: 1,
        type: 'ImplementationGuide',
        id: 'example.package',
        web: 'index.html',
        url: 'http://current.example/ImplementationGuide/example.package',
        name: 'DemoIG',
        json: JSON.stringify(resources[0]),
      }),
      expect.objectContaining({
        key: 2,
        type: 'StructureDefinition',
        id: 'demo-profile',
        web: 'StructureDefinition-demo-profile.html',
        url: 'http://example.org/StructureDefinition/demo-profile',
        version: '1.0.0',
        status: 'draft',
        date: '2026-01-01',
        name: 'DemoProfile',
        experimental: 'false',
        description: null,
        derivation: 'constraint',
        kind: 'resource',
        sdType: 'Observation',
        base: 'http://example.org/base/StructureDefinition/BaseObservation|2.0.0',
        json: JSON.stringify(resources[1]),
      }),
      expect.objectContaining({
        key: 3,
        type: 'Observation',
        id: 'example',
        web: 'Observation-example.html',
        name: 'Manifest Example',
        description: 'Manifest description',
        json: JSON.stringify(resources[2]),
      }),
      expect.objectContaining({
        key: 4,
        type: 'StructureDefinition',
        id: 'package-profile',
        base: 'http://package.example/StructureDefinition/BaseTask|3.0.0',
        json: JSON.stringify(resources[3]),
      }),
    ]);
  });

  test('pins dependency bases for pin-multiples only when multiple choices are known', () => {
    const resources = [
      {
        resourceType: 'StructureDefinition',
        id: 'multiple',
        url: 'http://current.example/StructureDefinition/multiple',
        name: 'Multiple',
        baseDefinition: 'http://family.example/StructureDefinition/Base',
      },
      {
        resourceType: 'StructureDefinition',
        id: 'single',
        url: 'http://current.example/StructureDefinition/single',
        name: 'Single',
        baseDefinition: 'http://single.example/StructureDefinition/Base',
      },
      {
        resourceType: 'StructureDefinition',
        id: 'core',
        url: 'http://current.example/StructureDefinition/core',
        name: 'Core',
        baseDefinition: 'http://hl7.org/fhir/StructureDefinition/Observation',
      },
    ];

    const rows = deriveResourceRows(resources, new Map(), {
      fhirVersion: ['4.0.1'],
      parameters: { 'pin-canonicals': 'pin-multiples' },
      __publisherPackageCanonicalVersions: [
        { canonical: 'http://family.example', version: '2.0.0', candidate: true },
        { canonical: 'http://family.example/v1', version: '1.0.0', candidate: false },
        { canonical: 'http://single.example', version: '1.0.0', candidate: true },
      ],
    }).rows;
    const byId = new Map(rows.map((row) => [row.id, row]));

    expect(byId.get('multiple')?.base).toBe('http://family.example/StructureDefinition/Base|2.0.0');
    expect(byId.get('single')?.base).toBe('http://single.example/StructureDefinition/Base');
    expect(byId.get('core')?.base).toBe('http://hl7.org/fhir/StructureDefinition/Observation');
  });

  test('propagates IG standards status to non-example canonical resources', () => {
    const standardsStatus = 'http://hl7.org/fhir/StructureDefinition/structuredefinition-standards-status';
    const resources = [
      {
        resourceType: 'ImplementationGuide',
        id: 'demo',
        url: 'http://example.org/ImplementationGuide/demo',
        status: 'active',
        extension: [{ url: standardsStatus, valueCode: 'trial-use' }],
      },
      {
        resourceType: 'StructureDefinition',
        id: 'profile',
        url: 'http://example.org/StructureDefinition/profile',
        status: 'active',
      },
      {
        resourceType: 'Questionnaire',
        id: 'example',
        url: 'http://example.org/Questionnaire/example',
        status: 'active',
      },
      {
        resourceType: 'CodeSystem',
        id: 'experimental',
        url: 'http://example.org/CodeSystem/experimental',
        status: 'active',
        experimental: true,
      },
      {
        resourceType: 'ValueSet',
        id: 'profiled-example-terminology',
        url: 'http://example.org/ValueSet/profiled-example-terminology',
        status: 'active',
        experimental: true,
        meta: { profile: ['http://example.org/StructureDefinition/terminology-profile'] },
      },
    ];
    const metadata = new Map([
      ['Questionnaire/example', { exampleCanonical: 'http://example.org/StructureDefinition/q' }],
    ]);

    const rows = deriveResourceRows(resources, metadata, {}).rows;
    const byId = new Map(rows.map((r) => [r.id, r]));

    expect(byId.get('demo')?.standardStatus).toBe('trial-use');
    expect(byId.get('profile')?.standardStatus).toBe('trial-use');
    expect(byId.get('example')?.standardStatus).toBeNull();
    expect(byId.get('experimental')?.standardStatus).toBe('informative');
    expect(byId.get('profiled-example-terminology')?.standardStatus).toBeNull();
  });

  test('derives ValueSet_Codes rows from prepared expansions', () => {
    const resources = [
      { resourceType: 'ValueSet', id: 'flow', url: 'http://example.org/ValueSet/flow', version: '1.0.0' },
      { resourceType: 'ValueSet', id: 'unused', url: 'http://example.org/ValueSet/unused' },
    ];
    const rows = deriveValueSetCodeRows(
      resources,
      new Map([
        ['ValueSet/flow', 10],
        ['ValueSet/unused', 11],
      ]),
      new Map([
        ['ValueSet/flow', {
          codes: [
            { system: 'http://example.org/CodeSystem/flow', code: 'light', display: 'Light' },
            { system: 'http://example.org/CodeSystem/flow', version: '2', code: 'heavy' },
          ],
        }],
      ]),
    );

    expect(rows).toEqual([
      {
        key: 1,
        resourceKey: 10,
        valueSetUri: 'http://example.org/ValueSet/flow',
        valueSetVersion: '1.0.0',
        system: 'http://example.org/CodeSystem/flow',
        version: null,
        code: 'light',
        display: 'Light',
      },
      {
        key: 2,
        resourceKey: 10,
        valueSetUri: 'http://example.org/ValueSet/flow',
        valueSetVersion: '1.0.0',
        system: 'http://example.org/CodeSystem/flow',
        version: '2',
        code: 'heavy',
        display: null,
      },
    ]);
  });

  test('shapes only the explicit ImplementationGuide as the project index', () => {
    const extra = {
      resourceType: 'ImplementationGuide',
      id: 'aaa-example',
      url: 'http://example.org/ImplementationGuide/aaa-example',
    };
    const primary = {
      resourceType: 'ImplementationGuide',
      id: 'primary',
      packageId: 'example.primary',
      url: 'http://example.org/ImplementationGuide/primary',
    };
    const rows = deriveResourceRows(
      [extra, primary],
      new Map(),
      { canonical: 'http://example.org', packageId: 'example.primary' },
      primary,
    ).rows;
    expect(rows.map((row) => [row.id, row.web, row.url])).toEqual([
      ['aaa-example', 'ImplementationGuide-aaa-example.html', extra.url],
      ['example.primary', 'index.html', 'http://example.org/ImplementationGuide/example.primary'],
    ]);
  });
});
