/** Private native IPC/storage behind the immutable Cycle Build facade. */
import { lstat, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { FilesystemContentStore } from './filesystem-closed-build';
import { prefixedCanonicalHash } from './canonical-json';
import { compareUtf8 } from './order';
import {
  serializeSiteOutput,
  validateSiteOutput,
} from './output-receipt';
import type { RendererImplementation, SiteOutput, SiteOutputFile } from './output-receipt';
import { API_VERSION } from './site-contract.generated';
import type { ApiEnvelope, ApiMessageError } from './site-contract.generated';

interface NativeOutputDerivation {
  renderer: RendererImplementation;
  outputSchema: string;
  options: Readonly<Record<string, string>>;
}

interface NativeOutputCacheHit {
  receipt: SiteOutput;
  contentStoreDirectory: string;
  timings: Record<string, number>;
}

/** Fail closed if renderer code/assets changed after the derivation was bound. */
export function assertNativeRecipeUnchanged(
  expected: string,
  current: string,
  boundary: string,
): void {
  if (current !== expected) {
    throw new Error(
      `Native Cycle renderer recipe changed ${boundary}: ${expected} != ${current}`,
    );
  }
}

function figBinary(): string {
  return process.env.FIG_BIN?.trim() || 'fig';
}

export function nativeBuildStorageRoot(): string {
  return resolve(process.env.FIG_OUTPUT_CACHE?.trim() || 'temp/fig-output-cache');
}

/** Private native-cache address. Functional SiteOutput has no public cache key. */
async function computeSiteOutputCacheKey(options: {
  inputBuildId: string;
  renderer: RendererImplementation;
  outputSchema: string;
  outputOptions: Readonly<Record<string, string>>;
}): Promise<string> {
  const orderedOptions = Object.fromEntries(
    Object.entries(options.outputOptions).sort(([left], [right]) => compareUtf8(left, right)),
  );
  return prefixedCanonicalHash('sok1-sha256:', {
    schemaVersion: 'site-output/v1',
    inputBuildId: options.inputBuildId,
    renderer: options.renderer,
    outputSchema: options.outputSchema,
    options: orderedOptions,
  });
}

function invokeFig(args: string[], stdin?: string): Record<string, unknown> {
  const command = [figBinary(), ...args, '--json'];
  const result = Bun.spawnSync(command, {
    stdout: 'pipe',
    stderr: 'pipe',
    ...(stdin === undefined ? {} : { stdin: Buffer.from(stdin) }),
  });
  const stdout = result.stdout.toString();
  const stderr = result.stderr.toString();
  const line = stdout.trim().split('\n').at(-1) || '';
  let envelope: ApiEnvelope<Record<string, unknown>, ApiMessageError>;
  try {
    envelope = JSON.parse(line) as ApiEnvelope<Record<string, unknown>, ApiMessageError>;
  } catch (error) {
    throw new Error(
      `fig site operation did not return JSON (${command.join(' ')}): `
      + `${error instanceof Error ? error.message : String(error)}\n${stdout}${stderr}`,
    );
  }
  if (envelope.apiVersion !== API_VERSION) {
    throw new Error(`fig site operation returned apiVersion ${envelope.apiVersion}`);
  }
  if (envelope.op !== args[0]) {
    throw new Error(`fig site operation returned op ${envelope.op}; expected ${args[0]}`);
  }
  if (!envelope.ok) {
    throw new Error(`fig site operation failed: ${envelope.error.message || stdout || stderr}`);
  }
  return envelope.result;
}

/** Verify a private cache hit. Publication materializes only after this returns
 * a complete canonical receipt and authenticated ContentStore. */
export async function restoreNativeOutput(options: {
  inputBuildId: string;
  cacheDirectory: string;
  derivation: NativeOutputDerivation;
}): Promise<NativeOutputCacheHit | null> {
  const started = performance.now();
  const cacheKey = await computeSiteOutputCacheKey({
    inputBuildId: options.inputBuildId,
    renderer: options.derivation.renderer,
    outputSchema: options.derivation.outputSchema,
    outputOptions: options.derivation.options,
  });
  const digest = cacheKey.slice('sok1-sha256:'.length);
  const manifest = join(options.cacheDirectory, 'manifests', `${digest}.json`);
  const metadata = await lstat(manifest).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  });
  if (!metadata) return null;
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`SiteOutput cache manifest is not a regular file: ${manifest}`);
  }
  const serialized = await readFile(manifest, 'utf8');
  const receipt = await validateSiteOutput(JSON.parse(serialized) as unknown);
  if (serializeSiteOutput(receipt) !== serialized) {
    throw new Error(`SiteOutput cache manifest is not canonical: ${manifest}`);
  }
  if (receipt.inputBuildId !== options.inputBuildId) {
    throw new Error(`SiteOutput cache manifest does not match ${cacheKey}`);
  }
  const receiptCacheKey = await computeSiteOutputCacheKey({
    inputBuildId: receipt.inputBuildId,
    renderer: receipt.renderer,
    outputSchema: receipt.outputSchema,
    outputOptions: receipt.options,
  });
  if (receiptCacheKey !== cacheKey) {
    throw new Error(`SiteOutput cache manifest is stored under the wrong derivation key: ${receiptCacheKey} != ${cacheKey}`);
  }
  const objects = await FilesystemContentStore.openObjectRoot(
    join(options.cacheDirectory, 'objects', 'sha256'),
  );
  for (const file of receipt.files) {
    const bytes = await objects.get(file.content);
    if (!bytes) throw new Error(`SiteOutput cache is missing ${file.path}`);
  }
  return {
    receipt,
    contentStoreDirectory: join(options.cacheDirectory, 'objects', 'sha256'),
    timings: { totalMs: performance.now() - started },
  };
}

/** Ask Rust's hidden native transport to authenticate the renderer's completed
 * ContentRefs, create the sole canonical SiteOutput, and publish its cache entry. */
export async function completeNativeRenderer(options: {
  buildDirectory: string;
  /** Exact build identity already authenticated and rendered by this caller. */
  inputBuildId: string;
  cacheDirectory?: string;
  contentStoreDirectory: string;
  receiptFile: string;
  derivation: NativeOutputDerivation;
  files: readonly SiteOutputFile[];
}): Promise<SiteOutput> {
  const args = [
    '__complete-renderer', options.buildDirectory,
    '--input-build-id', options.inputBuildId,
    '--renderer-json', JSON.stringify(options.derivation.renderer),
    '--output-schema', options.derivation.outputSchema,
    '--options-json', JSON.stringify(options.derivation.options),
    '--receipt', options.receiptFile,
    '--content-store', options.contentStoreDirectory,
  ];
  if (options.cacheDirectory) args.push('--cache', options.cacheDirectory);
  const result = invokeFig(args, JSON.stringify(options.files));
  const output = await validateSiteOutput(result);
  if (output.inputBuildId !== options.inputBuildId) {
    throw new Error('fig renderer completion returned a different input build');
  }
  return output;
}
