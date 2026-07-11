/**
 * Immutable non-SiteBuild inputs owned by the Cycle renderer implementation.
 *
 * Design files and the browser runtime are part of the renderer recipe, not IG
 * source artifacts. Hosts open one authenticated package while preparing Cycle;
 * individual renders then copy only the requested body.
 */
import type { ContentRef, ContentStore } from './closed-build';
import { compareUtf8 } from './order';
import { assertCycleOutputPath } from './output-receipt';

export interface CycleRendererPackageFile {
  path: string;
  mediaType: string;
  producer: string;
  content: ContentRef;
}

export interface CycleRendererPackageManifest {
  schemaVersion: 'cycle-renderer-package/v1';
  packageId: string;
  files: CycleRendererPackageFile[];
}

export interface CycleRendererPackageOutput {
  file: string;
  mime: string;
  producer: string;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Cycle renderer package cannot contain a non-finite number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (!value || typeof value !== 'object') {
    throw new Error(`Cycle renderer package cannot contain ${typeof value}`);
  }
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .filter((key) => object[key] !== undefined)
    .sort(compareUtf8)
    .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
    .join(',')}}`;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto SHA-256 is required for Cycle renderer packages');
  const input = new Uint8Array(bytes);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', input.buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function computeCycleRendererPackageId(
  files: readonly CycleRendererPackageFile[],
): Promise<string> {
  const payload = { schemaVersion: 'cycle-renderer-package/v1', files };
  return `crp1-sha256:${await sha256(new TextEncoder().encode(stableJson(payload)))}`;
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function contentRef(value: unknown, label: string): ContentRef {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const object = value as Record<string, unknown>;
  const unexpected = Object.keys(object).find((key) => !['sha256', 'byteLength', 'mediaType'].includes(key));
  if (unexpected) throw new Error(`${label} has unexpected field ${unexpected}`);
  const digest = string(object.sha256, `${label}.sha256`);
  if (!/^[0-9a-f]{64}$/.test(digest)) throw new Error(`${label}.sha256 must be lowercase SHA-256`);
  if (!Number.isSafeInteger(object.byteLength) || (object.byteLength as number) < 0) {
    throw new Error(`${label}.byteLength must be a non-negative safe integer`);
  }
  const mediaType = object.mediaType === undefined ? undefined : string(object.mediaType, `${label}.mediaType`);
  return { sha256: digest, byteLength: object.byteLength as number, ...(mediaType ? { mediaType } : {}) };
}

/** @internal Opened only while Cycle prepares its generator runtime. */
export class CycleRendererPackage {
  private constructor(
    readonly packageId: string,
    private readonly fileValues: readonly Readonly<CycleRendererPackageFile>[],
    private readonly bytesByPath: ReadonlyMap<string, Uint8Array>,
  ) {}

  static async open(value: unknown, store: ContentStore): Promise<CycleRendererPackage> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Cycle renderer package manifest must be an object');
    }
    const object = value as Record<string, unknown>;
    const unexpected = Object.keys(object).find((key) => !['schemaVersion', 'packageId', 'files'].includes(key));
    if (unexpected) throw new Error(`Cycle renderer package has unexpected field ${unexpected}`);
    if (object.schemaVersion !== 'cycle-renderer-package/v1') {
      throw new Error(`Unsupported Cycle renderer package ${String(object.schemaVersion)}`);
    }
    const packageId = string(object.packageId, 'Cycle renderer package.packageId');
    if (!Array.isArray(object.files)) throw new Error('Cycle renderer package.files must be an array');
    const seen = new Set<string>();
    const files = object.files.map((candidate, index): CycleRendererPackageFile => {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
        throw new Error(`Cycle renderer package.files[${index}] must be an object`);
      }
      const file = candidate as Record<string, unknown>;
      const extra = Object.keys(file).find((key) => !['path', 'mediaType', 'producer', 'content'].includes(key));
      if (extra) throw new Error(`Cycle renderer package.files[${index}] has unexpected field ${extra}`);
      const path = string(file.path, `Cycle renderer package.files[${index}].path`);
      assertCycleOutputPath(path, `Cycle renderer package.files[${index}].path`);
      if (!seen.add(path)) throw new Error(`Cycle renderer package contains duplicate output '${path}'`);
      const mediaType = string(file.mediaType, `Cycle renderer package.files[${index}].mediaType`);
      const content = contentRef(file.content, `Cycle renderer package.files[${index}].content`);
      if (content.mediaType && content.mediaType !== mediaType) {
        throw new Error(`Cycle renderer package media type mismatch for '${path}'`);
      }
      return Object.freeze({
        path,
        mediaType,
        producer: string(file.producer, `Cycle renderer package.files[${index}].producer`),
        content: Object.freeze({ ...content, mediaType }),
      });
    });
    for (let index = 1; index < files.length; index += 1) {
      if (compareUtf8(files[index - 1].path, files[index].path) >= 0) {
        throw new Error('Cycle renderer package.files must be strictly UTF-8 path ordered');
      }
    }
    const expectedId = await computeCycleRendererPackageId(files);
    if (packageId !== expectedId) throw new Error(`Cycle renderer package id mismatch: expected ${expectedId}`);

    const loaded = await Promise.all(files.map(async (file): Promise<readonly [string, Uint8Array]> => {
      const bytes = await store.get(file.content);
      if (!bytes) throw new Error(`Cycle renderer package is missing '${file.path}' (${file.content.sha256})`);
      if (bytes.byteLength !== file.content.byteLength) {
        throw new Error(`Cycle renderer package length mismatch for '${file.path}'`);
      }
      if (await sha256(bytes) !== file.content.sha256) {
        throw new Error(`Cycle renderer package digest mismatch for '${file.path}'`);
      }
      return [file.path, new Uint8Array(bytes)] as const;
    }));
    const result = new CycleRendererPackage(packageId, Object.freeze(files), new Map(loaded));
    Object.freeze(result);
    return result;
  }

  outputs(): CycleRendererPackageOutput[] {
    return this.fileValues.map((file) => ({ file: file.path, mime: file.mediaType, producer: file.producer }));
  }

  render(path: string): Uint8Array | null {
    const bytes = this.bytesByPath.get(path);
    return bytes ? bytes.slice() : null;
  }
}
