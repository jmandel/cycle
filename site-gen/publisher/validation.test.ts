import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { valueSetValidateCodeRequest } from './terminology';
import { writeTxCache } from './tx-cache';
import { buildCurrentCanonicalIndex } from './canonical';
import {
  exampleProfileAssignments,
  validateAssignedExamples,
  validateAssignedExamplesWithTerminology,
  validateResourceAgainstProfile,
  validateResourceAgainstProfileWithTerminology,
  type Json,
} from './validation';

const baseProfile = {
  resourceType: 'StructureDefinition',
  url: 'https://example.org/StructureDefinition/example-observation',
  type: 'Observation',
  snapshot: {
    element: [
      { id: 'Observation', path: 'Observation', min: 0, max: '*' },
      { id: 'Observation.status', path: 'Observation.status', min: 1, max: '1', type: [{ code: 'code' }], patternCode: 'final' },
      {
        id: 'Observation.code',
        path: 'Observation.code',
        min: 1,
        max: '1',
        type: [{ code: 'CodeableConcept' }],
        patternCodeableConcept: {
          coding: [
            { system: 'https://example.org/CodeSystem/local', code: 'example-code' },
          ],
        },
      },
      { id: 'Observation.value[x]', path: 'Observation.value[x]', min: 1, max: '1', type: [{ code: 'CodeableConcept' }] },
      { id: 'Observation.subject', path: 'Observation.subject', min: 0, max: '1', type: [{ code: 'Reference' }] },
    ],
  },
};

function observation(overrides: Json = {}): Json {
  return {
    resourceType: 'Observation',
    id: 'obs',
    status: 'final',
    code: {
      coding: [
        { system: 'https://example.org/CodeSystem/local', code: 'example-code', display: 'Example' },
      ],
    },
    valueCodeableConcept: {
      coding: [
        { system: 'https://example.org/CodeSystem/local', code: 'a', display: 'A' },
      ],
    },
    ...overrides,
  };
}

function indexesFor(resources: Json[]) {
  const index = buildCurrentCanonicalIndex(resources);
  return { current: index, core: buildCurrentCanonicalIndex([]), dependencies: buildCurrentCanonicalIndex([]) };
}

describe('publisher example validation', () => {
  test('uses ImplementationGuide exampleCanonical without requiring meta.profile on examples', () => {
    const example = observation();
    const ig = {
      resourceType: 'ImplementationGuide',
      id: 'ig',
      definition: {
        resource: [
          {
            reference: { reference: 'Observation/obs' },
            exampleCanonical: baseProfile.url,
          },
        ],
      },
    };
    const assignments = exampleProfileAssignments([ig, baseProfile, example]);
    expect(assignments).toEqual([{ resource: example, profileUrl: baseProfile.url, source: 'implementation-guide' }]);
    expect(validateAssignedExamples([ig, baseProfile, example], indexesFor([ig, baseProfile, example]))).toEqual([]);
  });

  test('reports unknown profile references from meta.profile', () => {
    const example = observation({ meta: { profile: ['https://example.org/StructureDefinition/missing'] } });
    const issues = validateAssignedExamples([example], indexesFor([example]));
    expect(issues.map((i) => i.code)).toEqual(['unknown-profile']);
  });

  test('catches missing required fields and wrong primitive patterns', () => {
    const missing = observation({ status: undefined });
    const wrong = observation({ status: 'preliminary' });

    expect(validateResourceAgainstProfile(missing, baseProfile, [baseProfile, missing]).map((i) => i.code)).toContain('min-cardinality');
    expect(validateResourceAgainstProfile(wrong, baseProfile, [baseProfile, wrong]).map((i) => i.code)).toContain('pattern-value');
  });

  test('counts primitive extension companions as present for cardinality', () => {
    const dataAbsentReason = {
      extension: [
        {
          url: 'http://hl7.org/fhir/StructureDefinition/data-absent-reason',
          valueCode: 'unknown',
        },
      ],
    };
    const patientProfile = {
      resourceType: 'StructureDefinition',
      url: 'https://example.org/StructureDefinition/patient-birthdate-required',
      type: 'Patient',
      fhirVersion: '4.0.1',
      snapshot: {
        element: [
          { id: 'Patient', path: 'Patient', min: 0, max: '*' },
          { id: 'Patient.birthDate', path: 'Patient.birthDate', min: 1, max: '1', type: [{ code: 'date' }] },
        ],
      },
    };
    const procedureProfile = {
      resourceType: 'StructureDefinition',
      url: 'https://example.org/StructureDefinition/procedure-performed-required',
      type: 'Procedure',
      fhirVersion: '4.0.1',
      snapshot: {
        element: [
          { id: 'Procedure', path: 'Procedure', min: 0, max: '*' },
          { id: 'Procedure.performed[x]', path: 'Procedure.performed[x]', min: 1, max: '1', type: [{ code: 'dateTime' }] },
        ],
      },
    };

    const patient = { resourceType: 'Patient', id: 'p', _birthDate: dataAbsentReason };
    const procedure = { resourceType: 'Procedure', id: 'proc', _performedDateTime: dataAbsentReason };
    const missing = { resourceType: 'Procedure', id: 'missing' };

    expect(validateResourceAgainstProfile(patient, patientProfile, [patientProfile, patient])).toEqual([]);
    expect(validateResourceAgainstProfile(procedure, procedureProfile, [procedureProfile, procedure])).toEqual([]);
    expect(validateResourceAgainstProfile(missing, procedureProfile, [procedureProfile, missing]).map((i) => i.code)).toEqual(['min-cardinality']);
  });

  test('evaluates FHIRPath choice aliases against primitive extension companions', () => {
    const dataAbsentReason = {
      extension: [
        {
          url: 'http://hl7.org/fhir/StructureDefinition/data-absent-reason',
          valueCode: 'unknown',
        },
      ],
    };
    const profile = {
      resourceType: 'StructureDefinition',
      url: 'https://example.org/StructureDefinition/procedure-fhirpath-performed',
      type: 'Procedure',
      fhirVersion: '4.0.1',
      snapshot: {
        element: [
          {
            id: 'Procedure',
            path: 'Procedure',
            min: 0,
            max: '*',
            constraint: [
              { key: 'performed-present', severity: 'error', human: 'Procedure performed must exist', expression: 'performed.exists()' },
            ],
          },
        ],
      },
    };

    const procedure = { resourceType: 'Procedure', id: 'proc', _performedDateTime: dataAbsentReason };
    const missing = { resourceType: 'Procedure', id: 'missing' };

    expect(validateResourceAgainstProfile(procedure, profile, [profile, procedure])).toEqual([]);
    expect(validateResourceAgainstProfile(missing, profile, [profile, missing]).map((i) => i.code)).toEqual(['fhirpath-constraint']);
  });

  test('evaluates ele-1 through FHIRPath for primitive extension companions', () => {
    const dataAbsentReason = {
      extension: [
        {
          url: 'http://hl7.org/fhir/StructureDefinition/data-absent-reason',
          valueCode: 'unknown',
        },
      ],
    };
    const profile = {
      resourceType: 'StructureDefinition',
      url: 'https://example.org/StructureDefinition/procedure-performed-ele-1',
      type: 'Procedure',
      fhirVersion: '4.0.1',
      snapshot: {
        element: [
          { id: 'Procedure', path: 'Procedure', min: 0, max: '*' },
          {
            id: 'Procedure.performed[x]',
            path: 'Procedure.performed[x]',
            min: 1,
            max: '1',
            type: [{ code: 'dateTime' }],
            constraint: [
              { key: 'ele-1', severity: 'error', human: 'All FHIR elements must have a @value or children', expression: 'hasValue() or (children().count() > id.count())' },
            ],
          },
        ],
      },
    };

    const procedure = { resourceType: 'Procedure', id: 'proc', _performedDateTime: dataAbsentReason };

    expect(validateResourceAgainstProfile(procedure, profile, [profile, procedure])).toEqual([]);
  });

  test('evaluates ele-1 correctly for boolean primitive values', () => {
    const profile = {
      resourceType: 'StructureDefinition',
      url: 'https://example.org/StructureDefinition/boolean-ele-1',
      type: 'Observation',
      fhirVersion: '4.0.1',
      snapshot: {
        element: [
          { id: 'Observation', path: 'Observation', min: 0, max: '*' },
          {
            id: 'Observation.value[x]',
            path: 'Observation.value[x]',
            min: 1,
            max: '1',
            type: [{ code: 'boolean' }],
            constraint: [
              { key: 'ele-1', severity: 'error', human: 'All FHIR elements must have a @value or children', expression: 'hasValue() or (children().count() > id.count())' },
            ],
          },
        ],
      },
    };

    const falseObservation = { resourceType: 'Observation', id: 'false', valueBoolean: false };
    const trueObservation = { resourceType: 'Observation', id: 'true', valueBoolean: true };

    expect(validateResourceAgainstProfile(falseObservation, profile, [profile, falseObservation])).toEqual([]);
    expect(validateResourceAgainstProfile(trueObservation, profile, [profile, trueObservation])).toEqual([]);
  });

  test('evaluates FHIRPath constraints with choice types and resource variables', () => {
    const profile = {
      resourceType: 'StructureDefinition',
      url: 'https://example.org/StructureDefinition/fhirpath-observation',
      type: 'Observation',
      fhirVersion: '4.0.1',
      snapshot: {
        element: [
          {
            id: 'Observation',
            path: 'Observation',
            min: 0,
            max: '*',
            constraint: [
              { key: 'has-value', severity: 'error', human: 'Observation must have a value', expression: 'value.exists()' },
            ],
          },
          { id: 'Observation.status', path: 'Observation.status', min: 1, max: '1', type: [{ code: 'code' }] },
          {
            id: 'Observation.code',
            path: 'Observation.code',
            min: 1,
            max: '1',
            type: [{ code: 'CodeableConcept' }],
            constraint: [
              { key: 'final-code', severity: 'warning', human: 'Code is checked only for final observations', expression: "%resource.status = 'final'" },
            ],
          },
        ],
      },
    };

    const good = {
      resourceType: 'Observation',
      id: 'fp-good',
      status: 'final',
      code: { text: 'example' },
      valueBoolean: false,
    };
    const missingValue = {
      resourceType: 'Observation',
      id: 'fp-missing',
      status: 'final',
      code: { text: 'example' },
    };
    const preliminary = {
      resourceType: 'Observation',
      id: 'fp-preliminary',
      status: 'preliminary',
      code: { text: 'example' },
      valueBoolean: true,
    };

    expect(validateResourceAgainstProfile(good, profile, [profile, good])).toEqual([]);
    const missingIssues = validateResourceAgainstProfile(missingValue, profile, [profile, missingValue]);
    expect(missingIssues.map((i) => i.code)).toContain('fhirpath-constraint');
    expect(missingIssues.find((i) => i.elementId === 'Observation')?.message).toContain('has-value failed');

    const warningIssues = validateResourceAgainstProfile(preliminary, profile, [profile, preliminary]);
    expect(warningIssues).toEqual([{
      severity: 'warning',
      code: 'fhirpath-constraint',
      message: 'final-code failed: Code is checked only for final observations',
      resourceRef: 'Observation/fp-preliminary',
      profileUrl: profile.url,
      elementId: 'Observation.code',
      path: 'Observation.code',
    }]);
  });

  test('evaluates standard Extension ext-1 against JSON choice values', () => {
    const profile = {
      resourceType: 'StructureDefinition',
      url: 'https://example.org/StructureDefinition/extension-holder',
      type: 'Flag',
      fhirVersion: '4.0.1',
      snapshot: {
        element: [
          { id: 'Flag', path: 'Flag', min: 0, max: '*' },
          {
            id: 'Flag.extension',
            path: 'Flag.extension',
            min: 0,
            max: '*',
            constraint: [
              { key: 'ext-1', severity: 'error', human: 'Must have either extensions or value[x], not both', expression: 'extension.exists() != value.exists()' },
            ],
          },
        ],
      },
    };

    const valueOnly = {
      resourceType: 'Flag',
      id: 'value-only',
      extension: [{ url: 'https://example.org/ext', valueDateTime: '2010' }],
    };
    const extensionOnly = {
      resourceType: 'Flag',
      id: 'extension-only',
      extension: [{ url: 'https://example.org/ext', extension: [{ url: 'child', valueString: 'ok' }] }],
    };
    const both = {
      resourceType: 'Flag',
      id: 'both',
      extension: [{ url: 'https://example.org/ext', extension: [{ url: 'child', valueString: 'bad' }], valueString: 'bad' }],
    };

    expect(validateResourceAgainstProfile(valueOnly, profile, [profile, valueOnly])).toEqual([]);
    expect(validateResourceAgainstProfile(extensionOnly, profile, [profile, extensionOnly])).toEqual([]);
    expect(validateResourceAgainstProfile(both, profile, [profile, both]).map((i) => i.code)).toEqual(['fhirpath-constraint']);
  });

  test('treats patternCodeableConcept as a required subset, not an exact fixed value', () => {
    const extraCoding = observation({
      code: {
        coding: [
          { system: 'https://example.org/CodeSystem/other', code: 'extra' },
          { system: 'https://example.org/CodeSystem/local', code: 'example-code', display: 'Local display' },
        ],
        text: 'Additional text is allowed by pattern semantics',
      },
    });
    const missingPatternCoding = observation({
      code: {
        coding: [
          { system: 'https://example.org/CodeSystem/other', code: 'extra' },
        ],
      },
    });

    expect(validateResourceAgainstProfile(extraCoding, baseProfile, [baseProfile, extraCoding])).toEqual([]);
    expect(validateResourceAgainstProfile(missingPatternCoding, baseProfile, [baseProfile, missingPatternCoding]).map((i) => i.code)).toContain('pattern-value');
  });

  test('enforces local required ValueSet bindings when a local expansion is available', () => {
    const codeSystem = {
      resourceType: 'CodeSystem',
      id: 'local',
      url: 'https://example.org/CodeSystem/local',
      content: 'complete',
      concept: [{ code: 'a', display: 'A' }],
    };
    const valueSet = {
      resourceType: 'ValueSet',
      id: 'required',
      url: 'https://example.org/ValueSet/required',
      compose: {
        include: [
          { system: codeSystem.url, concept: [{ code: 'a' }] },
        ],
      },
    };
    const profile = {
      ...baseProfile,
      snapshot: {
        element: baseProfile.snapshot.element.map((e: Json) =>
          e.id === 'Observation.value[x]'
            ? { ...e, binding: { strength: 'required', valueSet: valueSet.url } }
            : e
        ),
      },
    };

    const good = observation();
    const bad = observation({
      valueCodeableConcept: { coding: [{ system: codeSystem.url, code: 'b' }] },
    });

    expect(validateResourceAgainstProfile(good, profile, [codeSystem, valueSet, profile, good])).toEqual([]);
    expect(validateResourceAgainstProfile(bad, profile, [codeSystem, valueSet, profile, bad]).map((i) => i.code)).toContain('required-binding');
  });

  test('does not require children under an absent optional parent', () => {
    const profile = {
      ...baseProfile,
      snapshot: {
        element: [
          ...baseProfile.snapshot.element,
          { id: 'Observation.referenceRange', path: 'Observation.referenceRange', min: 0, max: '*' },
          { id: 'Observation.referenceRange.low', path: 'Observation.referenceRange.low', min: 1, max: '1' },
        ],
      },
    };

    expect(validateResourceAgainstProfile(observation(), profile, [profile]).map((i) => i.elementId)).not.toContain('Observation.referenceRange.low');
    expect(validateResourceAgainstProfile(observation({ referenceRange: [{}] }), profile, [profile]).map((i) => i.elementId)).toContain('Observation.referenceRange.low');
  });

  test('checks child cardinality per repeated parent, not across the whole resource', () => {
    const profile = {
      resourceType: 'StructureDefinition',
      url: 'https://example.org/StructureDefinition/bundle',
      type: 'Bundle',
      snapshot: {
        element: [
          { id: 'Bundle', path: 'Bundle', min: 0, max: '*' },
          { id: 'Bundle.entry', path: 'Bundle.entry', min: 0, max: '*' },
          { id: 'Bundle.entry.fullUrl', path: 'Bundle.entry.fullUrl', min: 0, max: '1' },
        ],
      },
    };
    const bundle = {
      resourceType: 'Bundle',
      id: 'b',
      entry: [
        { fullUrl: 'urn:uuid:1' },
        { fullUrl: 'urn:uuid:2' },
      ],
    };

    expect(validateResourceAgainstProfile(bundle, profile, [profile, bundle])).toEqual([]);
  });

  test('applies value-discriminated slice rules only to matching repeated children', () => {
    const profile = {
      resourceType: 'StructureDefinition',
      url: 'https://example.org/StructureDefinition/composition',
      type: 'Composition',
      snapshot: {
        element: [
          { id: 'Composition', path: 'Composition', min: 0, max: '*' },
          { id: 'Composition.section', path: 'Composition.section', min: 0, max: '*', slicing: { discriminator: [{ type: 'value', path: 'code' }], rules: 'open' } },
          { id: 'Composition.section:problems', path: 'Composition.section', sliceName: 'problems', min: 1, max: '1' },
          {
            id: 'Composition.section:problems.code',
            path: 'Composition.section.code',
            min: 1,
            max: '1',
            patternCodeableConcept: { coding: [{ system: 'http://loinc.org', code: '11450-4' }] },
          },
        ],
      },
    };
    const composition = {
      resourceType: 'Composition',
      id: 'c',
      section: [
        { code: { coding: [{ system: 'http://loinc.org', code: '48765-2' }] } },
        { code: { coding: [{ system: 'http://loinc.org', code: '11450-4' }] } },
      ],
    };

    expect(validateResourceAgainstProfile(composition, profile, [profile, composition])).toEqual([]);
  });

  test('applies nested slice cardinality within the matched parent slice', () => {
    const tobaccoProfile = {
      resourceType: 'StructureDefinition',
      url: 'https://example.org/StructureDefinition/tobacco-observation',
      type: 'Observation',
      snapshot: { element: [{ id: 'Observation', path: 'Observation', min: 0, max: '*' }] },
    };
    const alcoholProfile = {
      resourceType: 'StructureDefinition',
      url: 'https://example.org/StructureDefinition/alcohol-observation',
      type: 'Observation',
      snapshot: { element: [{ id: 'Observation', path: 'Observation', min: 0, max: '*' }] },
    };
    const profile = {
      resourceType: 'StructureDefinition',
      url: 'https://example.org/StructureDefinition/composition',
      type: 'Composition',
      snapshot: {
        element: [
          { id: 'Composition', path: 'Composition', min: 0, max: '*' },
          { id: 'Composition.section', path: 'Composition.section', min: 0, max: '*', slicing: { discriminator: [{ type: 'value', path: 'code' }], rules: 'open' } },
          { id: 'Composition.section:social', path: 'Composition.section', sliceName: 'social', min: 0, max: '1' },
          {
            id: 'Composition.section:social.code',
            path: 'Composition.section.code',
            min: 1,
            max: '1',
            patternCodeableConcept: { coding: [{ system: 'http://loinc.org', code: '29762-2' }] },
          },
          { id: 'Composition.section:social.entry', path: 'Composition.section.entry', min: 0, max: '*', slicing: { discriminator: [{ type: 'profile', path: 'resolve()' }], rules: 'open' } },
          {
            id: 'Composition.section:social.entry:tobacco',
            path: 'Composition.section.entry',
            sliceName: 'tobacco',
            min: 1,
            max: '1',
            type: [{ code: 'Reference', targetProfile: [tobaccoProfile.url] }],
          },
        ],
      },
    };
    const tobacco = {
      resourceType: 'Observation',
      id: 'tobacco',
      meta: { profile: [tobaccoProfile.url] },
    };
    const alcohol = {
      resourceType: 'Observation',
      id: 'alcohol',
      meta: { profile: [alcoholProfile.url] },
    };
    const composition = {
      resourceType: 'Composition',
      id: 'c',
      section: [
        {
          code: { coding: [{ system: 'http://loinc.org', code: '29762-2' }] },
          entry: [
            { reference: 'Observation/tobacco' },
            { reference: 'Observation/alcohol' },
          ],
        },
      ],
    };

    expect(validateResourceAgainstProfile(composition, profile, [profile, composition, tobaccoProfile, alcoholProfile, tobacco, alcohol])).toEqual([]);

    const missingTobacco = {
      ...composition,
      section: [{
        code: { coding: [{ system: 'http://loinc.org', code: '29762-2' }] },
        entry: [{ reference: 'Observation/alcohol' }],
      }],
    };
    expect(
      validateResourceAgainstProfile(missingTobacco, profile, [profile, missingTobacco, tobaccoProfile, alcoholProfile, tobacco, alcohol])
        .map((i) => i.code),
    ).toContain('min-cardinality');

    const duplicateTobacco = {
      ...composition,
      section: [{
        code: { coding: [{ system: 'http://loinc.org', code: '29762-2' }] },
        entry: [{ reference: 'Observation/tobacco' }, { reference: 'Observation/tobacco' }, { reference: 'Observation/alcohol' }],
      }],
    };
    expect(
      validateResourceAgainstProfile(duplicateTobacco, profile, [profile, duplicateTobacco, tobaccoProfile, alcoholProfile, tobacco, alcohol])
        .map((i) => i.code),
    ).toContain('max-cardinality');
  });

  test('matches Extension slices whose type profile fixes Extension.url', () => {
    const extensionProfile = {
      resourceType: 'StructureDefinition',
      url: 'https://example.org/StructureDefinition/example-extension',
      type: 'Extension',
      snapshot: {
        element: [
          { id: 'Extension', path: 'Extension', min: 0, max: '1' },
          {
            id: 'Extension.url',
            path: 'Extension.url',
            min: 1,
            max: '1',
            fixedUri: 'https://example.org/StructureDefinition/example-extension',
          },
        ],
      },
    };
    const profile = {
      resourceType: 'StructureDefinition',
      url: 'https://example.org/StructureDefinition/sliced-questionnaire',
      type: 'Questionnaire',
      snapshot: {
        element: [
          { id: 'Questionnaire', path: 'Questionnaire', min: 0, max: '*' },
          {
            id: 'Questionnaire.extension',
            path: 'Questionnaire.extension',
            min: 0,
            max: '*',
            slicing: { discriminator: [{ type: 'value', path: 'url' }], rules: 'open' },
          },
          {
            id: 'Questionnaire.extension:example',
            path: 'Questionnaire.extension',
            sliceName: 'example',
            min: 1,
            max: '1',
            type: [{ code: 'Extension', profile: [extensionProfile.url] }],
          },
        ],
      },
    };
    const questionnaire = {
      resourceType: 'Questionnaire',
      id: 'q',
      extension: [
        { url: 'https://example.org/StructureDefinition/other-extension', valueString: 'ignored' },
        { url: extensionProfile.url, valueCode: 'present' },
        { url: 'https://example.org/StructureDefinition/another-extension', valueString: 'ignored' },
      ],
    };

    expect(validateResourceAgainstProfile(questionnaire, profile, [profile, extensionProfile, questionnaire])).toEqual([]);

    const duplicate = {
      ...questionnaire,
      extension: [...questionnaire.extension, { url: extensionProfile.url, valueCode: 'duplicate' }],
    };
    expect(validateResourceAgainstProfile(duplicate, profile, [profile, extensionProfile, duplicate]).map((i) => i.code)).toContain('max-cardinality');
  });

  test('applies resource-type slice cardinality only to matching Bundle entries', () => {
    const profile = {
      resourceType: 'StructureDefinition',
      url: 'https://example.org/StructureDefinition/bundle-type-slices',
      type: 'Bundle',
      snapshot: {
        element: [
          { id: 'Bundle', path: 'Bundle', min: 0, max: '*' },
          { id: 'Bundle.entry', path: 'Bundle.entry', min: 0, max: '*', slicing: { discriminator: [{ type: 'type', path: 'resource' }, { type: 'profile', path: 'resource' }], rules: 'open' } },
          { id: 'Bundle.entry:composition', path: 'Bundle.entry', sliceName: 'composition', min: 1, max: '1' },
          { id: 'Bundle.entry:composition.resource', path: 'Bundle.entry.resource', min: 1, max: '1', type: [{ code: 'Composition' }] },
          { id: 'Bundle.entry:patient', path: 'Bundle.entry', sliceName: 'patient', min: 1, max: '1' },
          { id: 'Bundle.entry:patient.resource', path: 'Bundle.entry.resource', min: 1, max: '1', type: [{ code: 'Patient' }] },
        ],
      },
    };
    const bundle = {
      resourceType: 'Bundle',
      id: 'b',
      entry: [
        { resource: { resourceType: 'Composition', id: 'c' } },
        { resource: { resourceType: 'Patient', id: 'p' } },
        { resource: { resourceType: 'Observation', id: 'o' } },
      ],
    };

    expect(validateResourceAgainstProfile(bundle, profile, [profile, bundle])).toEqual([]);
  });

  test('uses cached terminology validation for required external bindings without expansion', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'validation-tx-'));
    const valueSetUrl = 'https://example.org/ValueSet/external-required';
    const profile = {
      ...baseProfile,
      snapshot: {
        element: baseProfile.snapshot.element.map((e: Json) =>
          e.id === 'Observation.value[x]'
            ? { ...e, binding: { strength: 'required', valueSet: valueSetUrl } }
            : e
        ),
      },
    };
    const txOptions = {
      mode: 'cache' as const,
      cacheDir: dir,
      server: 'https://tx.example.org/r4',
      fhirVersion: '4.0.1',
      maxExpansionCodes: 1000,
    };
    const goodInput = {
      valueSetUrl,
      system: 'http://snomed.info/sct',
      code: '25064002',
      display: 'Headache',
    };
    const badInput = { valueSetUrl, system: goodInput.system, code: '999999' };
    try {
      writeTxCache(dir, valueSetValidateCodeRequest(goodInput, txOptions), {
        resourceType: 'Parameters',
        parameter: [{ name: 'result', valueBoolean: true }],
      });
      writeTxCache(dir, valueSetValidateCodeRequest(badInput, txOptions), {
        resourceType: 'Parameters',
        parameter: [
          { name: 'result', valueBoolean: false },
          { name: 'message', valueString: 'Code is not in value set' },
        ],
      });

      const good = observation({
        valueCodeableConcept: { coding: [{ system: goodInput.system, code: goodInput.code, display: goodInput.display }] },
      });
      const bad = observation({
        valueCodeableConcept: { coding: [{ system: badInput.system, code: badInput.code }] },
      });

      expect(await validateResourceAgainstProfileWithTerminology(good, profile, [profile, good], { terminologyOptions: txOptions })).toEqual([]);
      const issues = await validateResourceAgainstProfileWithTerminology(bad, profile, [profile, bad], { terminologyOptions: txOptions });
      expect(issues.map((i) => i.code)).toContain('required-binding');
      expect(issues[0].message).toContain('Code is not in value set');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('does not infer optional profile-discriminated Bundle slices from type alone', async () => {
    const bundleProfile = {
      resourceType: 'StructureDefinition',
      url: 'https://example.org/StructureDefinition/bundle',
      type: 'Bundle',
      snapshot: {
        element: [
          { id: 'Bundle', path: 'Bundle', min: 0, max: '*' },
          { id: 'Bundle.entry', path: 'Bundle.entry', min: 0, max: '*', slicing: { discriminator: [{ type: 'type', path: 'resource' }, { type: 'profile', path: 'resource' }], rules: 'open' } },
          { id: 'Bundle.entry:patient', path: 'Bundle.entry', sliceName: 'patient', min: 1, max: '1' },
          {
            id: 'Bundle.entry:patient.resource',
            path: 'Bundle.entry.resource',
            min: 1,
            max: '1',
            type: [{ code: 'Patient', profile: ['https://example.org/StructureDefinition/patient'] }],
          },
          { id: 'Bundle.entry:lab', path: 'Bundle.entry', sliceName: 'lab', min: 0, max: '*' },
          {
            id: 'Bundle.entry:lab.resource',
            path: 'Bundle.entry.resource',
            min: 1,
            max: '1',
            type: [{ code: 'Observation', profile: ['https://example.org/StructureDefinition/lab-observation'] }],
          },
        ],
      },
    };
    const patientProfile = {
      resourceType: 'StructureDefinition',
      url: 'https://example.org/StructureDefinition/patient',
      type: 'Patient',
      snapshot: {
        element: [{ id: 'Patient', path: 'Patient', min: 0, max: '*' }],
      },
    };
    const labProfile = {
      resourceType: 'StructureDefinition',
      url: 'https://example.org/StructureDefinition/lab-observation',
      type: 'Observation',
      snapshot: {
        element: [
          { id: 'Observation', path: 'Observation', min: 0, max: '*' },
          { id: 'Observation.category', path: 'Observation.category', min: 1, max: '*' },
        ],
      },
    };
    const bundle = {
      resourceType: 'Bundle',
      id: 'b',
      entry: [
        { resource: { resourceType: 'Patient', id: 'p' } },
        { resource: { resourceType: 'Observation', id: 'obs-without-profile' } },
      ],
    };
    const ig = {
      resourceType: 'ImplementationGuide',
      id: 'ig',
      definition: {
        resource: [
          { reference: { reference: 'Bundle/b' }, exampleCanonical: bundleProfile.url },
        ],
      },
    };

    const issues = await validateAssignedExamplesWithTerminology(
      [ig, bundleProfile, patientProfile, labProfile, bundle],
      indexesFor([ig, bundleProfile, patientProfile, labProfile, bundle]),
    );

    expect(issues).toEqual([]);
  });

  test('uses explicit meta.profile to match optional profile-discriminated Bundle slices', async () => {
    const bundleProfile = {
      resourceType: 'StructureDefinition',
      url: 'https://example.org/StructureDefinition/bundle',
      type: 'Bundle',
      snapshot: {
        element: [
          { id: 'Bundle', path: 'Bundle', min: 0, max: '*' },
          { id: 'Bundle.entry', path: 'Bundle.entry', min: 0, max: '*', slicing: { discriminator: [{ type: 'type', path: 'resource' }, { type: 'profile', path: 'resource' }], rules: 'open' } },
          { id: 'Bundle.entry:lab', path: 'Bundle.entry', sliceName: 'lab', min: 0, max: '*' },
          {
            id: 'Bundle.entry:lab.resource',
            path: 'Bundle.entry.resource',
            min: 1,
            max: '1',
            type: [{ code: 'Observation', profile: ['https://example.org/StructureDefinition/lab-observation'] }],
          },
        ],
      },
    };
    const labProfile = {
      resourceType: 'StructureDefinition',
      url: 'https://example.org/StructureDefinition/lab-observation',
      type: 'Observation',
      snapshot: {
        element: [
          { id: 'Observation', path: 'Observation', min: 0, max: '*' },
          { id: 'Observation.category', path: 'Observation.category', min: 1, max: '*' },
        ],
      },
    };
    const bundle = {
      resourceType: 'Bundle',
      id: 'b',
      entry: [
        {
          resource: {
            resourceType: 'Observation',
            id: 'lab',
            meta: { profile: [labProfile.url] },
          },
        },
      ],
    };
    const ig = {
      resourceType: 'ImplementationGuide',
      id: 'ig',
      definition: {
        resource: [
          { reference: { reference: 'Bundle/b' }, exampleCanonical: bundleProfile.url },
        ],
      },
    };

    const issues = await validateAssignedExamplesWithTerminology(
      [ig, bundleProfile, labProfile, bundle],
      indexesFor([ig, bundleProfile, labProfile, bundle]),
    );

    expect(issues.map((i) => i.resourceRef)).toContain('Observation/lab');
    expect(issues.map((i) => i.elementId)).toContain('Observation.category');
  });

  test('validates embedded Bundle resources against asserted type profiles', async () => {
    const bundleProfile = {
      resourceType: 'StructureDefinition',
      url: 'https://example.org/StructureDefinition/bundle',
      type: 'Bundle',
      snapshot: {
        element: [
          { id: 'Bundle', path: 'Bundle', min: 0, max: '*' },
          { id: 'Bundle.entry', path: 'Bundle.entry', min: 0, max: '*', slicing: { discriminator: [{ type: 'type', path: 'resource' }, { type: 'profile', path: 'resource' }], rules: 'open' } },
          { id: 'Bundle.entry:patient', path: 'Bundle.entry', sliceName: 'patient', min: 1, max: '1' },
          {
            id: 'Bundle.entry:patient.resource',
            path: 'Bundle.entry.resource',
            min: 1,
            max: '1',
            type: [{ code: 'Patient', profile: ['https://example.org/StructureDefinition/patient'] }],
          },
        ],
      },
    };
    const patientProfile = {
      resourceType: 'StructureDefinition',
      url: 'https://example.org/StructureDefinition/patient',
      type: 'Patient',
      snapshot: {
        element: [
          { id: 'Patient', path: 'Patient', min: 0, max: '*' },
          { id: 'Patient.name', path: 'Patient.name', min: 1, max: '*' },
        ],
      },
    };
    const bundle = {
      resourceType: 'Bundle',
      id: 'b',
      entry: [
        { resource: { resourceType: 'Patient', id: 'p' } },
      ],
    };
    const ig = {
      resourceType: 'ImplementationGuide',
      id: 'ig',
      definition: {
        resource: [
          { reference: { reference: 'Bundle/b' }, exampleCanonical: bundleProfile.url },
        ],
      },
    };
    const issues = await validateAssignedExamplesWithTerminology(
      [ig, bundleProfile, patientProfile, bundle],
      indexesFor([ig, bundleProfile, patientProfile, bundle]),
    );

    expect(issues.map((i) => i.resourceRef)).toContain('Patient/p');
    expect(issues.map((i) => i.elementId)).toContain('Patient.name');
  });
});
