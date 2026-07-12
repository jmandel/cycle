import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  CYCLE_OUTPUT_RECEIPT_PATH,
  serializeCycleOutputReceipt,
  type CycleOutputReceipt,
} from '../site-gen/core/output-receipt';
import {
  assertInheritedFilesUnchanged,
  copyVerifiedOutput,
  declarationFromReceiptFile,
  listRegularOutputFiles,
  mediaTypeForOutput,
  receiptFileMatches,
} from './final-publication';

const receipt: CycleOutputReceipt = {
  schemaVersion: 'site-output/v1',
  inputBuildId: 'sb1-sha256:5eb1101c55a13f90a6af2ef851eb32705b663caf669dc8b596baad690f15495d',
  renderer: {
    id: 'cycle-site', version: '1.0.0',
    recipeSha256: 'e1d8e552330911f9f779f85b6f2c00a15e790dcc3fbb3b28f5da1d660a30c5b8',
  },
  outputSchema: 'static-site/v1',
  options: { locale: 'en' },
  cacheKey: 'sok1-sha256:52a6568c5df7d5db15d43a1c5c1ce4eb0a64cffad5f4c2dc53ba09335180af2b',
  files: [{
    path: 'index.html',
    content: {
      sha256: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
      byteLength: 5,
      mediaType: 'text/html',
    },
    producer: { id: 'cycle-page', version: '1' },
    source: 'page recipe',
  }],
  outputId: 'so1-sha256:5c395c8bde04a11939c040de1bb920dc720db9e859453dea647560b46b18f0c1',
};

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'cycle-final-publication-'));
  const inner = join(root, 'inner');
  const outer = join(root, 'outer');
  await mkdir(inner);
  await mkdir(outer);
  await writeFile(join(inner, 'index.html'), 'hello');
  await writeFile(join(inner, CYCLE_OUTPUT_RECEIPT_PATH), serializeCycleOutputReceipt(receipt));
  return { root, inner, outer };
}

test('verified Rust receipt copies only declared bytes into outer staging', async () => {
  const value = await fixture();
  try {
    const copied = await copyVerifiedOutput(value.inner, value.outer);
    expect(copied.receipt).toEqual(receipt);
    expect(copied.declarations).toEqual(receipt.files.map(declarationFromReceiptFile));
    expect(await listRegularOutputFiles(value.outer)).toEqual(['index.html']);
    await expect(Bun.file(join(value.outer, CYCLE_OUTPUT_RECEIPT_PATH)).exists()).resolves.toBe(false);
    await assertInheritedFilesUnchanged(value.outer, receipt);
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test('copy rejects a corrupt inherited tree before exposing its files', async () => {
  const value = await fixture();
  try {
    await writeFile(join(value.inner, 'index.html'), 'corrupt');
    await expect(copyVerifiedOutput(value.inner, value.outer)).rejects.toThrow('do not match');
    expect(await listRegularOutputFiles(value.outer)).toEqual([]);
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test('inherited-byte audit permits only explicitly transformed paths', async () => {
  const value = await fixture();
  try {
    await copyVerifiedOutput(value.inner, value.outer);
    expect(await receiptFileMatches(value.outer, receipt.files[0])).toBe(true);
    await writeFile(join(value.outer, 'index.html'), 'wrapper transform');
    expect(await receiptFileMatches(value.outer, receipt.files[0])).toBe(false);
    await expect(assertInheritedFilesUnchanged(value.outer, receipt))
      .rejects.toThrow("changed inherited Cycle output 'index.html'");
    await assertInheritedFilesUnchanged(value.outer, receipt, new Set(['index.html']));
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test('wrapper media types cover every project extra class', () => {
  expect(mediaTypeForOutput('view.html')).toBe('text/html');
  expect(mediaTypeForOutput('view-assets/app.js')).toBe('text/javascript');
  expect(mediaTypeForOutput('package-list.json')).toBe('application/json');
  expect(mediaTypeForOutput('skill.zip')).toBe('application/zip');
  expect(mediaTypeForOutput('fragment-usage-analysis.csv')).toBe('text/csv');
  expect(mediaTypeForOutput('example.jwe')).toBe('application/octet-stream');
});
