import { describe, expect, test } from 'bun:test';
import { buildValidationReport, isGeneratedNarrativeIssue, splitValidationIssues, validationIssueCounts } from './validation-report';
import type { ValidationIssue } from './validation';

function issue(overrides: Partial<ValidationIssue>): ValidationIssue {
  return {
    severity: 'warning',
    code: 'fhirpath-constraint',
    message: 'dom-6 failed: A resource should have narrative for robust management',
    resourceRef: 'Patient/example',
    ...overrides,
  };
}

describe('validation report', () => {
  test('counts issues by severity', () => {
    expect(validationIssueCounts([
      issue({ severity: 'warning' }),
      issue({ severity: 'warning' }),
      issue({ severity: 'error', message: 'ptmvp failed: required fact missing' }),
    ])).toEqual({ warning: 2, error: 1 });
  });

  test('classifies only dom-6 narrative warnings as generated narrative issues', () => {
    expect(isGeneratedNarrativeIssue(issue({}))).toBe(true);
    expect(isGeneratedNarrativeIssue(issue({ severity: 'error' }))).toBe(false);
    expect(isGeneratedNarrativeIssue(issue({ code: 'fhirpath-evaluation' }))).toBe(false);
    expect(isGeneratedNarrativeIssue(issue({ message: 'sdc-3 failed: SDC version should be semver' }))).toBe(false);
  });

  test('keeps generated narrative warnings visible but outside ordinary issue counts', () => {
    const narrative = issue({ resourceRef: 'Observation/no-narrative' });
    const authoredWarning = issue({
      message: 'sdc-3 failed: StructureDefinition.version should be semver',
      resourceRef: 'StructureDefinition/example',
    });
    const error = issue({
      severity: 'error',
      message: 'ptmvp-bundle-bleeding-core failed: missing bleeding fact',
      resourceRef: 'Bundle/example',
    });

    const report = buildValidationReport([narrative, authoredWarning, error], '2026-06-28T00:00:00.000Z');

    expect(report.schema).toBe('site-gen.publisher.validation-report.v2');
    expect(report.generatedAt).toBe('2026-06-28T00:00:00.000Z');
    expect(report.totalIssueCounts).toEqual({ warning: 2, error: 1 });
    expect(report.issueCounts).toEqual({ warning: 1, error: 1 });
    expect(report.generatedNarrativeIssueCounts).toEqual({ warning: 1 });
    expect(report.issues.map((i) => i.resourceRef)).toEqual(['StructureDefinition/example', 'Bundle/example']);
    expect(report.generatedNarrativeIssues.map((i) => i.resourceRef)).toEqual(['Observation/no-narrative']);
  });

  test('splits without mutating issue order inside each bucket', () => {
    const issues = [
      issue({ resourceRef: 'Observation/a' }),
      issue({ resourceRef: 'StructureDefinition/b', message: 'authored warning' }),
      issue({ resourceRef: 'Observation/c' }),
    ];

    const split = splitValidationIssues(issues);

    expect(split.issues.map((i) => i.resourceRef)).toEqual(['StructureDefinition/b']);
    expect(split.generatedNarrativeIssues.map((i) => i.resourceRef)).toEqual(['Observation/a', 'Observation/c']);
  });
});
