/**
 * Browser-compatible content-addressed receipt for one complete Cycle output.
 *
 * This module deliberately has no Node/Bun, filesystem, React, or renderer
 * imports. A browser and a native host get the same receipt when they supply
 * the same input identity, renderer identity, declarations, and bytes.
 */
import { compareUtf8 } from './order';

export const CYCLE_OUTPUT_RECEIPT_SCHEMA = 'cycle-output-receipt/v1' as const;
export const CYCLE_OUTPUT_RECEIPT_PATH = 'cycle-output-receipt.json' as const;
export const CYCLE_RENDERER_IDENTITY = Object.freeze({ id: 'cycle-site', version: '1' } as const);

export interface CycleProducerIdentity {
  id: string;
  version?: string;
}

export interface CycleOutputDeclaration {
  path: string;
  mediaType: string;
  producer: CycleProducerIdentity;
  /** Stable logical source/recipe name when the producer can provide one. */
  source?: string;
  /** Owning HTML output for an auxiliary renderer output. */
  owner?: string;
}

export interface CycleOutputMaterial extends CycleOutputDeclaration {
  content: string | Uint8Array;
}

export interface CycleOutputReceiptFile extends CycleOutputDeclaration {
  byteLength: number;
  sha256: string;
}

export interface CycleOutputReceipt {
  schemaVersion: typeof CYCLE_OUTPUT_RECEIPT_SCHEMA;
  inputBuildId: string;
  renderer: CycleProducerIdentity;
  files: CycleOutputReceiptFile[];
  /** SHA-256 of canonical UTF-8 JSON for every preceding field. */
  outputBuildId: string;
}

export interface CreateCycleOutputReceiptOptions {
  /** Normally `sb1-sha256:...`; legacy SQLite builds use an explicit byte id. */
  inputBuildId: string;
  renderer?: CycleProducerIdentity;
  outputs: readonly CycleOutputMaterial[];
}

interface CycleOutputReceiptPayload {
  schemaVersion: typeof CYCLE_OUTPUT_RECEIPT_SCHEMA;
  inputBuildId: string;
  renderer: CycleProducerIdentity;
  files: CycleOutputReceiptFile[];
}

const encoder = new TextEncoder();

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
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

/** Reject path traversal, platform-dependent separators, and receipt recursion. */
export function assertCycleOutputPath(path: unknown, label = 'Cycle output path'): asserts path is string {
  if (typeof path !== 'string'
    || !path
    || path.startsWith('/')
    || path.includes('\\')
    || path.includes('\0')
    || path.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`${label} is unsafe: ${String(path)}`);
  }
  if (path === CYCLE_OUTPUT_RECEIPT_PATH) {
    throw new Error(`${label} collides with reserved receipt path '${CYCLE_OUTPUT_RECEIPT_PATH}'`);
  }
}

function assertProducer(value: unknown, label: string): asserts value is CycleProducerIdentity {
  assertObject(value, label);
  assertOnlyKeys(value, ['id', 'version'], label);
  nonEmptyString(value.id, `${label}.id`);
  if (hasOwn(value, 'version')) nonEmptyString(value.version, `${label}.version`);
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
  return value.version === undefined ? { id: value.id } : { id: value.id, version: value.version };
}

function copyDeclaration(value: CycleOutputDeclaration): CycleOutputDeclaration {
  return {
    path: value.path,
    mediaType: value.mediaType,
    producer: copyProducer(value.producer),
    ...(value.source === undefined ? {} : { source: value.source }),
    ...(value.owner === undefined ? {} : { owner: value.owner }),
  };
}

function bytesOf(content: string | Uint8Array): Uint8Array {
  if (typeof content === 'string') return encoder.encode(content);
  if (!(content instanceof Uint8Array)) throw new Error('Cycle output content must be a string or Uint8Array');
  const copy = new Uint8Array(content.byteLength);
  copy.set(content);
  return copy;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Cycle receipt canonical JSON cannot contain a non-finite number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value !== 'object') throw new Error(`Cycle receipt canonical JSON cannot contain ${typeof value}`);
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort(compareUtf8)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto SHA-256 is required for a Cycle output receipt');
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', copy.buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function outputBuildId(payload: CycleOutputReceiptPayload): Promise<string> {
  const digest = await sha256(encoder.encode(canonicalJson(payload)));
  return `cob1-sha256:${digest}`;
}

function assertInputBuildId(value: unknown): asserts value is string {
  if (typeof value !== 'string'
    || !/^(?:sb1|legacy-site-db)-sha256:[0-9a-f]{64}$/.test(value)) {
    throw new Error('Cycle receipt inputBuildId must be a SiteBuild or explicit legacy SQLite SHA-256 id');
  }
}

/**
 * Compute one deterministic receipt. Input order is irrelevant; output paths
 * are unique and sorted by UTF-8 bytes before the overall digest is computed.
 */
export async function createCycleOutputReceipt(
  options: CreateCycleOutputReceiptOptions,
): Promise<CycleOutputReceipt> {
  assertInputBuildId(options.inputBuildId);
  const renderer = options.renderer || CYCLE_RENDERER_IDENTITY;
  assertProducer(renderer, 'Cycle receipt renderer');
  const seen = new Set<string>();
  const pending = options.outputs.map(async (output, index): Promise<CycleOutputReceiptFile> => {
    const { content, ...declaration } = output;
    assertDeclaration(declaration, `Cycle output[${index}]`);
    if (seen.has(declaration.path)) throw new Error(`Duplicate Cycle output path '${declaration.path}'`);
    seen.add(declaration.path);
    const bytes = bytesOf(content);
    return {
      ...copyDeclaration(declaration),
      byteLength: bytes.byteLength,
      sha256: await sha256(bytes),
    };
  });
  const files = await Promise.all(pending);
  files.sort((left, right) => compareUtf8(left.path, right.path));
  const payload: CycleOutputReceiptPayload = {
    schemaVersion: CYCLE_OUTPUT_RECEIPT_SCHEMA,
    inputBuildId: options.inputBuildId,
    renderer: copyProducer(renderer),
    files,
  };
  return { ...payload, outputBuildId: await outputBuildId(payload) };
}

function assertReceiptFile(value: unknown, label: string): asserts value is CycleOutputReceiptFile {
  assertObject(value, label);
  assertOnlyKeys(
    value,
    ['path', 'mediaType', 'producer', 'source', 'owner', 'byteLength', 'sha256'],
    label,
  );
  const { byteLength, sha256: digest, ...declaration } = value;
  assertDeclaration(declaration, label);
  if (!Number.isSafeInteger(byteLength) || Number(byteLength) < 0) {
    throw new Error(`${label}.byteLength must be a non-negative safe integer`);
  }
  if (typeof digest !== 'string' || !/^[0-9a-f]{64}$/.test(digest)) {
    throw new Error(`${label}.sha256 must be a lowercase SHA-256 digest`);
  }
}

/** Validate the wire shape, canonical order, and overall content identity. */
export async function validateCycleOutputReceipt(value: unknown): Promise<CycleOutputReceipt> {
  assertObject(value, 'Cycle output receipt');
  assertOnlyKeys(
    value,
    ['schemaVersion', 'inputBuildId', 'renderer', 'files', 'outputBuildId'],
    'Cycle output receipt',
  );
  if (value.schemaVersion !== CYCLE_OUTPUT_RECEIPT_SCHEMA) {
    throw new Error(`Unsupported Cycle output receipt schema '${String(value.schemaVersion)}'`);
  }
  assertInputBuildId(value.inputBuildId);
  assertProducer(value.renderer, 'Cycle output receipt renderer');
  if (!Array.isArray(value.files)) throw new Error('Cycle output receipt files must be an array');
  let previous: string | null = null;
  for (let index = 0; index < value.files.length; index++) {
    const file = value.files[index];
    assertReceiptFile(file, `Cycle output receipt files[${index}]`);
    if (previous !== null) {
      const order = compareUtf8(previous, file.path);
      if (order === 0) throw new Error(`Cycle output receipt repeats path '${file.path}'`);
      if (order > 0) throw new Error('Cycle output receipt files are not in canonical UTF-8 path order');
    }
    previous = file.path;
  }
  if (typeof value.outputBuildId !== 'string' || !/^cob1-sha256:[0-9a-f]{64}$/.test(value.outputBuildId)) {
    throw new Error('Cycle output receipt outputBuildId must be a cob1 SHA-256 id');
  }
  const receipt = value as unknown as CycleOutputReceipt;
  const payload: CycleOutputReceiptPayload = {
    schemaVersion: receipt.schemaVersion,
    inputBuildId: receipt.inputBuildId,
    renderer: receipt.renderer,
    files: receipt.files,
  };
  const expected = await outputBuildId(payload);
  if (receipt.outputBuildId !== expected) {
    throw new Error(`Cycle output receipt id mismatch: received ${receipt.outputBuildId}, computed ${expected}`);
  }
  return receipt;
}

/**
 * Verify a materialized output set against a receipt. The receipt file itself
 * is intentionally not an input: including its own bytes would recurse.
 */
export async function verifyCycleOutputReceipt(
  receiptValue: unknown,
  outputs: readonly CycleOutputMaterial[],
): Promise<void> {
  const receipt = await validateCycleOutputReceipt(receiptValue);
  const actual = await createCycleOutputReceipt({
    inputBuildId: receipt.inputBuildId,
    renderer: receipt.renderer,
    outputs,
  });
  const expectedByPath = new Map(receipt.files.map((file) => [file.path, file]));
  const actualByPath = new Map(actual.files.map((file) => [file.path, file]));
  const missing = receipt.files.filter((file) => !actualByPath.has(file.path)).map((file) => file.path);
  const extra = actual.files.filter((file) => !expectedByPath.has(file.path)).map((file) => file.path);
  if (missing.length || extra.length) {
    throw new Error(`Cycle output set mismatch; missing=[${missing.join(', ')}], extra=[${extra.join(', ')}]`);
  }
  for (const expected of receipt.files) {
    const got = actualByPath.get(expected.path)!;
    if (canonicalJson(got) !== canonicalJson(expected)) {
      throw new Error(`Cycle output '${expected.path}' does not match its receipt`);
    }
  }
  if (actual.outputBuildId !== receipt.outputBuildId) {
    throw new Error(`Cycle output build mismatch: received ${actual.outputBuildId}, expected ${receipt.outputBuildId}`);
  }
}

/** Compare two independently transported receipts after validating both. */
export async function equalCycleOutputReceipts(left: unknown, right: unknown): Promise<boolean> {
  const a = await validateCycleOutputReceipt(left);
  const b = await validateCycleOutputReceipt(right);
  return a.outputBuildId === b.outputBuildId;
}

/** Deterministic receipt-file bytes; the file is not a member of `files`. */
export function serializeCycleOutputReceipt(receipt: CycleOutputReceipt): string {
  return `${canonicalJson(receipt)}\n`;
}

/** Convert one `CycleSiteRenderer.listOutputs()` descriptor without importing React. */
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

export interface CycleRendererOutputProvider {
  listOutputs(): Array<{ file: string; mime: string; producer: string; owner?: string }>;
  renderOutput(file: string): {
    file: string;
    mime: string;
    content: string | Uint8Array;
  };
}

/**
 * Browser convenience over the renderer's complete logical namespace. Native
 * hosts pass their design/client materials as `additionalOutputs` to compute
 * the same complete-tree receipt with this same pure implementation.
 */
export async function createCycleRendererOutputReceipt(options: {
  inputBuildId: string;
  renderer: CycleRendererOutputProvider;
  additionalOutputs?: readonly CycleOutputMaterial[];
}): Promise<CycleOutputReceipt> {
  const outputs: CycleOutputMaterial[] = [];
  for (const descriptor of options.renderer.listOutputs()) {
    const rendered = options.renderer.renderOutput(descriptor.file);
    if (rendered.file !== descriptor.file) {
      throw new Error(`Cycle renderer returned '${rendered.file}' for declared output '${descriptor.file}'`);
    }
    if (rendered.mime !== descriptor.mime) {
      throw new Error(
        `Cycle renderer returned media type '${rendered.mime}' for '${descriptor.file}', expected '${descriptor.mime}'`,
      );
    }
    outputs.push({
      ...rendererOutputDeclaration(descriptor),
      content: rendered.content,
    });
  }
  outputs.push(...(options.additionalOutputs || []));
  return createCycleOutputReceipt({ inputBuildId: options.inputBuildId, outputs });
}
