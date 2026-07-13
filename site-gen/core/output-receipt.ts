/** Browser-neutral canonical SiteOutput contract used by Cycle and Rust. */
import { compareUtf8 } from './order';
import { canonicalJson, prefixedCanonicalHash, sha256 } from './canonical-json';
import type { ContentStore } from './closed-build';
import {
  SITE_OUTPUT_MANIFEST_PATH,
  SITE_OUTPUT_SCHEMA,
} from './site-contract.generated';
import type {
  OutputProducer,
  RendererImplementation,
  SiteOutput,
  SiteOutputFile,
} from './site-contract.generated';

export { SITE_OUTPUT_MANIFEST_PATH, SITE_OUTPUT_SCHEMA } from './site-contract.generated';
export type {
  ContentRef,
  OutputProducer,
  RendererImplementation,
  SiteOutput,
  SiteOutputFile,
} from './site-contract.generated';
export const CYCLE_OUTPUT_SCHEMA = 'cycle-static-site/v1' as const;
export const CYCLE_RENDERER_IDENTITY = Object.freeze({ id: 'cycle-site', version: '1' } as const);

export interface CycleOutputDeclaration {
  path: string;
  mediaType: string;
  producer: OutputProducer;
  source?: string;
  owner?: string;
}

export interface SiteOutputMaterial extends CycleOutputDeclaration {
  content: string | Uint8Array;
}

type OutputIdPayload = Omit<SiteOutput, 'outputId'>;

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

function assertProducer(value: unknown, label: string): asserts value is OutputProducer {
  assertObject(value, label);
  assertOnlyKeys(value, ['id', 'version'], label);
  nonEmptyString(value.id, `${label}.id`);
  nonEmptyString(value.version, `${label}.version`);
}

function assertRenderer(value: unknown, label: string): asserts value is RendererImplementation {
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

function copyProducer(value: OutputProducer): OutputProducer {
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

function assertInputBuildId(value: unknown): asserts value is string {
  if (typeof value !== 'string'
    || !/^sb1-sha256:[0-9a-f]{64}$/.test(value)) {
    throw new Error('SiteOutput inputBuildId must be a SiteBuild SHA-256 id');
  }
}

async function outputFiles(outputs: readonly SiteOutputMaterial[]): Promise<SiteOutputFile[]> {
  const seen = new Set<string>();
  const files = await Promise.all(outputs.map(async (output, index): Promise<SiteOutputFile> => {
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

function assertSiteOutputFile(value: unknown, label: string): asserts value is SiteOutputFile {
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

export async function validateSiteOutput(value: unknown): Promise<SiteOutput> {
  assertObject(value, 'SiteOutput');
  assertOnlyKeys(
    value,
    ['schemaVersion', 'inputBuildId', 'renderer', 'outputSchema', 'options', 'files', 'outputId'],
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
    assertSiteOutputFile(file, `SiteOutput files[${index}]`);
    if (previous !== null && compareUtf8(previous, file.path) >= 0) {
      throw new Error(previous === file.path ? `SiteOutput repeats path '${file.path}'` : 'SiteOutput files are not in canonical UTF-8 path order');
    }
    previous = file.path;
    paths.add(file.path);
  }
  for (const file of value.files as SiteOutputFile[]) {
    if (file.owner !== undefined && !paths.has(file.owner)) throw new Error(`SiteOutput '${file.path}' names missing owner '${file.owner}'`);
  }
  if (typeof value.outputId !== 'string' || !/^so1-sha256:[0-9a-f]{64}$/.test(value.outputId)) throw new Error('Invalid SiteOutput outputId');
  const output = value as unknown as SiteOutput;
  const outputPayload: OutputIdPayload = {
    schemaVersion: SITE_OUTPUT_SCHEMA,
    inputBuildId: output.inputBuildId,
    renderer: output.renderer,
    outputSchema: output.outputSchema,
    options,
    files: output.files,
  };
  const expectedOutputId = await prefixedCanonicalHash('so1-sha256:', outputPayload);
  if (output.outputId !== expectedOutputId) throw new Error(`SiteOutput id mismatch: ${output.outputId} != ${expectedOutputId}`);
  return output;
}

export async function verifySiteOutput(
  outputValue: unknown,
  outputs: readonly SiteOutputMaterial[],
): Promise<void> {
  const output = await validateSiteOutput(outputValue);
  const files = await outputFiles(outputs);
  if (canonicalJson(files) !== canonicalJson(output.files)) {
    throw new Error('SiteOutput files do not match the authenticated output bytes and declarations');
  }
}

/** Verify every addressed output through a browser or native ContentStore. */
export async function verifySiteOutputStore(
  receiptValue: unknown,
  store: ContentStore,
): Promise<SiteOutput> {
  const output = await validateSiteOutput(receiptValue);
  for (const file of output.files) {
    const bytes = await store.get(file.content);
    if (!bytes) throw new Error(`ContentStore is missing SiteOutput '${file.path}' (${file.content.sha256})`);
    if (bytes.byteLength !== file.content.byteLength) {
      throw new Error(`ContentStore length mismatch for SiteOutput '${file.path}'`);
    }
    if (await sha256(bytes) !== file.content.sha256) {
      throw new Error(`ContentStore digest mismatch for SiteOutput '${file.path}'`);
    }
  }
  return output;
}

export function serializeSiteOutput(output: SiteOutput): string {
  // Match Rust `SiteOutput::canonical_bytes()` exactly. The receipt is one
  // shared wire value; native cache publication must not need a newline-
  // tolerant parallel serialization.
  return canonicalJson(output);
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
