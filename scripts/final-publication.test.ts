import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sealCycleOutputTree, verifyCycleOutputTree } from '../site-gen/core/output-receipt-node';
import { AtomicOutputPublication } from '../site-gen/core/atomic-output';
import {
  CYCLE_OUTPUT_RECEIPT_PATH,
  type CycleOutputDeclaration,
} from '../site-gen/core/output-receipt';
import {
  assertInheritedFilesUnchanged,
  copyVerifiedOutput,
  declarationFromReceiptFile,
  listRegularOutputFiles,
  mediaTypeForOutput,
  receiptFileMatches,
} from './final-publication';

const inputBuildId = `sb1-sha256:${'3'.repeat(64)}`;
const declarations: CycleOutputDeclaration[] = [
  {
    path: 'index.html',
    mediaType: 'text/html',
    producer: { id: 'cycle-site', version: '1' },
    source: 'fixture page',
  },
  {
    path: 'assets/app.js',
    mediaType: 'text/javascript',
    producer: { id: 'cycle-client-bundle', version: '1' },
  },
];

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'cycle-final-publication-'));
  const inner = join(root, 'inner');
  const outer = join(root, 'outer');
  await mkdir(join(inner, 'assets'), { recursive: true });
  await mkdir(outer);
  await writeFile(join(inner, 'index.html'), '<h1>Fixture</h1>');
  await writeFile(join(inner, 'assets/app.js'), new Uint8Array([0, 1, 2, 255]));
  const receipt = await sealCycleOutputTree({
    root: inner,
    inputBuildId,
    renderer: { id: 'cycle-site', version: '1', recipeSha256: '4'.repeat(64) },
    declarations,
  });
  return { root, inner, outer, receipt };
}

test('verified inner publication copies only declared bytes into outer staging', async () => {
  const value = await fixture();
  try {
    const copied = await copyVerifiedOutput(value.inner, value.outer);
    expect(copied.receipt).toEqual(value.receipt);
    expect(copied.declarations).toEqual(value.receipt.files.map(declarationFromReceiptFile));
    expect(await listRegularOutputFiles(value.outer)).toEqual(['assets/app.js', 'index.html']);
    expect(await readFile(join(value.outer, 'assets/app.js'))).toEqual(new Uint8Array([0, 1, 2, 255]));
    await expect(Bun.file(join(value.outer, CYCLE_OUTPUT_RECEIPT_PATH)).exists()).resolves.toBe(false);
    await assertInheritedFilesUnchanged(value.outer, value.receipt);
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test('copy rejects a corrupt inherited tree before exposing its files to outer staging', async () => {
  const value = await fixture();
  try {
    await writeFile(join(value.inner, 'index.html'), 'corrupt');
    await expect(copyVerifiedOutput(value.inner, value.outer)).rejects.toThrow('SiteOutput mismatch');
    expect(await listRegularOutputFiles(value.outer)).toEqual([]);
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test('inherited-byte audit permits only explicitly transformed paths', async () => {
  const value = await fixture();
  try {
    await copyVerifiedOutput(value.inner, value.outer);
    const index = value.receipt.files.find((file) => file.path === 'index.html')!;
    expect(await receiptFileMatches(value.outer, index)).toBe(true);
    await writeFile(join(value.outer, 'index.html'), 'wrapper transform');
    expect(await receiptFileMatches(value.outer, index)).toBe(false);
    await expect(assertInheritedFilesUnchanged(value.outer, value.receipt))
      .rejects.toThrow("changed inherited Cycle output 'index.html'");
    await assertInheritedFilesUnchanged(value.outer, value.receipt, new Set(['index.html']));
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

test('one outer seal covers inherited renderer files and project extras', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cycle-outer-publication-'));
  const cwd = join(root, 'work');
  await mkdir(join(cwd, 'site-gen'), { recursive: true });
  const publication = await AtomicOutputPublication.create({ destination: 'site-gen/out', cwd });
  try {
    const inner = join(publication.stagingDirectory, '.inner');
    await mkdir(inner);
    await writeFile(join(inner, 'index.html'), '<h1>Fixture</h1>');
    await sealCycleOutputTree({
      root: inner,
      inputBuildId,
      renderer: { id: 'cycle-site', version: '1', recipeSha256: '4'.repeat(64) },
      declarations: [declarations[0]],
    });
    const inherited = await copyVerifiedOutput(inner, publication.stagingDirectory);
    await rm(inner, { recursive: true, force: true });

    const extra: CycleOutputDeclaration = {
      path: 'CNAME',
      mediaType: 'text/plain',
      producer: { id: 'cycle-project-publication', version: '1' },
      source: 'fixture deployment metadata',
    };
    await writeFile(publication.outputPath(extra.path), 'example.test\n', { flag: 'wx' });
    const receipt = await publication.sealOutputReceipt({
      inputBuildId: inherited.receipt.inputBuildId,
      renderer: inherited.receipt.renderer,
      declarations: [...inherited.declarations, extra],
    });
    expect(receipt.files.map((file) => file.path)).toEqual(['CNAME', 'index.html']);
    await publication.publish();

    await verifyCycleOutputTree({
      root: join(cwd, 'site-gen/out'),
      declarations: receipt.files.map(declarationFromReceiptFile),
      expected: receipt,
    });
  } finally {
    await publication.abort();
    await rm(root, { recursive: true, force: true });
  }
});
