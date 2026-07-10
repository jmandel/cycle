/**
 * Portable, read-only access to one verified callback-free SiteBuild.
 *
 * A ContentStore is only a byte transport. It cannot compile, resolve packages,
 * or materialize missing artifacts. ClosedBuildHandle verifies the immutable
 * manifest and every reachable addressed object up front. Reads then return
 * copies of those verified immutable bytes.
 */

import { compareUtf8 } from './order';

export interface ContentRef {
  sha256: string;
  byteLength: number;
  mediaType?: string;
}

export interface SourceEntry {
  content: ContentRef;
  kind: unknown;
}

export interface LockedPackage {
  coordinate: string;
  content: ContentRef;
  dependencies?: string[];
}

export type ArtifactKey = { kind: string } & Record<string, unknown>;

export type ReadDependency =
  | { kind: 'artifact'; key: ArtifactKey }
  | { kind: 'source'; path: string }
  | { kind: 'package'; coordinate: string }
  | { kind: 'content'; sha256: string };

export type ArtifactState =
  | { status: 'ready'; content: ContentRef }
  | { status: 'deferred'; reason: string }
  | { status: 'unsupported'; capability: string; reason: string }
  | { status: 'failed'; diagnostics: unknown[] };

export interface ArtifactRecord {
  key: ArtifactKey;
  state: ArtifactState;
  provenance: unknown;
  reads?: ReadDependency[];
}

/** Runtime-facing shape of the Rust `site-build/v1` wire value. */
export interface ClosedSiteBuild {
  schemaVersion: 'site-build/v1';
  buildId: string;
  project: {
    projectId: string;
    revision: string;
    sources: Record<string, SourceEntry>;
  };
  packageLock: Record<string, LockedPackage>;
  renderTarget: {
    renderer: { id: string; version: string };
    mode: 'native_template' | 'external_builder';
    fhirVersion: string;
    template?: string;
    parameters?: Record<string, string>;
  };
  renderPlan: { requiredArtifacts: ArtifactKey[] };
  artifacts: ArtifactRecord[];
  diagnostics: unknown[];
}

/** Read-only content-addressed byte transport. Returning `null` is a miss. */
export interface ContentStore {
  get(content: ContentRef): Promise<Uint8Array | null>;
}

export interface ClosedBuildOpenOptions {
  /**
   * `render-closure` is sufficient for a host transporting only the requested
   * renderer artifacts (for example the browser). A filesystem Fig bundle is a
   * complete distribution and should select `all-addressed` to verify every
   * source, package, and ready-artifact body it claims to contain.
   */
  verify?: 'render-closure' | 'all-addressed';
}

function stableJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('SiteBuild canonical JSON cannot contain a non-finite number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (typeof value !== 'object') throw new Error(`SiteBuild canonical JSON cannot contain ${typeof value}`);
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .filter((key) => object[key] !== undefined)
    .sort(compareUtf8)
    .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
    .join(',')}}`;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto SHA-256 is required to verify a SiteBuild');
  // Copy onto an ordinary ArrayBuffer so DOM typings (and Web Crypto hosts) do
  // not have to accept a possible SharedArrayBuffer-backed view.
  const input = new Uint8Array(bytes.byteLength);
  input.set(bytes);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', input.buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Canonical identity used for typed keys in maps and closure traversal. */
export function artifactKeyId(key: ArtifactKey): string {
  return stableJson(key);
}

/** Recompute the Rust `sb1-sha256` identity at a JS trust boundary. */
export async function computeSiteBuildId(build: ClosedSiteBuild): Promise<string> {
  const payload = { ...build } as Record<string, unknown>;
  delete payload.buildId;
  const digest = await sha256(new TextEncoder().encode(stableJson(payload)));
  return `sb1-sha256:${digest}`;
}

function cloneAndFreeze<T>(value: T): T {
  const clone = JSON.parse(JSON.stringify(value)) as T;
  const freeze = (candidate: unknown): void => {
    if (!candidate || typeof candidate !== 'object' || Object.isFrozen(candidate)) return;
    for (const child of Object.values(candidate as Record<string, unknown>)) freeze(child);
    Object.freeze(candidate);
  };
  freeze(clone);
  return clone;
}

function blocker(record: ArtifactRecord): string {
  switch (record.state.status) {
    case 'ready': return 'ready';
    case 'deferred': return `deferred: ${record.state.reason}`;
    case 'unsupported': return `unsupported (${record.state.capability}): ${record.state.reason}`;
    case 'failed': return `failed (${record.state.diagnostics.length} diagnostic(s))`;
  }
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function hasOwn(record: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function assertOnlyKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const allowed = new Set(keys);
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length) throw new Error(`${label} has unexpected field ${unexpected[0]}`);
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function assertStringMap(value: unknown, label: string): asserts value is Record<string, string> {
  assertRecord(value, label);
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== 'string') throw new Error(`${label}.${key} must be a string`);
  }
}

function assertCanonicalSet<T>(
  values: readonly T[],
  compare: (left: T, right: T) => number,
  label: string,
): void {
  for (let index = 1; index < values.length; index++) {
    const order = compare(values[index - 1], values[index]);
    if (order === 0) throw new Error(`${label} contains a duplicate member`);
    if (order > 0) throw new Error(`${label} is not in canonical Rust order`);
  }
}

function isSourcePath(value: string): boolean {
  return value.length > 0
    && !value.startsWith('/')
    && !value.includes('\\')
    && !value.includes('\0')
    && value.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..');
}

function isExactPackageCoordinate(value: string): boolean {
  const split = value.indexOf('#');
  if (split <= 0 || split !== value.lastIndexOf('#')) return false;
  const packageId = value.slice(0, split);
  const version = value.slice(split + 1);
  const lower = version.toLowerCase();
  return packageId === packageId.trim()
    && version === version.trim()
    && packageId.length > 0
    && version.length > 0
    && !/[\s/\\\0]/.test(packageId)
    && !/[\s/\\\0^~<>=|,]/.test(version)
    && lower !== 'latest'
    && lower !== 'current'
    && lower !== 'dev'
    && !version.includes('*')
    && !version.split('.').some((part) => part.toLowerCase() === 'x');
}

function assertSourceKind(value: unknown, label: string): void {
  assertRecord(value, label);
  const kind = value.kind;
  if (kind === 'other') {
    assertOnlyKeys(value, ['kind', 'name'], label);
    nonEmptyString(value.name, `${label}.name`);
    return;
  }
  if (!['fsh', 'config', 'predefined_resource', 'page', 'template', 'asset'].includes(String(kind))) {
    throw new Error(`${label} has unsupported kind ${String(kind)}`);
  }
  assertOnlyKeys(value, ['kind'], label);
}

function assertResourceKey(value: unknown, label: string): asserts value is Record<string, unknown> {
  assertRecord(value, label);
  assertOnlyKeys(value, ['resourceType', 'id'], label);
  nonEmptyString(value.resourceType, `${label}.resourceType`);
  nonEmptyString(value.id, `${label}.id`);
}

function assertFragmentScope(value: unknown, label: string): void {
  assertRecord(value, label);
  if (value.kind === 'whole_ig') {
    assertOnlyKeys(value, ['kind'], label);
  } else if (value.kind === 'resource') {
    assertOnlyKeys(value, ['kind', 'resource'], label);
    assertResourceKey(value.resource, `${label}.resource`);
  } else {
    throw new Error(`${label} has unsupported kind ${String(value.kind)}`);
  }
}

function assertFragmentKind(value: unknown, label: string): void {
  assertRecord(value, label);
  if (value.kind === 'other') {
    assertOnlyKeys(value, ['kind', 'name'], label);
    nonEmptyString(value.name, `${label}.name`);
  } else if (['narrative', 'summary', 'dictionary', 'terminology', 'table'].includes(String(value.kind))) {
    assertOnlyKeys(value, ['kind'], label);
  } else {
    throw new Error(`${label} has unsupported kind ${String(value.kind)}`);
  }
}

function assertAssetNamespace(value: unknown, label: string): void {
  assertRecord(value, label);
  if (value.kind === 'other') {
    assertOnlyKeys(value, ['kind', 'name'], label);
    nonEmptyString(value.name, `${label}.name`);
  } else if (['authored', 'template', 'publisher_runtime', 'generated'].includes(String(value.kind))) {
    assertOnlyKeys(value, ['kind'], label);
  } else {
    throw new Error(`${label} has unsupported kind ${String(value.kind)}`);
  }
}

function assertArtifactKey(value: unknown, label: string): asserts value is ArtifactKey {
  assertRecord(value, label);
  switch (value.kind) {
    case 'semantic_model':
      assertOnlyKeys(value, ['kind', 'name'], label);
      nonEmptyString(value.name, `${label}.name`);
      break;
    case 'resource':
      assertOnlyKeys(value, ['kind', 'resource'], label);
      assertResourceKey(value.resource, `${label}.resource`);
      break;
    case 'fragment':
      assertOnlyKeys(value, ['kind', 'scope', 'fragment', 'parameters'], label);
      assertFragmentScope(value.scope, `${label}.scope`);
      assertFragmentKind(value.fragment, `${label}.fragment`);
      if (value.parameters !== undefined) {
        assertStringMap(value.parameters, `${label}.parameters`);
        if (!Object.keys(value.parameters).length) throw new Error(`${label}.parameters must be omitted when empty`);
      }
      break;
    case 'page':
      assertOnlyKeys(value, ['kind', 'path'], label);
      if (typeof value.path !== 'string' || !isSourcePath(value.path)) throw new Error(`${label}.path is invalid`);
      break;
    case 'asset':
      assertOnlyKeys(value, ['kind', 'namespace', 'path'], label);
      assertAssetNamespace(value.namespace, `${label}.namespace`);
      if (typeof value.path !== 'string' || !isSourcePath(value.path)) throw new Error(`${label}.path is invalid`);
      break;
    case 'data':
      assertOnlyKeys(value, ['kind', 'namespace', 'name'], label);
      nonEmptyString(value.namespace, `${label}.namespace`);
      nonEmptyString(value.name, `${label}.name`);
      break;
    default:
      throw new Error(`${label} has unsupported kind ${String(value.kind)}`);
  }
}

function compareStringMap(left: Record<string, unknown> | undefined, right: Record<string, unknown> | undefined): number {
  const a = Object.entries(left || {}).sort(([x], [y]) => compareUtf8(x, y));
  const b = Object.entries(right || {}).sort(([x], [y]) => compareUtf8(x, y));
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    const key = compareUtf8(a[index][0], b[index][0]);
    if (key) return key;
    const value = compareUtf8(String(a[index][1]), String(b[index][1]));
    if (value) return value;
  }
  return a.length - b.length;
}

function compareResourceKey(left: Record<string, unknown>, right: Record<string, unknown>): number {
  return compareUtf8(String(left.resourceType), String(right.resourceType))
    || compareUtf8(String(left.id), String(right.id));
}

function compareFragmentScope(left: Record<string, unknown>, right: Record<string, unknown>): number {
  const rank = (value: unknown) => value === 'whole_ig' ? 0 : 1;
  const variant = rank(left.kind) - rank(right.kind);
  if (variant || left.kind === 'whole_ig') return variant;
  return compareResourceKey(left.resource as Record<string, unknown>, right.resource as Record<string, unknown>);
}

function compareNamedVariant(left: Record<string, unknown>, right: Record<string, unknown>, order: readonly string[]): number {
  const variant = order.indexOf(String(left.kind)) - order.indexOf(String(right.kind));
  if (variant || left.kind !== 'other') return variant;
  return compareUtf8(String(left.name), String(right.name));
}

function compareArtifactKey(left: ArtifactKey, right: ArtifactKey): number {
  const variants = ['semantic_model', 'resource', 'fragment', 'page', 'asset', 'data'];
  const variant = variants.indexOf(left.kind) - variants.indexOf(right.kind);
  if (variant) return variant;
  switch (left.kind) {
    case 'semantic_model': return compareUtf8(String(left.name), String(right.name));
    case 'resource': return compareResourceKey(
      left.resource as Record<string, unknown>,
      right.resource as Record<string, unknown>,
    );
    case 'fragment':
      return compareFragmentScope(
        left.scope as Record<string, unknown>,
        right.scope as Record<string, unknown>,
      ) || compareNamedVariant(
        left.fragment as Record<string, unknown>,
        right.fragment as Record<string, unknown>,
        ['narrative', 'summary', 'dictionary', 'terminology', 'table', 'other'],
      ) || compareStringMap(
        left.parameters as Record<string, unknown> | undefined,
        right.parameters as Record<string, unknown> | undefined,
      );
    case 'page': return compareUtf8(String(left.path), String(right.path));
    case 'asset':
      return compareNamedVariant(
        left.namespace as Record<string, unknown>,
        right.namespace as Record<string, unknown>,
        ['authored', 'template', 'publisher_runtime', 'generated', 'other'],
      ) || compareUtf8(String(left.path), String(right.path));
    case 'data':
      return compareUtf8(String(left.namespace), String(right.namespace))
        || compareUtf8(String(left.name), String(right.name));
    default: return 0;
  }
}

function severityRank(value: unknown): number {
  return ['information', 'warning', 'error'].indexOf(String(value));
}

function assertDiagnostic(value: unknown, label: string): void {
  assertRecord(value, label);
  assertOnlyKeys(value, ['sequence', 'severity', 'code', 'message', 'location'], label);
  if (!Number.isSafeInteger(value.sequence) || (value.sequence as number) < 0) {
    throw new Error(`${label}.sequence must be a non-negative safe integer`);
  }
  if (severityRank(value.severity) < 0) throw new Error(`${label}.severity is invalid`);
  nonEmptyString(value.code, `${label}.code`);
  nonEmptyString(value.message, `${label}.message`);
  if (value.location !== undefined) {
    assertRecord(value.location, `${label}.location`);
    assertOnlyKeys(value.location, ['path', 'line', 'column'], `${label}.location`);
    if (typeof value.location.path !== 'string' || !isSourcePath(value.location.path)) {
      throw new Error(`${label}.location.path is invalid`);
    }
    if (!Number.isSafeInteger(value.location.line) || (value.location.line as number) < 1) {
      throw new Error(`${label}.location.line must be one-based`);
    }
    if (!Number.isSafeInteger(value.location.column) || (value.location.column as number) < 0) {
      throw new Error(`${label}.location.column is invalid`);
    }
  }
}

function compareDiagnostic(left: unknown, right: unknown): number {
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  const scalar = Number(a.sequence) - Number(b.sequence)
    || severityRank(a.severity) - severityRank(b.severity)
    || compareUtf8(String(a.code), String(b.code))
    || compareUtf8(String(a.message), String(b.message));
  if (scalar) return scalar;
  if (a.location === undefined || b.location === undefined) {
    return a.location === b.location ? 0 : a.location === undefined ? -1 : 1;
  }
  const al = a.location as Record<string, unknown>;
  const bl = b.location as Record<string, unknown>;
  return compareUtf8(String(al.path), String(bl.path))
    || Number(al.line) - Number(bl.line)
    || Number(al.column) - Number(bl.column);
}

function assertContentRef(value: unknown, label: string): asserts value is ContentRef {
  assertRecord(value, label);
  assertOnlyKeys(value, ['sha256', 'byteLength', 'mediaType'], label);
  if (typeof value.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(value.sha256)) {
    throw new Error(`${label} has an invalid SHA-256 digest`);
  }
  if (!Number.isSafeInteger(value.byteLength) || (value.byteLength as number) < 0) {
    throw new Error(`${label} has an invalid byte length`);
  }
  if (value.mediaType !== undefined && (typeof value.mediaType !== 'string' || !value.mediaType.trim())) {
    throw new Error(`${label} has an invalid media type`);
  }
}

function assertProvenance(value: unknown, label: string): void {
  assertRecord(value, label);
  assertOnlyKeys(value, ['producer', 'recipe', 'attributes'], label);
  assertRecord(value.producer, `${label}.producer`);
  assertOnlyKeys(value.producer, ['id', 'version'], `${label}.producer`);
  nonEmptyString(value.producer.id, `${label}.producer.id`);
  nonEmptyString(value.producer.version, `${label}.producer.version`);
  nonEmptyString(value.recipe, `${label}.recipe`);
  if (value.attributes !== undefined) {
    assertStringMap(value.attributes, `${label}.attributes`);
    if (!Object.keys(value.attributes).length) throw new Error(`${label}.attributes must be omitted when empty`);
  }
}

function assertArtifactState(value: unknown, label: string): void {
  assertRecord(value, label);
  switch (value.status) {
    case 'ready':
      assertOnlyKeys(value, ['status', 'content'], label);
      assertContentRef(value.content, `${label}.content`);
      break;
    case 'deferred':
      assertOnlyKeys(value, ['status', 'reason'], label);
      nonEmptyString(value.reason, `${label}.reason`);
      break;
    case 'unsupported':
      assertOnlyKeys(value, ['status', 'capability', 'reason'], label);
      nonEmptyString(value.capability, `${label}.capability`);
      nonEmptyString(value.reason, `${label}.reason`);
      break;
    case 'failed': {
      assertOnlyKeys(value, ['status', 'diagnostics'], label);
      if (!Array.isArray(value.diagnostics) || !value.diagnostics.length) {
        throw new Error(`${label}.diagnostics must be a non-empty array`);
      }
      value.diagnostics.forEach((diagnostic, index) => assertDiagnostic(diagnostic, `${label}.diagnostics[${index}]`));
      assertCanonicalSet(value.diagnostics, compareDiagnostic, `${label}.diagnostics`);
      break;
    }
    default:
      throw new Error(`${label} has unsupported status ${String(value.status)}`);
  }
}

function compareReadDependency(left: ReadDependency, right: ReadDependency): number {
  const variants = ['source', 'package', 'artifact', 'content'];
  const variant = variants.indexOf(left.kind) - variants.indexOf(right.kind);
  if (variant) return variant;
  switch (left.kind) {
    case 'source': return compareUtf8(left.path, (right as typeof left).path);
    case 'package': return compareUtf8(left.coordinate, (right as typeof left).coordinate);
    case 'artifact': return compareArtifactKey(left.key, (right as typeof left).key);
    case 'content': return compareUtf8(left.sha256, (right as typeof left).sha256);
  }
}

function assertReadDependency(value: unknown, label: string): asserts value is ReadDependency {
  assertRecord(value, label);
  switch (value.kind) {
    case 'source':
      assertOnlyKeys(value, ['kind', 'path'], label);
      if (typeof value.path !== 'string' || !isSourcePath(value.path)) throw new Error(`${label}.path is invalid`);
      break;
    case 'package':
      assertOnlyKeys(value, ['kind', 'coordinate'], label);
      if (typeof value.coordinate !== 'string' || !isExactPackageCoordinate(value.coordinate)) {
        throw new Error(`${label}.coordinate is invalid`);
      }
      break;
    case 'artifact':
      assertOnlyKeys(value, ['kind', 'key'], label);
      assertArtifactKey(value.key, `${label}.key`);
      break;
    case 'content':
      assertOnlyKeys(value, ['kind', 'sha256'], label);
      if (typeof value.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(value.sha256)) {
        throw new Error(`${label}.sha256 is invalid`);
      }
      break;
    default:
      throw new Error(`${label} has unsupported kind ${String(value.kind)}`);
  }
}

/**
 * Mirror the Rust contract's referential checks at the JavaScript trust
 * boundary. Source/package refs describe bytes read by artifact producers; a
 * renderer verifies their identities and references but only needs to fetch
 * the ready artifact bodies in its declared render-plan closure.
 */
function verifyManifestReferences(build: ClosedSiteBuild, records: Map<string, ArtifactRecord>): void {
  assertRecord(build, 'SiteBuild');
  assertOnlyKeys(build, [
    'schemaVersion', 'buildId', 'project', 'packageLock', 'renderTarget',
    'renderPlan', 'artifacts', 'diagnostics',
  ], 'SiteBuild');
  if (typeof build.buildId !== 'string' || !/^sb1-sha256:[0-9a-f]{64}$/.test(build.buildId)) {
    throw new Error('SiteBuild has an invalid build id');
  }
  assertRecord(build.project, 'SiteBuild project');
  assertOnlyKeys(build.project, ['projectId', 'revision', 'sources'], 'SiteBuild project');
  nonEmptyString(build.project.projectId, 'SiteBuild project id');
  nonEmptyString(build.project.revision, 'SiteBuild project revision');
  assertRecord(build.project.sources, 'SiteBuild source manifest');
  assertRecord(build.packageLock, 'SiteBuild package lock');

  for (const [path, source] of Object.entries(build.project.sources)) {
    if (!isSourcePath(path)) throw new Error(`SiteBuild source path is invalid: ${path}`);
    assertRecord(source, `SiteBuild source ${path}`);
    assertOnlyKeys(source, ['kind', 'content'], `SiteBuild source ${path}`);
    assertSourceKind(source.kind, `SiteBuild source ${path} kind`);
    assertContentRef(source.content, `SiteBuild source ${path} content`);
  }

  for (const [coordinate, pkg] of Object.entries(build.packageLock)) {
    if (!isExactPackageCoordinate(coordinate)) throw new Error(`SiteBuild package coordinate is invalid: ${coordinate}`);
    assertRecord(pkg, `SiteBuild package ${coordinate}`);
    assertOnlyKeys(pkg, ['coordinate', 'content', 'dependencies'], `SiteBuild package ${coordinate}`);
    if (pkg.coordinate !== coordinate) {
      throw new Error(`SiteBuild package key ${coordinate} disagrees with embedded coordinate ${String(pkg.coordinate)}`);
    }
    assertContentRef(pkg.content, `SiteBuild package ${coordinate} content`);
    if (pkg.dependencies !== undefined && !Array.isArray(pkg.dependencies)) {
      throw new Error(`SiteBuild package ${coordinate} dependencies must be an array`);
    }
    if (pkg.dependencies !== undefined && pkg.dependencies.length === 0) {
      throw new Error(`SiteBuild package ${coordinate} dependencies must be omitted when empty`);
    }
    assertCanonicalSet(pkg.dependencies || [], compareUtf8, `SiteBuild package ${coordinate} dependencies`);
    for (const dependency of pkg.dependencies || []) {
      if (typeof dependency !== 'string' || !isExactPackageCoordinate(dependency) || !hasOwn(build.packageLock, dependency)) {
        throw new Error(`SiteBuild package ${coordinate} references missing dependency ${String(dependency)}`);
      }
    }
  }

  assertRecord(build.renderTarget, 'SiteBuild render target');
  assertOnlyKeys(build.renderTarget, ['renderer', 'mode', 'fhirVersion', 'template', 'parameters'], 'SiteBuild render target');
  assertRecord(build.renderTarget.renderer, 'SiteBuild renderer');
  assertOnlyKeys(build.renderTarget.renderer, ['id', 'version'], 'SiteBuild renderer');
  nonEmptyString(build.renderTarget.renderer.id, 'SiteBuild renderer id');
  nonEmptyString(build.renderTarget.renderer.version, 'SiteBuild renderer version');
  if (!['native_template', 'external_builder'].includes(build.renderTarget.mode)) {
    throw new Error(`SiteBuild render mode is invalid: ${String(build.renderTarget.mode)}`);
  }
  nonEmptyString(build.renderTarget.fhirVersion, 'SiteBuild FHIR version');
  if (build.renderTarget.template !== undefined) {
    if (!isExactPackageCoordinate(build.renderTarget.template) || !hasOwn(build.packageLock, build.renderTarget.template)) {
      throw new Error(`SiteBuild render target references missing template ${String(build.renderTarget.template)}`);
    }
  }
  if (build.renderTarget.parameters !== undefined) {
    assertStringMap(build.renderTarget.parameters, 'SiteBuild render parameters');
    if (!Object.keys(build.renderTarget.parameters).length) {
      throw new Error('SiteBuild render parameters must be omitted when empty');
    }
  }

  assertRecord(build.renderPlan, 'SiteBuild render plan');
  assertOnlyKeys(build.renderPlan, ['requiredArtifacts'], 'SiteBuild render plan');
  if (!Array.isArray(build.renderPlan.requiredArtifacts)) {
    throw new Error('SiteBuild required artifacts must be an array');
  }
  build.renderPlan.requiredArtifacts.forEach((key, index) => assertArtifactKey(key, `SiteBuild required artifact[${index}]`));
  assertCanonicalSet(build.renderPlan.requiredArtifacts, compareArtifactKey, 'SiteBuild required artifacts');

  if (!Array.isArray(build.artifacts)) throw new Error('SiteBuild artifacts must be an array');
  build.artifacts.forEach((record, index) => {
    assertRecord(record, `SiteBuild artifact[${index}]`);
    assertOnlyKeys(record, ['key', 'state', 'provenance', 'reads'], `SiteBuild artifact[${index}]`);
    assertArtifactKey(record.key, `SiteBuild artifact[${index}].key`);
    assertArtifactState(record.state, `SiteBuild artifact[${index}].state`);
    assertProvenance(record.provenance, `SiteBuild artifact[${index}].provenance`);
    if (record.reads !== undefined) {
      if (!Array.isArray(record.reads)) throw new Error(`SiteBuild artifact[${index}].reads must be an array`);
      if (!record.reads.length) throw new Error(`SiteBuild artifact[${index}].reads must be omitted when empty`);
      record.reads.forEach((read, readIndex) => assertReadDependency(read, `SiteBuild artifact[${index}].reads[${readIndex}]`));
      assertCanonicalSet(record.reads, compareReadDependency, `SiteBuild artifact[${index}].reads`);
    }
  });
  assertCanonicalSet(build.artifacts, (left, right) => compareArtifactKey(left.key, right.key), 'SiteBuild artifacts');

  if (!Array.isArray(build.diagnostics)) throw new Error('SiteBuild diagnostics must be an array');
  build.diagnostics.forEach((diagnostic, index) => assertDiagnostic(diagnostic, `SiteBuild diagnostics[${index}]`));
  assertCanonicalSet(build.diagnostics, compareDiagnostic, 'SiteBuild diagnostics');

  for (const [id, record] of records) {
    for (const dependency of record.reads || []) {
      switch (dependency.kind) {
        case 'artifact': {
          assertRecord(dependency.key, `SiteBuild artifact ${id} artifact read key`);
          const dependencyId = artifactKeyId(dependency.key as ArtifactKey);
          if (!records.has(dependencyId)) {
            throw new Error(`SiteBuild artifact ${id} references missing artifact ${dependencyId}`);
          }
          break;
        }
        case 'source':
          if (typeof dependency.path !== 'string' || !hasOwn(build.project.sources, dependency.path)) {
            throw new Error(`SiteBuild artifact ${id} references missing source ${String(dependency.path)}`);
          }
          break;
        case 'package':
          if (typeof dependency.coordinate !== 'string' || !hasOwn(build.packageLock, dependency.coordinate)) {
            throw new Error(
              `SiteBuild artifact ${id} references missing package ${String(dependency.coordinate)}`,
            );
          }
          break;
        case 'content':
          if (typeof dependency.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(dependency.sha256)) {
            throw new Error(`SiteBuild artifact ${id} has an invalid content read digest`);
          }
          break;
        default:
          throw new Error(
            `SiteBuild artifact ${id} has an unsupported read kind ${String((dependency as { kind?: unknown }).kind)}`,
          );
      }
    }
  }
}

/**
 * An immutable manifest paired with scoped, verified artifact access.
 *
 * Only artifacts reachable from the declared render-plan roots may be read.
 * This keeps "closed" meaningful: a renderer cannot discover an undeclared
 * semantic dependency after construction.
 */
export class ClosedBuildHandle {
  readonly manifest: ClosedSiteBuild;
  private readonly records = new Map<string, ArtifactRecord>();
  private readonly reachable = new Set<string>();
  private readonly objects = new Map<string, Uint8Array>();

  private constructor(manifest: ClosedSiteBuild) {
    this.manifest = manifest;
  }

  static async open(
    manifest: ClosedSiteBuild,
    store: ContentStore,
    options: ClosedBuildOpenOptions = {},
  ): Promise<ClosedBuildHandle> {
    const frozen = cloneAndFreeze(manifest);
    assertRecord(frozen, 'SiteBuild');
    if (frozen.schemaVersion !== 'site-build/v1') {
      throw new Error(`Unsupported SiteBuild schema ${String(frozen.schemaVersion)}`);
    }
    const handle = new ClosedBuildHandle(frozen);
    if (!Array.isArray(frozen.artifacts)) throw new Error('SiteBuild artifacts must be an array');
    for (const record of frozen.artifacts) {
      assertRecord(record, 'SiteBuild artifact');
      assertArtifactKey(record.key, 'SiteBuild artifact key');
      const id = artifactKeyId(record.key);
      if (handle.records.has(id)) throw new Error(`SiteBuild contains duplicate artifact key ${id}`);
      handle.records.set(id, record);
    }
    verifyManifestReferences(frozen, handle.records);
    const expected = await computeSiteBuildId(frozen);
    if (frozen.buildId !== expected) {
      throw new Error(`SiteBuild id mismatch: received ${frozen.buildId}, computed ${expected}`);
    }

    const pending = [...frozen.renderPlan.requiredArtifacts];
    while (pending.length) {
      const key = pending.pop()!;
      const id = artifactKeyId(key);
      if (handle.reachable.has(id)) continue;
      handle.reachable.add(id);
      const record = handle.records.get(id);
      if (!record) throw new Error(`Closed SiteBuild is missing required artifact ${id}`);
      if (record.state.status !== 'ready') {
        throw new Error(`Closed SiteBuild artifact ${id} is ${blocker(record)}`);
      }
      for (const dependency of record.reads || []) {
        if (dependency.kind === 'artifact') pending.push((dependency as { key: ArtifactKey }).key);
      }
    }

    // A closed manifest is not enough: prove the selected physical object
    // closure is present and correct before exposing the handle. Browser hosts
    // can transport only the render closure; a native Fig directory verifies
    // every object addressed by the distribution manifest.
    const addressed: Array<{ label: string; content: ContentRef }> = [];
    if ((options.verify || 'render-closure') === 'all-addressed') {
      for (const [path, source] of Object.entries(frozen.project.sources).sort(([a], [b]) => compareUtf8(a, b))) {
        addressed.push({ label: `source ${path}`, content: source.content });
      }
      for (const [coordinate, pkg] of Object.entries(frozen.packageLock).sort(([a], [b]) => compareUtf8(a, b))) {
        addressed.push({ label: `package ${coordinate}`, content: pkg.content });
      }
      for (const [id, record] of [...handle.records].sort(([a], [b]) => compareUtf8(a, b))) {
        if (record.state.status === 'ready') addressed.push({ label: `artifact ${id}`, content: record.state.content });
      }
    } else {
      for (const id of [...handle.reachable].sort(compareUtf8)) {
        const record = handle.records.get(id)!;
        if (record.state.status !== 'ready') throw new Error(`Closed SiteBuild artifact ${id} is ${blocker(record)}`);
        addressed.push({ label: `artifact ${id}`, content: record.state.content });
      }
    }

    const verifiedByDigest = new Map<string, Uint8Array>();
    for (const { label, content: expected } of addressed) {
      let bytes = verifiedByDigest.get(expected.sha256);
      if (!bytes) {
        const loaded = await store.get(expected);
        if (!loaded) throw new Error(`Content store is missing sha256:${expected.sha256} for ${label}`);
        bytes = loaded.slice();
        if (bytes.byteLength !== expected.byteLength) {
          throw new Error(`${label} length mismatch: expected ${expected.byteLength}, received ${bytes.byteLength}`);
        }
        const actual = await sha256(bytes);
        if (actual !== expected.sha256) {
          throw new Error(`${label} digest mismatch: expected ${expected.sha256}, received ${actual}`);
        }
        verifiedByDigest.set(expected.sha256, bytes);
      } else if (bytes.byteLength !== expected.byteLength) {
        throw new Error(`${label} length mismatch: expected ${expected.byteLength}, received ${bytes.byteLength}`);
      }
    }

    // Access remains renderer-scoped even when a distribution received the
    // stronger all-addressed integrity check.
    for (const id of handle.reachable) {
      const record = handle.records.get(id)!;
      if (record.state.status !== 'ready') throw new Error(`Closed SiteBuild artifact ${id} is ${blocker(record)}`);
      const bytes = verifiedByDigest.get(record.state.content.sha256);
      if (!bytes) throw new Error(`Verified object cache is missing artifact ${id}`);
      handle.objects.set(id, bytes);
    }
    return handle;
  }

  hasArtifact(key: ArtifactKey): boolean {
    return this.reachable.has(artifactKeyId(key));
  }

  artifactRecord(key: ArtifactKey): ArtifactRecord {
    const id = artifactKeyId(key);
    if (!this.reachable.has(id)) throw new Error(`Artifact is outside the closed render plan: ${id}`);
    return this.records.get(id)!;
  }

  async readArtifact(key: ArtifactKey): Promise<Uint8Array> {
    const record = this.artifactRecord(key);
    if (record.state.status !== 'ready') {
      // `open` proves this for every reachable record; keep the check local so a
      // future wire-version change cannot accidentally weaken the byte boundary.
      throw new Error(`Artifact ${artifactKeyId(key)} is ${blocker(record)}`);
    }
    const id = artifactKeyId(key);
    const bytes = this.objects.get(id);
    if (!bytes) throw new Error(`Verified object cache is missing artifact ${id}`);
    return bytes.slice();
  }

  async readTextArtifact(key: ArtifactKey): Promise<string> {
    return new TextDecoder().decode(await this.readArtifact(key));
  }
}
