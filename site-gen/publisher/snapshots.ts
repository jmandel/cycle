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

export function completeStructureDefinitionSnapshots(resources: Json[], indexes: PublisherCanonicalIndexes): Json[] {
  return resources.map((resource) => {
    if (resource.resourceType !== 'StructureDefinition' || hasSnapshot(resource)) return resource;
    const snapshotElements = generatedSnapshotElements(resource, indexes);
    if (!snapshotElements.length) return resource;
    return {
      ...resource,
      snapshot: {
        element: snapshotElements,
      },
    };
  });
}
