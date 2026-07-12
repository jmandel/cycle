import { expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertNativeRecipeUnchanged, finalizeNativeOutput } from './native-output-cache';

const BUILD_A = 'sb1-sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const BUILD_B = 'sb1-sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

test('native renderer recipe guard rejects execution drift at publication boundaries', () => {
  expect(() => assertNativeRecipeUnchanged('a'.repeat(64), 'a'.repeat(64), 'before finalize'))
    .not.toThrow();
  expect(() => assertNativeRecipeUnchanged('a'.repeat(64), 'b'.repeat(64), 'after finalize'))
    .toThrow('Native Cycle renderer recipe changed after finalize');
});

test('native finalize binds the plan and returned result to the rendered build', () => {
  const root = mkdtempSync(join(tmpdir(), 'cycle-native-finalize-'));
  const fig = join(root, 'fig');
  const capture = join(root, 'plan.json');
  const priorFig = process.env.FIG_BIN;
  const writeFakeFig = (buildId: string): void => {
    writeFileSync(fig, `#!/bin/sh
cat > "${capture}"
printf '%s\\n' '{"apiVersion":1,"ok":true,"op":"finalize","result":{"buildId":"${buildId}","cacheKey":"sok1-sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","outputId":"so1-sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","out":"site","files":1,"bytes":4}}'
`);
    chmodSync(fig, 0o755);
  };
  try {
    writeFakeFig(BUILD_A);
    process.env.FIG_BIN = fig;

    const options = {
      buildDirectory: 'closed-build',
      inputBuildId: BUILD_A,
      siteDirectory: 'private-site',
      derivation: {
        renderer: {
          id: 'cycle-site',
          version: '1',
          recipeSha256: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        },
        outputSchema: 'cycle-static-site/v1',
        options: { minify: 'true' },
      },
      declarations: [{
        path: 'index.html',
        mediaType: 'text/html',
        producer: { id: 'cycle-site', version: '1' },
      }],
    } as const;

    const outcome = finalizeNativeOutput(options);
    expect(outcome.buildId).toBe(BUILD_A);
    expect(JSON.parse(readFileSync(capture, 'utf8')).inputBuildId).toBe(BUILD_A);

    writeFakeFig(BUILD_B);
    expect(() => finalizeNativeOutput(options)).toThrow(
      `fig finalize restored ${BUILD_B}, but Cycle rendered ${BUILD_A}`,
    );
  } finally {
    if (priorFig === undefined) delete process.env.FIG_BIN;
    else process.env.FIG_BIN = priorFig;
    rmSync(root, { recursive: true, force: true });
  }
});
