import { describe, expect, test } from 'bun:test';
import { buildCurrentCanonicalIndex } from './canonical';
import { assertStructureDefinitionSnapshots, completeStructureDefinitionSnapshots, missingStructureDefinitionSnapshots } from './snapshots';

describe('StructureDefinition snapshot contract', () => {
  test('accepts StructureDefinitions with snapshot elements and ignores non-profiles', () => {
    const resources = [
      { resourceType: 'ImplementationGuide', id: 'ig' },
      {
        resourceType: 'StructureDefinition',
        id: 'patient-profile',
        url: 'http://example.org/StructureDefinition/patient-profile',
        snapshot: { element: [{ id: 'Patient' }] },
      },
    ];

    expect(missingStructureDefinitionSnapshots(resources)).toEqual([]);
    expect(() => assertStructureDefinitionSnapshots(resources)).not.toThrow();
  });

  test('fails clearly when a local StructureDefinition lacks a snapshot', () => {
    const resources = [
      {
        resourceType: 'StructureDefinition',
        id: 'snapshotless',
        url: 'http://example.org/StructureDefinition/snapshotless',
        differential: { element: [{ id: 'Observation' }] },
      },
    ];

    expect(missingStructureDefinitionSnapshots(resources)).toEqual([
      'snapshotless <http://example.org/StructureDefinition/snapshotless>',
    ]);
    expect(() => assertStructureDefinitionSnapshots(resources)).toThrow('StructureDefinition snapshots are required');
    expect(() => assertStructureDefinitionSnapshots(resources)).toThrow('Missing snapshots: snapshotless');
  });

  test('completes a missing snapshot by overlaying the base snapshot with differential elements', () => {
    const base = {
      resourceType: 'StructureDefinition',
      id: 'base-logical',
      url: 'http://example.org/StructureDefinition/base-logical',
      snapshot: {
        element: [
          { id: 'BaseLogical', path: 'BaseLogical', min: 0, max: '*', short: 'Base root' },
          { id: 'BaseLogical.code', path: 'BaseLogical.code', min: 0, max: '1', type: [{ code: 'code' }] },
        ],
      },
    };
    const derived = {
      resourceType: 'StructureDefinition',
      id: 'derived-logical',
      url: 'http://example.org/StructureDefinition/derived-logical',
      baseDefinition: base.url,
      differential: {
        element: [
          { id: 'BaseLogical.code', path: 'BaseLogical.code', min: 1, short: 'Required code' },
          { path: 'BaseLogical.extra', min: 0, max: '1', type: [{ code: 'string' }] },
        ],
      },
    };
    const resources = [base, derived];
    const indexes = { current: buildCurrentCanonicalIndex(resources), core: buildCurrentCanonicalIndex([]), dependencies: buildCurrentCanonicalIndex([]) };

    const completed = completeStructureDefinitionSnapshots(resources, indexes);
    const completedDerived = completed.find((r) => r.id === 'derived-logical')!;
    expect(completedDerived.snapshot.element.map((e: any) => e.path)).toEqual(['BaseLogical', 'BaseLogical.code', 'BaseLogical.extra']);
    expect(completedDerived.snapshot.element.find((e: any) => e.path === 'BaseLogical.code').min).toBe(1);
    expect(completedDerived.snapshot.element.find((e: any) => e.path === 'BaseLogical.code').type).toEqual([{ code: 'code' }]);
    expect(completedDerived.snapshot.element.find((e: any) => e.path === 'BaseLogical.extra').id).toBe('BaseLogical.extra');
  });

  test('completes logical specializations from FHIR Base using normalized differential elements', () => {
    const logical = {
      resourceType: 'StructureDefinition',
      id: 'logical-from-base',
      url: 'http://example.org/StructureDefinition/logical-from-base',
      baseDefinition: 'http://hl7.org/fhir/StructureDefinition/Base',
      differential: {
        element: [
          { path: 'LogicalRoot', min: 0, max: '*' },
          { path: 'LogicalRoot.value', min: 1, max: '1', type: [{ code: 'integer' }] },
        ],
      },
    };
    const resources = [logical];
    const indexes = { current: buildCurrentCanonicalIndex(resources), core: buildCurrentCanonicalIndex([]), dependencies: buildCurrentCanonicalIndex([]) };

    const [completed] = completeStructureDefinitionSnapshots(resources, indexes);
    expect(completed.snapshot.element).toEqual([
      { path: 'LogicalRoot', min: 0, max: '*', id: 'LogicalRoot', base: { path: 'LogicalRoot', min: 0, max: '*' } },
      { path: 'LogicalRoot.value', min: 1, max: '1', type: [{ code: 'integer' }], id: 'LogicalRoot.value', base: { path: 'LogicalRoot.value', min: 1, max: '1' } },
    ]);
  });
});
