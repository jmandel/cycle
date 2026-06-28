import { canonicalNoVersion, resolvePublisherResource, type PublisherCanonicalIndexes } from './canonical';

type Json = Record<string, any>;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function hasSnapshot(resource: Json): boolean {
  return Array.isArray(resource.snapshot?.element) && resource.snapshot.element.length > 0;
}

export function missingStructureDefinitionSnapshots(resources: Json[]): string[] {
  return resources
    .filter((r) => r.resourceType === 'StructureDefinition')
    .filter((r) => !hasSnapshot(r))
    .map((r) => `${r.id || '(no id)'}${r.url ? ` <${r.url}>` : ''}`);
}

export function assertStructureDefinitionSnapshots(resources: Json[]): void {
  const missing = missingStructureDefinitionSnapshots(resources);
  if (missing.length) {
    throw new Error([
      'StructureDefinition snapshots are required for a publisher-grade package.db.',
      'site-gen renders profile pages from Resources.Json.snapshot.element; reconstructing snapshots in the renderer is intentionally unsupported.',
      'Run the publisher with integrated SUSHI enabled, or provide snapshot-bearing StructureDefinitions with PUBLISHER_RUN_SUSHI=0.',
      `Missing snapshots: ${missing.slice(0, 12).join(', ')}${missing.length > 12 ? `, ... ${missing.length - 12} more` : ''}`,
    ].join('\n'));
  }
}

function snapshotElementKey(element: Json): string | null {
  return typeof element.path === 'string' ? element.path : typeof element.id === 'string' ? element.id : null;
}

function normalizedDifferentialElement(element: Json): Json {
  const out = clone(element);
  if (!out.id && typeof out.path === 'string') out.id = out.path;
  if (!out.path && typeof out.id === 'string') out.path = out.id.split(':')[0];
  if (out.path && !out.base) out.base = { path: out.path, min: out.min ?? 0, max: out.max ?? '*' };
  return out;
}

function mergeElement(base: Json, differential: Json): Json {
  const diff = normalizedDifferentialElement(differential);
  return {
    ...clone(base),
    ...diff,
    base: diff.base || base.base || (diff.path ? { path: diff.path, min: diff.min ?? base.min ?? 0, max: diff.max ?? base.max ?? '*' } : undefined),
  };
}

function overlayDifferential(baseElements: Json[], differentialElements: Json[]): Json[] {
  const out = baseElements.map(clone);
  const byKey = new Map<string, number>();
  out.forEach((element, index) => {
    const key = snapshotElementKey(element);
    if (key && !byKey.has(key)) byKey.set(key, index);
  });

  for (const differential of differentialElements) {
    const normalized = normalizedDifferentialElement(differential);
    const key = snapshotElementKey(normalized);
    if (!key) continue;
    const existing = byKey.get(key);
    if (existing !== undefined) {
      out[existing] = mergeElement(out[existing], normalized);
    } else {
      byKey.set(key, out.length);
      out.push(normalized);
    }
  }
  return out;
}

function baseSnapshotFor(sd: Json, indexes: PublisherCanonicalIndexes): Json[] | null {
  const baseDefinition = canonicalNoVersion(sd.baseDefinition);
  if (!baseDefinition || baseDefinition === 'http://hl7.org/fhir/StructureDefinition/Base') return null;
  const base = resolvePublisherResource(indexes, { resourceType: 'StructureDefinition', url: baseDefinition });
  return hasSnapshot(base || {}) ? clone(base!.snapshot.element) : null;
}

function generatedSnapshotElements(sd: Json, indexes: PublisherCanonicalIndexes): Json[] {
  const differential = Array.isArray(sd.differential?.element) ? sd.differential.element : [];
  const baseElements = baseSnapshotFor(sd, indexes);
  if (!baseElements) return differential.map(normalizedDifferentialElement);
  return overlayDifferential(baseElements, differential);
}

function elementKey(element: Json): string | null {
  return typeof element.id === 'string' ? element.id : typeof element.path === 'string' ? element.path : null;
}

function choiceSliceRootPath(element: Json): string | null {
  const id = typeof element.id === 'string' ? element.id : '';
  if (!id.includes('[x]:')) return null;
  const path = typeof element.path === 'string' ? element.path : id.split(':')[0];
  return path.includes('[x]') ? path : null;
}

function bindableType(element: Json): boolean {
  return (element.type || []).some((type: Json) => {
    const code = type?.code;
    return code === 'code'
      || code === 'Coding'
      || code === 'CodeableConcept'
      || code === 'CodeableReference'
      || code === 'Quantity';
  });
}

function reconcileChoiceSliceBindings(sd: Json, indexes: PublisherCanonicalIndexes): Json {
  if (!hasSnapshot(sd)) return sd;
  const baseElements = baseSnapshotFor(sd, indexes);
  if (!baseElements) return sd;

  const baseByPath = new Map<string, Json>();
  for (const base of baseElements) {
    if (typeof base.path === 'string' && !baseByPath.has(base.path)) baseByPath.set(base.path, base);
  }

  const differentialByKey = new Map<string, Json>();
  for (const differential of sd.differential?.element || []) {
    const key = elementKey(differential);
    if (key) differentialByKey.set(key, differential);
  }

  let changed = false;
  const snapshotElements = sd.snapshot.element.map((element: Json) => {
    const rootPath = choiceSliceRootPath(element);
    if (!rootPath) return element;
    const diff = elementKey(element) ? differentialByKey.get(elementKey(element)!) : undefined;
    if (diff?.binding) return element;

    const base = baseByPath.get(rootPath);
    if (!base?.binding) return element;

    const next = clone(element);
    if (bindableType(element)) {
      if (JSON.stringify(next.binding) === JSON.stringify(base.binding)) return element;
      next.binding = clone(base.binding);
      changed = true;
      return next;
    }
    if (next.binding) {
      delete next.binding;
      changed = true;
      return next;
    }
    return element;
  });

  return changed ? { ...sd, snapshot: { ...sd.snapshot, element: snapshotElements } } : sd;
}

export function completeStructureDefinitionSnapshots(resources: Json[], indexes: PublisherCanonicalIndexes): Json[] {
  return resources.map((resource) => {
    if (resource.resourceType !== 'StructureDefinition') return resource;
    if (hasSnapshot(resource)) return reconcileChoiceSliceBindings(resource, indexes);
    const snapshotElements = generatedSnapshotElements(resource, indexes);
    if (!snapshotElements.length) return resource;
    return reconcileChoiceSliceBindings({
      ...resource,
      snapshot: {
        element: snapshotElements,
      },
    }, indexes);
  });
}
