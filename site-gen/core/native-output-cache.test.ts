import { expect, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertNativeRecipeUnchanged,
  completeNativeRenderer,
  restoreNativeOutput,
} from './native-output-cache';
import { RUST_SITE_OUTPUT_BYTES, RUST_SITE_OUTPUT_RECEIPT } from './output-receipt.fixture';
import { serializeSiteOutput } from './output-receipt';

const BUILD_A = RUST_SITE_OUTPUT_RECEIPT.inputBuildId;
const BUILD_B = 'sb1-sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

test('native renderer recipe guard rejects execution drift at publication boundaries', () => {
  expect(() => assertNativeRecipeUnchanged('a'.repeat(64), 'a'.repeat(64), 'before finalize'))
    .not.toThrow();
  expect(() => assertNativeRecipeUnchanged('a'.repeat(64), 'b'.repeat(64), 'after finalize'))
    .toThrow('Native Cycle renderer recipe changed after finalize');
});

test('hidden native renderer completion sends ContentRefs and binds the result to the rendered build', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cycle-native-completion-'));
  const fig = join(root, 'fig');
  const capture = join(root, 'renderer-output.json');
  const priorFig = process.env.FIG_BIN;
  const writeFakeFig = (buildId: string, op = '__complete-renderer'): void => {
    const output = buildId === BUILD_A
      ? RUST_SITE_OUTPUT_RECEIPT
      : { ...RUST_SITE_OUTPUT_RECEIPT, inputBuildId: buildId };
    const envelope = JSON.stringify({ apiVersion: 1, ok: true, op, result: output });
    writeFileSync(fig, `#!/bin/sh
cat > "${capture}"
printf '%s\\n' '${envelope}'
`);
    chmodSync(fig, 0o755);
  };
  try {
    writeFakeFig(BUILD_A);
    process.env.FIG_BIN = fig;

    const options = {
      buildDirectory: 'closed-build',
      inputBuildId: BUILD_A,
      contentStoreDirectory: 'objects',
      receiptFile: 'private-site/site-output.json',
      derivation: {
        renderer: RUST_SITE_OUTPUT_RECEIPT.renderer,
        outputSchema: RUST_SITE_OUTPUT_RECEIPT.outputSchema,
        options: RUST_SITE_OUTPUT_RECEIPT.options,
      },
      files: RUST_SITE_OUTPUT_RECEIPT.files,
    } as const;

    const outcome = await completeNativeRenderer(options);
    expect(outcome.outputId).toBe(RUST_SITE_OUTPUT_RECEIPT.outputId);
    const input = JSON.parse(readFileSync(capture, 'utf8'));
    expect(input).toHaveLength(1);
    expect(input[0].content.sha256).toBe(RUST_SITE_OUTPUT_RECEIPT.files[0].content.sha256);

    writeFakeFig(BUILD_A, 'finalize');
    await expect(completeNativeRenderer(options)).rejects.toThrow('returned op finalize; expected __complete-renderer');

    writeFakeFig(BUILD_B);
    await expect(completeNativeRenderer(options)).rejects.toThrow('id mismatch');
  } finally {
    if (priorFig === undefined) delete process.env.FIG_BIN;
    else process.env.FIG_BIN = priorFig;
    rmSync(root, { recursive: true, force: true });
  }
});

test('native cache restore independently verifies and materializes canonical refs', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cycle-native-cache-'));
  const cache = join(root, 'cache');
  try {
    mkdirSync(join(cache, 'manifests'), { recursive: true });
    mkdirSync(join(cache, 'objects', 'sha256'), { recursive: true });
    const cacheKey = 'sok1-sha256:52a6568c5df7d5db15d43a1c5c1ce4eb0a64cffad5f4c2dc53ba09335180af2b';
    writeFileSync(
      join(cache, 'manifests', `${cacheKey.slice('sok1-sha256:'.length)}.json`),
      serializeSiteOutput(RUST_SITE_OUTPUT_RECEIPT),
    );
    writeFileSync(
      join(cache, 'objects', 'sha256', RUST_SITE_OUTPUT_RECEIPT.files[0].content.sha256),
      RUST_SITE_OUTPUT_BYTES,
    );
    const restored = await restoreNativeOutput({
      inputBuildId: RUST_SITE_OUTPUT_RECEIPT.inputBuildId,
      cacheDirectory: cache,
      derivation: {
        renderer: RUST_SITE_OUTPUT_RECEIPT.renderer,
        outputSchema: RUST_SITE_OUTPUT_RECEIPT.outputSchema,
        options: RUST_SITE_OUTPUT_RECEIPT.options,
      },
    });
    expect(restored?.receipt).toEqual(RUST_SITE_OUTPUT_RECEIPT);
    expect(restored?.contentStoreDirectory).toBe(join(cache, 'objects', 'sha256'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('native cache rejects a canonical receipt stored under another derivation key', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cycle-native-cache-key-'));
  const cache = join(root, 'cache');
  try {
    mkdirSync(join(cache, 'manifests'), { recursive: true });
    const requested = {
      renderer: RUST_SITE_OUTPUT_RECEIPT.renderer,
      outputSchema: 'different-output-schema/v1',
      options: RUST_SITE_OUTPUT_RECEIPT.options,
    };
    const wrongLocation = 'sok1-sha256:54c14c9e430470fa381c734a0633c1134031f31cf6242013a2d82dd13f0d1012';
    writeFileSync(
      join(cache, 'manifests', `${wrongLocation.slice('sok1-sha256:'.length)}.json`),
      serializeSiteOutput(RUST_SITE_OUTPUT_RECEIPT),
    );
    await expect(restoreNativeOutput({
      inputBuildId: RUST_SITE_OUTPUT_RECEIPT.inputBuildId,
      cacheDirectory: cache,
      derivation: requested,
    })).rejects.toThrow('wrong derivation key');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
