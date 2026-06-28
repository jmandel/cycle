import { describe, expect, test } from 'bun:test';
import {
  configuredAutoOidRoot,
  deriveAutoOidAssignments,
  parseOidsIni,
  publisherOidNodeForType,
  resourceOidValues,
} from './oids';

describe('publisher OID helpers', () => {
  test('parses Publisher oids.ini sections and normalizes urn:oid values', () => {
    const assignments = parseOidsIni(`
[Documentation]
information1 = ignored

[Key]
CodeSystem = 2

[CodeSystem]
local-codes = 1.2.3.16.1
legacy-codes = urn:oid:1.2.3.16.2

[ValueSet]
local-values = 1.2.3.48.1
`);

    expect(assignments.get('CodeSystem')?.get('local-codes')).toBe('1.2.3.16.1');
    expect(assignments.get('CodeSystem')?.get('legacy-codes')).toBe('1.2.3.16.2');
    expect(assignments.get('ValueSet')?.get('local-values')).toBe('1.2.3.48.1');
    expect(assignments.has('Documentation')).toBe(false);
    expect(assignments.has('Key')).toBe(false);
  });

  test('matches Publisher resource-type OID nodes used for auto assignment', () => {
    expect(publisherOidNodeForType('CodeSystem')).toBe('16');
    expect(publisherOidNodeForType('ValueSet')).toBe('48');
    expect(publisherOidNodeForType('UnknownResource')).toBe('10');
  });

  test('derives auto assignments after existing oids.ini counters', () => {
    const existing = parseOidsIni(`
[CodeSystem]
old-codes = 1.2.3.16.5
`);
    const resources = [
      { resourceType: 'ImplementationGuide', id: 'ig' },
      { resourceType: 'CodeSystem', id: 'old-codes' },
      { resourceType: 'CodeSystem', id: 'new-codes' },
      {
        resourceType: 'ValueSet',
        id: 'explicit-values',
        identifier: [{ system: 'urn:ietf:rfc:3986', value: 'urn:oid:9.8.7' }],
      },
      { resourceType: 'ValueSet', id: 'new-values' },
    ];

    const assignments = deriveAutoOidAssignments(resources, '1.2.3', existing);
    expect(assignments.get('CodeSystem')?.get('old-codes')).toBe('1.2.3.16.5');
    expect(assignments.get('CodeSystem')?.get('new-codes')).toBe('1.2.3.16.6');
    expect(assignments.get('ValueSet')?.get('new-values')).toBe('1.2.3.48.1');
    expect(assignments.get('ValueSet')?.has('explicit-values')).toBe(false);
  });

  test('combines explicit resource identifiers with local assignments without duplicates', () => {
    const assignments = parseOidsIni(`
[ValueSet]
flow = 1.2.3.48.1
`);
    expect(resourceOidValues({
      resourceType: 'ValueSet',
      id: 'flow',
      identifier: [{ system: 'urn:ietf:rfc:3986', value: 'urn:oid:1.2.3.48.1' }],
    }, assignments)).toEqual(['1.2.3.48.1']);
  });

  test('accepts singleton identifier objects from generated example resources', () => {
    expect(resourceOidValues({
      resourceType: 'QuestionnaireResponse',
      id: 'response',
      identifier: { system: 'urn:ietf:rfc:3986', value: 'urn:oid:1.2.3.35.1' },
    })).toEqual(['1.2.3.35.1']);
  });

  test('reads auto-oid-root from SUSHI parameters', () => {
    expect(configuredAutoOidRoot({ parameters: { 'auto-oid-root': '1.2.3' } })).toBe('1.2.3');
    expect(configuredAutoOidRoot({ parameters: { autoOidRoot: '1.2.4' } })).toBe('1.2.4');
    expect(configuredAutoOidRoot({ parameters: {} })).toBeUndefined();
  });
});
