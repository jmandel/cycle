import { canonicalNoVersion, resolvePublisherResource, type PublisherCanonicalIndexes } from './canonical';
import * as fhirpath from 'fhirpath';
import r4Model from 'fhirpath/fhir-context/r4';
import r5Model from 'fhirpath/fhir-context/r5';
import stu3Model from 'fhirpath/fhir-context/stu3';
import {
  expandValueSet,
  validateValueSetCode,
  type ExpandedValueSetCode,
  type PreparedValueSetExpansion,
  type TerminologyOptions,
  type ValidateCodeResult,
  type ValueSetValidateCodeInput,
} from './terminology';
import { stableJson } from './tx-cache';

export type Json = Record<string, any>;

export type ValidationSeverity = 'error' | 'warning';

export type ValidationIssue = {
  severity: ValidationSeverity;
  code: string;
  message: string;
  resourceRef: string;
  profileUrl?: string;
  elementId?: string;
  path?: string;
};

export type ExampleProfileAssignment = {
  resource: Json;
  profileUrl: string;
  source: 'meta.profile' | 'implementation-guide';
};

export type ValidationOptions = {
  valueSetExpansions?: Map<string, PreparedValueSetExpansion>;
  warnOnUncheckedRequiredBindings?: boolean;
};

export type TerminologyValidationOptions = ValidationOptions & {
  terminologyOptions?: TerminologyOptions;
};

type PathValue = {
  value: any;
  path: string;
};

type ValueSetCodeIndex = Map<string, Set<string>>;

type CardinalityContext = {
  parent: PathValue;
  childValues: PathValue[];
};

type ElementContext = {
  values: PathValue[];
  cardinality: CardinalityContext[];
};

type SliceInfo = {
  sliceElementId: string;
  slicePath: string;
};

type ValidationRuntime = {
  resourcesByRef: Map<string, Json>;
  profilesByUrl: Map<string, Json>;
  fhirPathModel?: Json;
};

function resourceRef(resource: Json): string {
  return resource.resourceType && resource.id ? `${resource.resourceType}/${resource.id}` : resource.id || '(anonymous)';
}

function elementRef(profile: Json, element: Json): string {
  return element.id || element.path || profile.url || profile.id || '(element)';
}

function normalizeCanonical(url: unknown): string | null {
  return typeof url === 'string' && url ? canonicalNoVersion(url) : null;
}

function normalizedCanonicals(urls: unknown): Set<string> {
  if (!Array.isArray(urls)) return new Set();
  return new Set(urls.map(normalizeCanonical).filter(Boolean) as string[]);
}

function canonicalVersion(url: unknown): string | undefined {
  if (typeof url !== 'string' || !url.includes('|')) return undefined;
  return url.split('|').slice(1).join('|') || undefined;
}

function pathSegments(elementPath: string | undefined): string[] {
  if (!elementPath) return [];
  const parts = elementPath.split('.');
  return parts.slice(1);
}

function hasValue(value: any): boolean {
  return value !== undefined && value !== null && !(Array.isArray(value) && value.length === 0);
}

function primitiveElementMetadataHasValue(value: any): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return hasValue(value.extension) || hasValue(value.id);
}

function primitiveCompanionKey(elementName: string): string {
  return `_${elementName}`;
}

function valuesForSegment(parent: PathValue, segment: string): PathValue[] {
  const value = parent.value;
  if (Array.isArray(value)) {
    return value.flatMap((item, i) => valuesForSegment({ value: item, path: `${parent.path}[${i}]` }, segment));
  }
  if (!value || typeof value !== 'object') return [];

  if (segment.endsWith('[x]')) {
    const prefix = segment.slice(0, -3);
    const directValues = Object.entries(value)
      .filter(([k, v]) => k.startsWith(prefix) && k !== prefix && hasValue(v))
      .map(([k, v]) => ({ value: v, path: parent.path ? `${parent.path}.${k}` : k }));
    const directNames = new Set(directValues.map((v) => v.path.split('.').pop() || ''));
    const primitiveOnlyValues = Object.entries(value)
      .filter(([k, v]) => k.startsWith(`_${prefix}`) && k !== `_${prefix}` && primitiveElementMetadataHasValue(v))
      .filter(([k]) => !directNames.has(k.slice(1)) && !hasValue(value[k.slice(1)]))
      .map(([k, v]) => ({ value: v, path: parent.path ? `${parent.path}.${k}` : k }));
    return [...directValues, ...primitiveOnlyValues];
  }

  if (!hasValue(value[segment])) {
    const companionKey = primitiveCompanionKey(segment);
    return primitiveElementMetadataHasValue(value[companionKey])
      ? [{ value: value[companionKey], path: parent.path ? `${parent.path}.${companionKey}` : companionKey }]
      : [];
  }
  const child = value[segment];
  if (Array.isArray(child)) {
    return child.map((v, i) => ({ value: v, path: `${parent.path ? `${parent.path}.` : ''}${segment}[${i}]` }));
  }
  return [{ value: child, path: parent.path ? `${parent.path}.${segment}` : segment }];
}

function valuesAtPath(resource: Json, elementPath: string | undefined): PathValue[] {
  const segments = pathSegments(elementPath);
  if (!segments.length) return [{ value: resource, path: resource.resourceType || '' }];
  return segments.reduce<PathValue[]>((parents, segment) => parents.flatMap((p) => valuesForSegment(p, segment)), [{ value: resource, path: '' }]);
}

function valuesAtRelativePath(value: any, relativePath: string | undefined): PathValue[] {
  if (!relativePath || relativePath === '$this') return [{ value, path: '' }];
  return relativePath.split('.').reduce<PathValue[]>((parents, segment) => parents.flatMap((p) => valuesForSegment(p, segment)), [{ value, path: '' }]);
}

function applySegments(parents: PathValue[], segments: string[]): PathValue[] {
  return segments.reduce<PathValue[]>((acc, segment) => acc.flatMap((p) => valuesForSegment(p, segment)), parents);
}

function parentValuesAtPath(resource: Json, elementPath: string | undefined): PathValue[] {
  const segments = pathSegments(elementPath);
  if (segments.length <= 1) return [{ value: resource, path: resource.resourceType || '' }];
  return segments.slice(0, -1).reduce<PathValue[]>((parents, segment) => parents.flatMap((p) => valuesForSegment(p, segment)), [{ value: resource, path: '' }]);
}

function childValuesForElement(parent: PathValue, elementPath: string | undefined): PathValue[] {
  const segments = pathSegments(elementPath);
  if (!segments.length) return [parent];
  return valuesForSegment(parent, segments[segments.length - 1]);
}

function slicedElementInfo(element: Json): SliceInfo | null {
  return sliceChainInfo(element)[0] || null;
}

function sliceChainInfo(element: Json): SliceInfo[] {
  const id = typeof element.id === 'string' ? element.id : '';
  if (!id.includes(':')) return [];
  const idSegments = id.split('.');
  const out: SliceInfo[] = [];
  const slicedSegments: string[] = [];
  for (const segment of idSegments) {
    slicedSegments.push(segment);
    if (segment.includes(':')) {
      const sliceElementId = slicedSegments.join('.');
      const slicePath = slicedSegments.map((s) => s.split(':')[0]).join('.');
      out.push({ sliceElementId, slicePath });
    }
  }
  return out;
}

function profileElements(profile: Json): Json[] {
  return profile.snapshot?.element || [];
}

function sliceElement(profile: Json, id: string): Json | undefined {
  return profileElements(profile).find((e) => e.id === id);
}

function profileUrlIndex(resources: Json[]): Map<string, Json> {
  const out = new Map<string, Json>();
  for (const resource of resources) {
    if (resource.resourceType !== 'StructureDefinition' || typeof resource.url !== 'string') continue;
    out.set(canonicalNoVersion(resource.url), resource);
    if (typeof resource.version === 'string') out.set(`${canonicalNoVersion(resource.url)}|${resource.version}`, resource);
  }
  return out;
}

function unslicedElementForSlice(profile: Json, slice: Json): Json | undefined {
  return profileElements(profile).find((e) => e.path === slice.path && !e.sliceName && e.slicing);
}

function relativePathFromSlice(slicePath: string, childPath: string | undefined): string | null {
  const sliceSegments = pathSegments(slicePath);
  const childSegments = pathSegments(childPath);
  if (childSegments.length < sliceSegments.length) return null;
  for (let i = 0; i < sliceSegments.length; i++) {
    if (childSegments[i] !== sliceSegments[i]) return null;
  }
  return childSegments.slice(sliceSegments.length).join('.');
}

function childElementForDiscriminator(profile: Json, slice: Json, discriminatorPath: string): Json | undefined {
  if (discriminatorPath === '$this' || discriminatorPath === 'resolve()') return slice;
  const wantedPath = `${slice.path}.${discriminatorPath}`;
  return profileElements(profile).find((e) => typeof e.id === 'string' && e.id.startsWith(`${slice.id}.`) && e.path === wantedPath);
}

function valueMatchesElementConstraint(value: any, element: Json): boolean | null {
  const requiredValue = patternField(element);
  if (!requiredValue) return null;
  return requiredValue.kind === 'fixed'
    ? matchesFixed(requiredValue.value, value)
    : matchesPattern(requiredValue.value, value);
}

function resolvedReference(value: any, runtime: ValidationRuntime): Json | null {
  const ref = typeof value?.reference === 'string' ? value.reference : null;
  if (!ref) return null;
  return runtime.resourcesByRef.get(ref) || runtime.resourcesByRef.get(ref.replace(/^#/, '')) || null;
}

function discriminatorValues(value: any, discriminatorPath: string, runtime: ValidationRuntime): PathValue[] {
  if (discriminatorPath !== 'resolve()') return valuesAtRelativePath(value, discriminatorPath);
  const resolved = resolvedReference(value, runtime);
  return resolved ? [{ value: resolved, path: 'resolve()' }] : [];
}

function matchingTypeProfiles(type: Json, candidateType: string | undefined): string[] | null {
  if (type.code === 'Reference' && candidateType) {
    return [...(Array.isArray(type.profile) ? type.profile : []), ...(Array.isArray(type.targetProfile) ? type.targetProfile : [])];
  }
  if (type.code === candidateType) return Array.isArray(type.profile) ? type.profile : [];
  return null;
}

function valueMatchesTypeConstraint(value: any, element: Json, discriminatorPath: string, discriminatorType: string, slice: Json, runtime: ValidationRuntime): boolean | null {
  const types = Array.isArray(element.type) ? element.type : [];
  if (!types.length) return null;
  const candidates = discriminatorValues(value, discriminatorPath, runtime);
  if (!candidates.length) return false;
  return candidates.some((candidate) => {
    const candidateType = candidate.value?.resourceType;
    const matchingTypes = typeof candidateType === 'string'
      ? types.map((t: Json) => ({ type: t, profiles: matchingTypeProfiles(t, candidateType) })).filter((t) => t.profiles !== null)
      : [];
    if (!matchingTypes.length) return false;
    if (discriminatorType !== 'profile') return true;

    const assertedProfiles = matchingTypes.flatMap((t) => t.profiles || []);
    if (!assertedProfiles.length) return true;
    const declaredProfiles = normalizedCanonicals(candidate.value?.meta?.profile);
    if (declaredProfiles.size) {
      return assertedProfiles.some((url: string) => declaredProfiles.has(canonicalNoVersion(url)));
    }

    // The full Publisher validator can resolve profile discriminators by
    // validating the candidate against the asserted profile. This lightweight
    // QA pass avoids guessing for optional profile slices that do not stamp
    // meta.profile, otherwise one Observation can be falsely validated against
    // every optional Observation slice in a Bundle profile.
    return Number(slice.min || 0) > 0;
  });
}

function extensionProfileUrlConstraint(profile: Json, discriminatorPath: string): { kind: 'pattern' | 'fixed'; value: any } | null {
  if (discriminatorPath !== 'url') return null;
  const urlElement = profileElements(profile).find((e) => e.id === 'Extension.url' || e.path === 'Extension.url');
  return urlElement ? patternField(urlElement) : null;
}

function valueMatchesProfileConstrainedDiscriminator(slice: Json, candidate: PathValue, discriminatorPath: string, runtime: ValidationRuntime): boolean | null {
  const profileUrls = (Array.isArray(slice.type) ? slice.type : [])
    .filter((type: Json) => type.code === 'Extension')
    .flatMap((type: Json) => Array.isArray(type.profile) ? type.profile : []);
  if (!profileUrls.length) return null;

  const candidateValues = valuesAtRelativePath(candidate.value, discriminatorPath);
  if (!candidateValues.length) return false;

  let checked = false;
  for (const profileUrl of profileUrls) {
    const profile = runtime.profilesByUrl.get(canonicalNoVersion(profileUrl)) || runtime.profilesByUrl.get(String(profileUrl));
    if (!profile) continue;
    const requiredValue = extensionProfileUrlConstraint(profile, discriminatorPath);
    if (!requiredValue) continue;
    checked = true;
    if (candidateValues.some((v) => requiredValue.kind === 'fixed'
      ? matchesFixed(requiredValue.value, v.value)
      : matchesPattern(requiredValue.value, v.value))) {
      return true;
    }
  }
  return checked ? false : null;
}

function matchesSlice(profile: Json, slice: Json, candidate: PathValue, runtime: ValidationRuntime): boolean {
  const slicing = unslicedElementForSlice(profile, slice)?.slicing;
  const discriminators = Array.isArray(slicing?.discriminator) ? slicing.discriminator : [];
  let evaluatedDiscriminators = 0;
  for (const discriminator of discriminators) {
    const child = childElementForDiscriminator(profile, slice, discriminator.path);
    if (discriminator.type === 'value') {
      const matched = child
        ? valuesAtRelativePath(candidate.value, relativePathFromSlice(slice.path, child.path) || undefined)
          .some((v) => valueMatchesElementConstraint(v.value, child))
        : valueMatchesProfileConstrainedDiscriminator(slice, candidate, discriminator.path, runtime);
      if (matched === null) return false;
      evaluatedDiscriminators++;
      if (!matched) return false;
    } else if (discriminator.type === 'type' || discriminator.type === 'profile') {
      if (!child) continue;
      evaluatedDiscriminators++;
      const matched = valueMatchesTypeConstraint(candidate.value, child, discriminator.path, discriminator.type, slice, runtime);
      if (matched === false) return false;
    }
  }

  if (discriminators.length) return evaluatedDiscriminators > 0 ? true : Number(slice.min || 0) > 0;

  const childConstraints = profileElements(profile)
    .filter((e) => typeof e.id === 'string' && e.id.startsWith(`${slice.id}.`))
    .filter((e) => patternField(e));
  if (!childConstraints.length) return Number(slice.min || 0) > 0;
  return childConstraints.every((child) => {
    const relative = relativePathFromSlice(slice.path, child.path);
    const candidateValues = valuesAtRelativePath(candidate.value, relative || undefined);
    return candidateValues.some((v) => valueMatchesElementConstraint(v.value, child));
  });
}

function elementContext(resource: Json, profile: Json, element: Json, runtime: ValidationRuntime): ElementContext {
  const sliceChain = sliceChainInfo(element);
  if (!sliceChain.length) {
    const cardinality = parentValuesAtPath(resource, element.path)
      .map((parent) => ({ parent, childValues: childValuesForElement(parent, element.path) }));
    return { values: valuesAtPath(resource, element.path), cardinality };
  }

  let matchedSlices: PathValue[] = [{ value: resource, path: resource.resourceType || '' }];
  let previousSlicePath = resource.resourceType || '';
  let matchingSlicesByParent: CardinalityContext[] = [];
  let lastSliceInfo: SliceInfo | null = null;

  for (const sliceInfo of sliceChain) {
    const slice = sliceElement(profile, sliceInfo.sliceElementId);
    if (!slice) {
      const cardinality = parentValuesAtPath(resource, element.path)
        .map((parent) => ({ parent, childValues: childValuesForElement(parent, element.path) }));
      return { values: valuesAtPath(resource, element.path), cardinality };
    }

    const sliceSegments = pathSegments(sliceInfo.slicePath);
    const parentSegments = sliceSegments.slice(0, -1);
    const sliceChildSegment = sliceSegments[sliceSegments.length - 1];
    const parentValues = lastSliceInfo
      ? applySegments(matchedSlices, parentSegments.slice(pathSegments(previousSlicePath).length))
      : parentValuesAtPath(resource, sliceInfo.slicePath);

    matchingSlicesByParent = parentValues.map((parent) => ({
      parent,
      childValues: valuesForSegment(parent, sliceChildSegment).filter((candidate) => matchesSlice(profile, slice, candidate, runtime)),
    }));
    matchedSlices = matchingSlicesByParent.flatMap((ctx) => ctx.childValues);
    previousSlicePath = sliceInfo.slicePath;
    lastSliceInfo = sliceInfo;
  }

  if (!lastSliceInfo) {
    return { values: valuesAtPath(resource, element.path), cardinality: [] };
  }

  const sliceSegments = pathSegments(lastSliceInfo.slicePath);
  const targetSegments = pathSegments(element.path);

  if (element.path === lastSliceInfo.slicePath) {
    return {
      values: matchingSlicesByParent.flatMap((ctx) => ctx.childValues),
      cardinality: matchingSlicesByParent,
    };
  }

  const relativeSegments = targetSegments.slice(sliceSegments.length);
  const relativeParentSegments = relativeSegments.slice(0, -1);
  const relativeChildSegment = relativeSegments[relativeSegments.length - 1];
  const cardinality = matchingSlicesByParent.flatMap((sliceCtx) =>
    sliceCtx.childValues.flatMap((matchedSlice) =>
      applySegments([matchedSlice], relativeParentSegments)
        .map((parent) => ({ parent, childValues: valuesForSegment(parent, relativeChildSegment) }))
    )
  );
  return {
    values: cardinality.flatMap((ctx) => ctx.childValues),
    cardinality,
  };
}

function buildResourceLookup(resources: Json[]): Map<string, Json> {
  const out = new Map<string, Json>();
  for (const resource of resources) {
    if (resource.id) {
      out.set(String(resource.id), resource);
      out.set(resourceRef(resource), resource);
    }
    if (resource.resourceType === 'Bundle') {
      for (const entry of resource.entry || []) {
        const child = entry.resource;
        if (!child?.resourceType) continue;
        if (child.id) {
          out.set(String(child.id), child);
          out.set(resourceRef(child), child);
        }
        if (typeof entry.fullUrl === 'string') out.set(entry.fullUrl, child);
      }
    }
  }
  return out;
}

function fhirVersionFromResources(resources: Json[], profile: Json): string | null {
  const profileVersion = typeof profile.fhirVersion === 'string' ? profile.fhirVersion : null;
  if (profileVersion) return profileVersion;
  for (const resource of resources) {
    if (resource.resourceType === 'ImplementationGuide' && typeof resource.fhirVersion === 'string') {
      return resource.fhirVersion;
    }
  }
  return null;
}

function fhirPathModelForVersion(fhirVersion: string | null): Json | undefined {
  if (!fhirVersion) return undefined;
  if (fhirVersion.startsWith('3.0.')) return stu3Model as Json;
  if (fhirVersion.startsWith('4.0.') || fhirVersion.startsWith('4.3.')) return r4Model as Json;
  if (fhirVersion.startsWith('5.') || fhirVersion.startsWith('6.')) return r5Model as Json;
  return undefined;
}

function validationRuntime(resources: Json[], profile: Json): ValidationRuntime {
  return {
    resourcesByRef: buildResourceLookup(resources),
    profilesByUrl: profileUrlIndex([...resources, profile]),
    fhirPathModel: fhirPathModelForVersion(fhirVersionFromResources(resources, profile)),
  };
}

function constraintSeverity(constraint: Json): ValidationSeverity {
  return constraint.severity === 'warning' ? 'warning' : 'error';
}

function fhirPathPasses(result: unknown): boolean {
  return Array.isArray(result) && result.length === 1 && result[0] === true;
}

function constraintLabel(constraint: Json): string {
  return constraint.key || constraint.human || constraint.expression || '(constraint)';
}

function collectNamedPrimitiveDescendants(value: any, names: Set<string>, out: string[] = []): string[] {
  if (!value || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    for (const item of value) collectNamedPrimitiveDescendants(item, names, out);
    return out;
  }
  for (const [key, child] of Object.entries(value)) {
    if (names.has(key) && typeof child === 'string') out.push(child);
    collectNamedPrimitiveDescendants(child, names, out);
  }
  return out;
}

function containedResourcesAreReferenced(resource: Json): boolean {
  const contained = Array.isArray(resource.contained) ? resource.contained : [];
  if (!contained.length) return true;
  const descendantRefs = new Set(collectNamedPrimitiveDescendants(resource, new Set(['reference', 'canonical', 'uri', 'url'])));
  return contained.every((child: Json) => {
    const id = typeof child?.id === 'string' ? child.id : '';
    if (id && descendantRefs.has(`#${id}`)) return true;
    const childRefs = collectNamedPrimitiveDescendants(child, new Set(['reference', 'canonical']));
    return childRefs.includes('#');
  });
}

function evaluateKnownConstraint(resource: Json, constraint: Json): boolean | null {
  // fhirpath.js evaluates most other standard invariants when called with the
  // element base path. The R4 dom-3 expression currently throws on
  // descendants().as(...) over heterogeneous collections, so keep this one
  // compatibility shim narrow.
  if (constraint.key === 'dom-3') return containedResourcesAreReferenced(resource);
  return null;
}

function evaluateFhirPathConstraint(resource: Json, element: Json, context: PathValue, constraint: Json, runtime: ValidationRuntime): unknown {
  const known = evaluateKnownConstraint(resource, constraint);
  if (known !== null) return [known];
  return fhirpath.evaluate(context.value, { base: element.path, expression: constraint.expression }, { resource }, runtime.fhirPathModel, { traceFn: () => {} });
}

function fhirPathSelectorForElement(elementPath: string | undefined): string | null {
  if (!elementPath) return null;
  return elementPath
    .split('.')
    .map((segment) => segment.replace(/\[x\]$/, ''))
    .join('.');
}

function fhirPathElementExpression(element: Json, constraint: Json): string | null {
  const selector = fhirPathSelectorForElement(element.path);
  return selector && constraint.expression ? `${selector}.all(${constraint.expression})` : null;
}

function checkFhirPathConstraints(args: {
  resource: Json;
  profile: Json;
  element: Json;
  values: PathValue[];
  runtime: ValidationRuntime;
}): ValidationIssue[] {
  const { resource, profile, element, values, runtime } = args;
  const constraints = Array.isArray(element.constraint) ? element.constraint : [];
  if (!constraints.length) return [];

  const issues: ValidationIssue[] = [];
  for (const constraint of constraints) {
    if (!constraint?.expression) continue;
    if (!sliceChainInfo(element).length) {
      const expression = fhirPathElementExpression(element, constraint);
      if (!expression) continue;
      try {
        const known = evaluateKnownConstraint(resource, constraint);
        const result = known === null
          ? fhirpath.evaluate(resource, expression, { resource }, runtime.fhirPathModel, { traceFn: () => {} })
          : [known];
        if (fhirPathPasses(result)) continue;
        issues.push({
          severity: constraintSeverity(constraint),
          code: 'fhirpath-constraint',
          message: `${constraintLabel(constraint)} failed: ${constraint.human || constraint.expression}`,
          resourceRef: resourceRef(resource),
          profileUrl: profile.url,
          elementId: elementRef(profile, element),
          path: element.path,
        });
      } catch (e) {
        issues.push({
          severity: 'warning',
          code: 'fhirpath-evaluation',
          message: `${constraintLabel(constraint)} could not be evaluated: ${e instanceof Error ? e.message : String(e)}`,
          resourceRef: resourceRef(resource),
          profileUrl: profile.url,
          elementId: elementRef(profile, element),
          path: element.path,
        });
      }
      continue;
    }

    for (const context of values) {
      try {
        const result = evaluateFhirPathConstraint(resource, element, context, constraint, runtime);
        if (fhirPathPasses(result)) continue;
        issues.push({
          severity: constraintSeverity(constraint),
          code: 'fhirpath-constraint',
          message: `${constraintLabel(constraint)} failed: ${constraint.human || constraint.expression}`,
          resourceRef: resourceRef(resource),
          profileUrl: profile.url,
          elementId: elementRef(profile, element),
          path: context.path || element.path,
        });
      } catch (e) {
        issues.push({
          severity: 'warning',
          code: 'fhirpath-evaluation',
          message: `${constraintLabel(constraint)} could not be evaluated: ${e instanceof Error ? e.message : String(e)}`,
          resourceRef: resourceRef(resource),
          profileUrl: profile.url,
          elementId: elementRef(profile, element),
          path: context.path || element.path,
        });
      }
    }
  }
  return issues;
}

function maxAllowsMoreThanOne(max: unknown): boolean {
  return max === '*' || max === undefined || max === null || Number(max) > 1;
}

function patternField(element: Json): { kind: 'pattern' | 'fixed'; value: any } | null {
  for (const [k, v] of Object.entries(element)) {
    if (k.startsWith('fixed') && v !== undefined) return { kind: 'fixed', value: v };
  }
  for (const [k, v] of Object.entries(element)) {
    if (k.startsWith('pattern') && v !== undefined) return { kind: 'pattern', value: v };
  }
  return null;
}

function matchesPattern(pattern: any, actual: any): boolean {
  if (Array.isArray(pattern)) {
    if (!Array.isArray(actual)) return false;
    return pattern.every((expectedItem) => actual.some((actualItem) => matchesPattern(expectedItem, actualItem)));
  }
  if (pattern && typeof pattern === 'object') {
    if (!actual || typeof actual !== 'object') return false;
    return Object.entries(pattern).every(([k, v]) => matchesPattern(v, actual[k]));
  }
  return Object.is(pattern, actual);
}

function matchesFixed(expected: any, actual: any): boolean {
  return stableJson(expected) === stableJson(actual);
}

function codeKey(system: string | null | undefined, code: string | null | undefined): string | null {
  if (!code) return null;
  return `${system || ''}\u0000${code}`;
}

function codesForValue(value: any): Array<{ system?: string; code: string; display?: string }> {
  if (typeof value === 'string') return [{ code: value }];
  if (!value || typeof value !== 'object') return [];
  if (typeof value.code === 'string') return [{ system: value.system, code: value.code, display: value.display }];
  if (Array.isArray(value.coding)) {
    return value.coding
      .filter((coding: Json) => typeof coding?.code === 'string')
      .map((coding: Json) => ({ system: coding.system, code: coding.code, display: coding.display }));
  }
  return [];
}

function expansionCodeSet(codes: ExpandedValueSetCode[]): Set<string> {
  return new Set(codes.map((c) => codeKey(c.system, c.code)).filter(Boolean) as string[]);
}

function valueSetRef(vs: Json): string {
  return `${vs.resourceType || 'ValueSet'}/${vs.id || canonicalNoVersion(vs.url) || '(anonymous)'}`;
}

function buildValueSetCodeIndex(resources: Json[], expansions?: Map<string, PreparedValueSetExpansion>): ValueSetCodeIndex {
  const byUrl = new Map<string, Json>();
  for (const vs of resources.filter((r) => r.resourceType === 'ValueSet' && r.url)) {
    byUrl.set(canonicalNoVersion(vs.url) || vs.url, vs);
  }

  const index: ValueSetCodeIndex = new Map();
  for (const vs of byUrl.values()) {
    let codes: ExpandedValueSetCode[] | undefined = expansions?.get(valueSetRef(vs))?.codes;
    if (!codes) {
      try {
        codes = expandValueSet(vs, resources);
      } catch {
        codes = undefined;
      }
    }
    if (codes) index.set(canonicalNoVersion(vs.url) || vs.url, expansionCodeSet(codes));
  }
  return index;
}

function checkBinding(args: {
  resource: Json;
  profile: Json;
  element: Json;
  values: PathValue[];
  valueSetCodes: ValueSetCodeIndex;
  options: ValidationOptions;
}): ValidationIssue[] {
  const { resource, profile, element, values, valueSetCodes, options } = args;
  const binding = element.binding;
  if (binding?.strength !== 'required' || !binding.valueSet || values.length === 0) return [];

  const valueSetUrl = normalizeCanonical(binding.valueSet);
  const allowed = valueSetUrl ? valueSetCodes.get(valueSetUrl) : undefined;
  if (!allowed) {
    return options.warnOnUncheckedRequiredBindings ? [{
      severity: 'warning',
      code: 'binding-not-checked',
      message: `Required binding ${binding.valueSet} was not checked because no local or cached expansion is available.`,
      resourceRef: resourceRef(resource),
      profileUrl: profile.url,
      elementId: elementRef(profile, element),
      path: element.path,
    }] : [];
  }

  const issues: ValidationIssue[] = [];
  for (const v of values) {
    const actualCodes = codesForValue(v.value);
    const matched = actualCodes.some((coding) => {
      const withSystem = codeKey(coding.system, coding.code);
      const noSystem = codeKey('', coding.code);
      return (withSystem && allowed.has(withSystem)) || (noSystem && allowed.has(noSystem));
    });
    if (!matched) {
      issues.push({
        severity: 'error',
        code: 'required-binding',
        message: `${element.path} is not in required ValueSet ${binding.valueSet}.`,
        resourceRef: resourceRef(resource),
        profileUrl: profile.url,
        elementId: elementRef(profile, element),
        path: v.path || element.path,
      });
    }
  }
  return issues;
}

function typeProfileUrls(element: Json): string[] {
  return (element.type || []).flatMap((type: Json) => Array.isArray(type.profile) ? type.profile : []);
}

function terminologyCanValidate(options: TerminologyValidationOptions): boolean {
  const mode = options.terminologyOptions?.mode;
  return mode === 'cache' || mode === 'online' || mode === 'refresh';
}

async function validateCodeWithMemo(
  input: ValueSetValidateCodeInput,
  options: TerminologyOptions,
  memo: Map<string, Promise<ValidateCodeResult>>,
): Promise<ValidateCodeResult> {
  const key = stableJson(input);
  const existing = memo.get(key);
  if (existing) return existing;
  const promise = validateValueSetCode(input, options);
  memo.set(key, promise);
  return promise;
}

async function checkBindingWithTerminology(args: {
  resource: Json;
  profile: Json;
  element: Json;
  values: PathValue[];
  valueSetCodes: ValueSetCodeIndex;
  options: TerminologyValidationOptions;
  memo: Map<string, Promise<ValidateCodeResult>>;
}): Promise<ValidationIssue[]> {
  const { resource, profile, element, values, valueSetCodes, options, memo } = args;
  const binding = element.binding;
  const txOptions = options.terminologyOptions;
  if (binding?.strength !== 'required' || !binding.valueSet || values.length === 0 || !txOptions || !terminologyCanValidate(options)) return [];

  const valueSetUrl = normalizeCanonical(binding.valueSet);
  if (!valueSetUrl || valueSetCodes.has(valueSetUrl)) return [];

  const issues: ValidationIssue[] = [];
  for (const v of values) {
    const actualCodes = codesForValue(v.value);
    if (!actualCodes.length) {
      issues.push({
        severity: 'error',
        code: 'required-binding',
        message: `${element.path} has no coded value for required ValueSet ${binding.valueSet}.`,
        resourceRef: resourceRef(resource),
        profileUrl: profile.url,
        elementId: elementRef(profile, element),
        path: v.path || element.path,
      });
      continue;
    }

    const results: ValidateCodeResult[] = [];
    const failures: string[] = [];
    for (const coding of actualCodes) {
      try {
        results.push(await validateCodeWithMemo({
          valueSetUrl,
          valueSetVersion: canonicalVersion(binding.valueSet),
          system: coding.system,
          code: coding.code,
          display: coding.display,
        }, txOptions, memo));
      } catch (e: any) {
        failures.push(e?.message || String(e));
      }
    }

    if (results.some((result) => result.result)) continue;
    if (results.length) {
      const messages = results.map((result) => result.message).filter(Boolean);
      issues.push({
        severity: 'error',
        code: 'required-binding',
        message: `${element.path} is not in required ValueSet ${binding.valueSet}${messages.length ? `: ${messages.join('; ')}` : ''}.`,
        resourceRef: resourceRef(resource),
        profileUrl: profile.url,
        elementId: elementRef(profile, element),
        path: v.path || element.path,
      });
    } else if (options.warnOnUncheckedRequiredBindings) {
      issues.push({
        severity: 'warning',
        code: 'binding-not-checked',
        message: `Required binding ${binding.valueSet} was not checked: ${failures.join('; ') || 'no terminology result available'}.`,
        resourceRef: resourceRef(resource),
        profileUrl: profile.url,
        elementId: elementRef(profile, element),
        path: v.path || element.path,
      });
    }
  }
  return issues;
}

export function exampleProfileAssignments(resources: Json[]): ExampleProfileAssignment[] {
  const byRef = new Map(resources.map((r) => [resourceRef(r), r]));
  const out: ExampleProfileAssignment[] = [];

  for (const resource of resources) {
    for (const profileUrl of resource.meta?.profile || []) {
      if (typeof profileUrl === 'string') out.push({ resource, profileUrl, source: 'meta.profile' });
    }
  }

  for (const ig of resources.filter((r) => r.resourceType === 'ImplementationGuide')) {
    for (const entry of ig.definition?.resource || []) {
      const profileUrl = entry.exampleCanonical || entry.profile;
      const ref = entry.reference?.reference;
      const resource = ref ? byRef.get(ref) : undefined;
      if (resource && typeof profileUrl === 'string') {
        out.push({ resource, profileUrl, source: 'implementation-guide' });
      }
    }
  }

  const seen = new Set<string>();
  return out.filter((assignment) => {
    const key = `${resourceRef(assignment.resource)}\u0000${canonicalNoVersion(assignment.profileUrl)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function validateResourceAgainstProfile(
  resource: Json,
  profile: Json,
  resources: Json[],
  options: ValidationOptions = {},
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const runtime = validationRuntime(resources, profile);
  if (profile.resourceType !== 'StructureDefinition') {
    return [{
      severity: 'error',
      code: 'not-structure-definition',
      message: `Profile ${profile.url || profile.id || '(unknown)'} is not a StructureDefinition.`,
      resourceRef: resourceRef(resource),
      profileUrl: profile.url,
    }];
  }
  if (profile.type && resource.resourceType !== profile.type) {
    issues.push({
      severity: 'error',
      code: 'resource-type',
      message: `Resource type ${resource.resourceType || '(missing)'} does not match profile type ${profile.type}.`,
      resourceRef: resourceRef(resource),
      profileUrl: profile.url,
    });
  }

  const valueSetCodes = buildValueSetCodeIndex(resources, options.valueSetExpansions);
  for (const element of profile.snapshot?.element || []) {
    const context = elementContext(resource, profile, element, runtime);
    const values = context.values;
    for (const { parent, childValues } of context.cardinality) {
      if (element.min > 0 && childValues.length < element.min) {
        issues.push({
          severity: 'error',
          code: 'min-cardinality',
          message: `${element.path} requires at least ${element.min} value${element.min === 1 ? '' : 's'}, found ${childValues.length}.`,
          resourceRef: resourceRef(resource),
          profileUrl: profile.url,
          elementId: elementRef(profile, element),
          path: parent.path || element.path,
        });
      }
      if (!maxAllowsMoreThanOne(element.max) && childValues.length > 1) {
        issues.push({
          severity: 'error',
          code: 'max-cardinality',
          message: `${element.path} allows at most one value, found ${childValues.length}.`,
          resourceRef: resourceRef(resource),
          profileUrl: profile.url,
          elementId: elementRef(profile, element),
          path: parent.path || element.path,
        });
      }
    }

    const requiredValue = patternField(element);
    if (requiredValue && values.length) {
      for (const value of values) {
        const ok = requiredValue.kind === 'fixed'
          ? matchesFixed(requiredValue.value, value.value)
          : matchesPattern(requiredValue.value, value.value);
        if (!ok) {
          issues.push({
            severity: 'error',
            code: requiredValue.kind === 'fixed' ? 'fixed-value' : 'pattern-value',
            message: `${element.path} does not match required ${requiredValue.kind} ${stableJson(requiredValue.value)}.`,
            resourceRef: resourceRef(resource),
            profileUrl: profile.url,
            elementId: elementRef(profile, element),
            path: value.path || element.path,
          });
        }
      }
    }

    issues.push(...checkBinding({ resource, profile, element, values, valueSetCodes, options }));
    issues.push(...checkFhirPathConstraints({ resource, profile, element, values, runtime }));
  }
  return issues;
}

export async function validateResourceAgainstProfileWithTerminology(
  resource: Json,
  profile: Json,
  resources: Json[],
  options: TerminologyValidationOptions = {},
): Promise<ValidationIssue[]> {
  const baseOptions = terminologyCanValidate(options)
    ? { ...options, warnOnUncheckedRequiredBindings: false }
    : options;
  const issues = validateResourceAgainstProfile(resource, profile, resources, baseOptions);
  if (!terminologyCanValidate(options)) return issues;

  const valueSetCodes = buildValueSetCodeIndex(resources, options.valueSetExpansions);
  const runtime = validationRuntime(resources, profile);
  const memo = new Map<string, Promise<ValidateCodeResult>>();
  for (const element of profile.snapshot?.element || []) {
    const context = elementContext(resource, profile, element, runtime);
    issues.push(...await checkBindingWithTerminology({
      resource,
      profile,
      element,
      values: context.values,
      valueSetCodes,
      options,
      memo,
    }));
  }
  return issues;
}

async function validateNestedProfileAssertions(args: {
  resource: Json;
  profile: Json;
  resources: Json[];
  indexes: PublisherCanonicalIndexes;
  options: TerminologyValidationOptions;
  seen: Set<string>;
}): Promise<ValidationIssue[]> {
  const { resource, profile, resources, indexes, options, seen } = args;
  const issues: ValidationIssue[] = [];
  const runtime = validationRuntime(resources, profile);
  for (const element of profile.snapshot?.element || []) {
    const profileUrls = typeProfileUrls(element);
    if (!profileUrls.length) continue;
    const values = elementContext(resource, profile, element, runtime).values
      .filter((value) => value.value?.resourceType);
    for (const value of values) {
      for (const assertedUrl of profileUrls) {
        const profileUrl = normalizeCanonical(assertedUrl);
        const nestedProfile = profileUrl ? resolvePublisherResource(indexes, { resourceType: 'StructureDefinition', url: profileUrl }) : undefined;
        if (!nestedProfile) {
          issues.push({
            severity: 'error',
            code: 'unknown-profile',
            message: `${element.path} asserts unknown profile ${assertedUrl}.`,
            resourceRef: resourceRef(value.value),
            profileUrl: assertedUrl,
            elementId: elementRef(profile, element),
            path: value.path || element.path,
          });
          continue;
        }
        const key = `${resourceRef(value.value)}\u0000${canonicalNoVersion(nestedProfile.url)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        issues.push(...await validateResourceAgainstProfileWithTerminology(value.value, nestedProfile, resources, options));
        issues.push(...await validateNestedProfileAssertions({
          resource: value.value,
          profile: nestedProfile,
          resources,
          indexes,
          options,
          seen,
        }));
      }
    }
  }
  return issues;
}

export function validateAssignedExamples(
  resources: Json[],
  indexes: PublisherCanonicalIndexes,
  options: ValidationOptions = {},
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const assignment of exampleProfileAssignments(resources)) {
    const profileUrl = normalizeCanonical(assignment.profileUrl);
    const profile = profileUrl ? resolvePublisherResource(indexes, { resourceType: 'StructureDefinition', url: profileUrl }) : undefined;
    if (!profile) {
      issues.push({
        severity: 'error',
        code: 'unknown-profile',
        message: `${assignment.source} references unknown profile ${assignment.profileUrl}.`,
        resourceRef: resourceRef(assignment.resource),
        profileUrl: assignment.profileUrl,
      });
      continue;
    }
    issues.push(...validateResourceAgainstProfile(assignment.resource, profile, resources, options));
  }
  return issues;
}

export async function validateAssignedExamplesWithTerminology(
  resources: Json[],
  indexes: PublisherCanonicalIndexes,
  options: TerminologyValidationOptions = {},
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  const seen = new Set<string>();
  for (const assignment of exampleProfileAssignments(resources)) {
    const profileUrl = normalizeCanonical(assignment.profileUrl);
    const profile = profileUrl ? resolvePublisherResource(indexes, { resourceType: 'StructureDefinition', url: profileUrl }) : undefined;
    if (!profile) {
      issues.push({
        severity: 'error',
        code: 'unknown-profile',
        message: `${assignment.source} references unknown profile ${assignment.profileUrl}.`,
        resourceRef: resourceRef(assignment.resource),
        profileUrl: assignment.profileUrl,
      });
      continue;
    }
    const key = `${resourceRef(assignment.resource)}\u0000${canonicalNoVersion(profile.url)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push(...await validateResourceAgainstProfileWithTerminology(assignment.resource, profile, resources, options));
    issues.push(...await validateNestedProfileAssertions({
      resource: assignment.resource,
      profile,
      resources,
      indexes,
      options,
      seen,
    }));
  }
  return issues;
}
