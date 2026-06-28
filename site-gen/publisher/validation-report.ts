import type { ValidationIssue } from './validation';

export type ValidationReport = {
  schema: 'site-gen.publisher.validation-report.v2';
  generatedAt: string;
  totalIssueCounts: Record<string, number>;
  issueCounts: Record<string, number>;
  generatedNarrativeIssueCounts: Record<string, number>;
  issues: ValidationIssue[];
  generatedNarrativeIssues: ValidationIssue[];
};

export function validationIssueCounts(issues: ValidationIssue[]): Record<string, number> {
  return issues.reduce<Record<string, number>>((counts, issue) => {
    counts[issue.severity] = (counts[issue.severity] || 0) + 1;
    return counts;
  }, {});
}

export function isGeneratedNarrativeIssue(issue: ValidationIssue): boolean {
  return issue.code === 'fhirpath-constraint'
    && issue.severity === 'warning'
    && issue.message.startsWith('dom-6 failed:');
}

export function splitValidationIssues(issues: ValidationIssue[]): {
  issues: ValidationIssue[];
  generatedNarrativeIssues: ValidationIssue[];
} {
  const generatedNarrativeIssues: ValidationIssue[] = [];
  const ordinaryIssues: ValidationIssue[] = [];
  for (const issue of issues) {
    if (isGeneratedNarrativeIssue(issue)) {
      generatedNarrativeIssues.push(issue);
    } else {
      ordinaryIssues.push(issue);
    }
  }
  return { issues: ordinaryIssues, generatedNarrativeIssues };
}

export function buildValidationReport(issues: ValidationIssue[], generatedAt = new Date().toISOString()): ValidationReport {
  const split = splitValidationIssues(issues);
  return {
    schema: 'site-gen.publisher.validation-report.v2',
    generatedAt,
    totalIssueCounts: validationIssueCounts(issues),
    issueCounts: validationIssueCounts(split.issues),
    generatedNarrativeIssueCounts: validationIssueCounts(split.generatedNarrativeIssues),
    issues: split.issues,
    generatedNarrativeIssues: split.generatedNarrativeIssues,
  };
}
