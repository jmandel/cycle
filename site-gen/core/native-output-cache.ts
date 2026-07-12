/** Thin native host adapter for Fig's canonical SiteOutput cache seam. */
import { resolve } from 'node:path';
import type { CycleRendererImplementation } from './output-receipt';

interface FigEnvelope {
  apiVersion: number;
  ok: boolean;
  op: string;
  result?: Record<string, unknown>;
  error?: { message?: string };
}

export interface NativeOutputDerivation {
  renderer: CycleRendererImplementation;
  outputSchema: string;
  options: Readonly<Record<string, string>>;
}

export interface NativeOutputCacheHit {
  cacheKey: string;
  outputId: string;
  files: number;
  timings: Record<string, number>;
}

function figBinary(): string {
  return process.env.FIG_BIN?.trim() || 'fig';
}

export function nativeOutputCacheRoot(): string {
  return resolve(process.env.FIG_OUTPUT_CACHE?.trim() || 'temp/fig-output-cache');
}

function invokeFig(args: string[]): Record<string, unknown> {
  const command = [figBinary(), ...args, '--json'];
  const result = Bun.spawnSync(command, { stdout: 'pipe', stderr: 'pipe' });
  const stdout = result.stdout.toString();
  const stderr = result.stderr.toString();
  const line = stdout.trim().split('\n').at(-1) || '';
  let envelope: FigEnvelope;
  try {
    envelope = JSON.parse(line) as FigEnvelope;
  } catch (error) {
    throw new Error(
      `fig output-cache did not return JSON (${command.join(' ')}): `
      + `${error instanceof Error ? error.message : String(error)}\n${stdout}${stderr}`,
    );
  }
  if (!envelope.ok || !envelope.result) {
    throw new Error(`fig output-cache failed: ${envelope.error?.message || stdout || stderr}`);
  }
  return envelope.result;
}

/** Verify and materialize a hit into Cycle's caller-owned empty staging tree. */
export function restoreNativeOutput(options: {
  buildDirectory: string;
  cacheDirectory: string;
  stagingDirectory: string;
  derivation: NativeOutputDerivation;
}): NativeOutputCacheHit | null {
  const args = [
    'output-cache', 'load', options.buildDirectory,
    '--cache', options.cacheDirectory,
    '--renderer-id', options.derivation.renderer.id,
    '--renderer-version', options.derivation.renderer.version,
    '--recipe-sha256', options.derivation.renderer.recipeSha256,
    '--output-schema', options.derivation.outputSchema,
    '--into', options.stagingDirectory,
  ];
  for (const [key, value] of Object.entries(options.derivation.options).sort(([left], [right]) => left.localeCompare(right))) {
    args.push('--option', `${key}=${value}`);
  }
  const result = invokeFig(args);
  if (result.cacheHit !== true) return null;
  if (typeof result.cacheKey !== 'string' || typeof result.outputId !== 'string' || typeof result.files !== 'number') {
    throw new Error('fig output-cache hit returned an invalid result');
  }
  return {
    cacheKey: result.cacheKey,
    outputId: result.outputId,
    files: result.files,
    timings: (result.timings || {}) as Record<string, number>,
  };
}

/** Import a renderer-sealed staging tree into Fig's verified native cache. */
export function publishNativeOutput(options: {
  buildDirectory: string;
  cacheDirectory: string;
  siteDirectory: string;
}): Record<string, unknown> {
  return invokeFig([
    'output-cache', 'publish', options.buildDirectory,
    '--cache', options.cacheDirectory,
    '--site', options.siteDirectory,
  ]);
}
