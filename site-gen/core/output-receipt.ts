/** Browser-neutral canonical SiteOutput contract used by Cycle and Rust. */
import { compareUtf8 } from './order';

export const SITE_OUTPUT_SCHEMA = 'site-output/v1' as const;
export const SITE_OUTPUT_MANIFEST_PATH = 'site-output.json' as const;
export const CYCLE_OUTPUT_RECEIPT_SCHEMA = SITE_OUTPUT_SCHEMA;
export const CYCLE_OUTPUT_RECEIPT_PATH = SITE_OUTPUT_MANIFEST_PATH;
export const CYCLE_OUTPUT_SCHEMA = 'cycle-static-site/v1' as const;
export const CYCLE_RENDERER_IDENTITY = Object.freeze({ id: 'cycle-site', version: '1' } as const);

export interface CycleProducerIdentity {
  id: string;
  version: string;
}

export interface CycleRendererImplementation extends CycleProducerIdentity {
  recipeSha256: string;
}

export interface CycleOutputDeclaration {
  path: string;
  mediaType: string;
  producer: CycleProducerIdentity;
  source?: string;
  owner?: string;
}

export interface CycleOutputMaterial extends CycleOutputDeclaration {
  content: string | Uint8Array;
}

export interface SiteOutputContentRef {
  sha256: string;
  byteLength: number;
  mediaType: string;
}

export interface CycleOutputReceiptFile {
  path: string;
  content: SiteOutputContentRef;
  producer: CycleProducerIdentity;
  source?: string;
  owner?: string;
}

export interface CycleOutputReceipt {
  schemaVersion: typeof SITE_OUTPUT_SCHEMA;
  inputBuildId: string;
  renderer: CycleRendererImplementation;
  outputSchema: string;
  options: Record<string, string>;
  cacheKey: string;
  files: CycleOutputReceiptFile[];
  outputId: string;
}

type CacheKeyPayload = Omit<CycleOutputReceipt, 'cacheKey' | 'files' | 'outputId'>;
type OutputIdPayload = Omit<CycleOutputReceipt, 'outputId'>;

const encoder = new TextEncoder();

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const keys = new Set(allowed);
  const unexpected = Object.keys(value).find((key) => !keys.has(key));
  if (unexpected) throw new Error(`${label} has unexpected field '${unexpected}'`);
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value || value !== value.trim() || value.includes('\0')) {
    throw new Error(`${label} must be a non-empty, trimmed string without NUL`);
  }
  return value;
}

function assertSha256(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest`);
  }
}

export function assertCycleOutputPath(path: unknown, label = 'Cycle output path'): asserts path is string {
  if (typeof path !== 'string'
    || !path
    || path.startsWith('/')
    || path.includes('\\')
    || path.includes(':')
    || /[\x00-\x1f\x7f]/.test(path)
    || path.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`${label} is unsafe: ${String(path)}`);
  }
  if (path === SITE_OUTPUT_MANIFEST_PATH) {
    throw new Error(`${label} collides with reserved manifest path '${SITE_OUTPUT_MANIFEST_PATH}'`);
  }
}

function assertProducer(value: unknown, label: string): asserts value is CycleProducerIdentity {
  assertObject(value, label);
  assertOnlyKeys(value, ['id', 'version'], label);
  nonEmptyString(value.id, `${label}.id`);
  nonEmptyString(value.version, `${label}.version`);
}

function assertRenderer(value: unknown, label: string): asserts value is CycleRendererImplementation {
  assertObject(value, label);
  assertOnlyKeys(value, ['id', 'version', 'recipeSha256'], label);
  nonEmptyString(value.id, `${label}.id`);
  nonEmptyString(value.version, `${label}.version`);
  assertSha256(value.recipeSha256, `${label}.recipeSha256`);
}

function assertDeclaration(value: unknown, label: string): asserts value is CycleOutputDeclaration {
  assertObject(value, label);
  assertOnlyKeys(value, ['path', 'mediaType', 'producer', 'source', 'owner'], label);
  assertCycleOutputPath(value.path, `${label}.path`);
  nonEmptyString(value.mediaType, `${label}.mediaType`);
  assertProducer(value.producer, `${label}.producer`);
  if (hasOwn(value, 'source')) nonEmptyString(value.source, `${label}.source`);
  if (hasOwn(value, 'owner')) assertCycleOutputPath(value.owner, `${label}.owner`);
}

function copyProducer(value: CycleProducerIdentity): CycleProducerIdentity {
  return { id: value.id, version: value.version };
}

function copyOptions(value: Readonly<Record<string, string>>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of Object.keys(value).sort(compareUtf8)) {
    nonEmptyString(key, 'SiteOutput option key');
    if (typeof value[key] !== 'string') throw new Error(`SiteOutput option '${key}' must be a string`);
    result[key] = value[key];
  }
  return result;
}

function bytesOf(content: string | Uint8Array): Uint8Array {
  if (typeof content === 'string') return encoder.encode(content);
  if (!(content instanceof Uint8Array)) throw new Error('Cycle output content must be a string or Uint8Array');
  return new Uint8Array(content);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('SiteOutput canonical JSON cannot contain a non-finite number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value !== 'object') throw new Error(`SiteOutput canonical JSON cannot contain ${typeof value}`);
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort(compareUtf8)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto SHA-256 is required for SiteOutput');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function prefixedHash(prefix: string, value: unknown): Promise<string> {
  return `${prefix}${await sha256(encoder.encode(canonicalJson(value)))}`;
}

function assertInputBuildId(value: unknown): asserts value is string {
  if (typeof value !== 'string'
    || !/^sb1-sha256:[0-9a-f]{64}$/.test(value)) {
    throw new Error('SiteOutput inputBuildId must be a SiteBuild SHA-256 id');
  }
}

async function receiptFiles(outputs: readonly CycleOutputMaterial[]): Promise<CycleOutputReceiptFile[]> {
  const seen = new Set<string>();
  const files = await Promise.all(outputs.map(async (output, index): Promise<CycleOutputReceiptFile> => {
    const { content, mediaType, ...rest } = output;
    assertDeclaration({ ...rest, mediaType }, `SiteOutput file[${index}]`);
    if (seen.has(rest.path)) throw new Error(`Duplicate Cycle output path '${rest.path}'`);
    seen.add(rest.path);
    const bytes = bytesOf(content);
    return {
      path: rest.path,
      content: { sha256: await sha256(bytes), byteLength: bytes.byteLength, mediaType },
      producer: copyProducer(rest.producer),
      ...(rest.source === undefined ? {} : { source: rest.source }),
      ...(rest.owner === undefined ? {} : { owner: rest.owner }),
    };
  }));
  files.sort((left, right) => compareUtf8(left.path, right.path));
  const paths = new Set(files.map((file) => file.path));
  for (const file of files) {
    if (file.owner !== undefined && !paths.has(file.owner)) {
      throw new Error(`SiteOutput '${file.path}' names missing owner '${file.owner}'`);
    }
  }
  return files;
}

function assertReceiptFile(value: unknown, label: string): asserts value is CycleOutputReceiptFile {
  assertObject(value, label);
  assertOnlyKeys(value, ['path', 'content', 'producer', 'source', 'owner'], label);
  assertCycleOutputPath(value.path, `${label}.path`);
  assertObject(value.content, `${label}.content`);
  assertOnlyKeys(value.content, ['sha256', 'byteLength', 'mediaType'], `${label}.content`);
  assertSha256(value.content.sha256, `${label}.content.sha256`);
  if (!Number.isSafeInteger(value.content.byteLength) || Number(value.content.byteLength) < 0) {
    throw new Error(`${label}.content.byteLength must be a non-negative safe integer`);
  }
  nonEmptyString(value.content.mediaType, `${label}.content.mediaType`);
  assertProducer(value.producer, `${label}.producer`);
  if (hasOwn(value, 'source')) nonEmptyString(value.source, `${label}.source`);
  if (hasOwn(value, 'owner')) assertCycleOutputPath(value.owner, `${label}.owner`);
}

export async function validateCycleOutputReceipt(value: unknown): Promise<CycleOutputReceipt> {
  assertObject(value, 'SiteOutput');
  assertOnlyKeys(
    value,
    ['schemaVersion', 'inputBuildId', 'renderer', 'outputSchema', 'options', 'cacheKey', 'files', 'outputId'],
    'SiteOutput',
  );
  if (value.schemaVersion !== SITE_OUTPUT_SCHEMA) throw new Error(`Unsupported SiteOutput schema '${String(value.schemaVersion)}'`);
  assertInputBuildId(value.inputBuildId);
  assertRenderer(value.renderer, 'SiteOutput renderer');
  nonEmptyString(value.outputSchema, 'SiteOutput outputSchema');
  assertObject(value.options, 'SiteOutput options');
  const options = copyOptions(value.options as Record<string, string>);
  if (!Array.isArray(value.files)) throw new Error('SiteOutput files must be an array');
  let previous: string | null = null;
  const paths = new Set<string>();
  for (let index = 0; index < value.files.length; index++) {
    const file = value.files[index];
    assertReceiptFile(file, `SiteOutput files[${index}]`);
    if (previous !== null && compareUtf8(previous, file.path) >= 0) {
      throw new Error(previous === file.path ? `SiteOutput repeats path '${file.path}'` : 'SiteOutput files are not in canonical UTF-8 path order');
    }
    previous = file.path;
    paths.add(file.path);
  }
  for (const file of value.files as CycleOutputReceiptFile[]) {
    if (file.owner !== undefined && !paths.has(file.owner)) throw new Error(`SiteOutput '${file.path}' names missing owner '${file.owner}'`);
  }
  if (typeof value.cacheKey !== 'string' || !/^sok1-sha256:[0-9a-f]{64}$/.test(value.cacheKey)) throw new Error('Invalid SiteOutput cacheKey');
  if (typeof value.outputId !== 'string' || !/^so1-sha256:[0-9a-f]{64}$/.test(value.outputId)) throw new Error('Invalid SiteOutput outputId');
  const receipt = value as unknown as CycleOutputReceipt;
  const cachePayload: CacheKeyPayload = {
    schemaVersion: SITE_OUTPUT_SCHEMA,
    inputBuildId: receipt.inputBuildId,
    renderer: receipt.renderer,
    outputSchema: receipt.outputSchema,
    options,
  };
  const expectedCacheKey = await prefixedHash('sok1-sha256:', cachePayload);
  if (receipt.cacheKey !== expectedCacheKey) throw new Error(`SiteOutput cache key mismatch: ${receipt.cacheKey} != ${expectedCacheKey}`);
  const outputPayload: OutputIdPayload = { ...cachePayload, cacheKey: receipt.cacheKey, files: receipt.files };
  const expectedOutputId = await prefixedHash('so1-sha256:', outputPayload);
  if (receipt.outputId !== expectedOutputId) throw new Error(`SiteOutput id mismatch: ${receipt.outputId} != ${expectedOutputId}`);
  return receipt;
}

export async function verifyCycleOutputReceipt(
  receiptValue: unknown,
  outputs: readonly CycleOutputMaterial[],
): Promise<void> {
  const receipt = await validateCycleOutputReceipt(receiptValue);
  const files = await receiptFiles(outputs);
  if (canonicalJson(files) !== canonicalJson(receipt.files)) {
    throw new Error('SiteOutput files do not match the authenticated output bytes and declarations');
  }
}

export interface SiteOutputContentStore {
  get(reference: SiteOutputContentRef): Promise<Uint8Array | null>;
}

/** Verify every addressed output through a browser or native ContentStore. */
export async function verifySiteOutputStore(
  receiptValue: unknown,
  store: SiteOutputContentStore,
): Promise<CycleOutputReceipt> {
  const receipt = await validateCycleOutputReceipt(receiptValue);
  for (const file of receipt.files) {
    const bytes = await store.get(file.content);
    if (!bytes) throw new Error(`ContentStore is missing SiteOutput '${file.path}' (${file.content.sha256})`);
    if (bytes.byteLength !== file.content.byteLength) {
      throw new Error(`ContentStore length mismatch for SiteOutput '${file.path}'`);
    }
    if (await sha256(bytes) !== file.content.sha256) {
      throw new Error(`ContentStore digest mismatch for SiteOutput '${file.path}'`);
    }
  }
  return receipt;
}

export async function equalCycleOutputReceipts(left: unknown, right: unknown): Promise<boolean> {
  return (await validateCycleOutputReceipt(left)).outputId === (await validateCycleOutputReceipt(right)).outputId;
}

export function serializeCycleOutputReceipt(receipt: CycleOutputReceipt): string {
  // Match Rust `SiteOutput::canonical_bytes()` exactly. The receipt is one
  // shared wire value; native cache publication must not need a newline-
  // tolerant parallel serialization.
  return canonicalJson(receipt);
}

export function rendererOutputDeclaration(output: {
  file: string;
  mime: string;
  producer: string;
  owner?: string;
}): CycleOutputDeclaration {
  return {
    path: output.file,
    mediaType: output.mime,
    producer: copyProducer(CYCLE_RENDERER_IDENTITY),
    source: output.producer,
    ...(output.owner === undefined ? {} : { owner: output.owner }),
  };
}

export type SiteOutput = CycleOutputReceipt;
export type SiteOutputFile = CycleOutputReceiptFile;
export type SiteOutputMaterial = CycleOutputMaterial;
export const validateSiteOutput = validateCycleOutputReceipt;
export const verifySiteOutput = verifyCycleOutputReceipt;
export const serializeSiteOutput = serializeCycleOutputReceipt;
