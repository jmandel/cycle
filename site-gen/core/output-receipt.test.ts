import { expect, test } from 'bun:test';
import {
  CYCLE_OUTPUT_RECEIPT_PATH,
  createCycleRendererOutputReceipt,
  createCycleOutputReceipt,
  equalCycleOutputReceipts,
  validateCycleOutputReceipt,
  verifyCycleOutputReceipt,
  type CycleOutputMaterial,
} from './output-receipt';

const inputBuildId = `sb1-sha256:${'1'.repeat(64)}`;
const base: CycleOutputMaterial[] = [
  {
    path: 'index.html',
    mediaType: 'text/html',
    producer: { id: 'cycle-site', version: '1' },
    source: 'narrative page',
    content: '<h1>Hello</h1>',
  },
  {
    path: 'assets/app.js',
    mediaType: 'text/javascript',
    producer: { id: 'cycle-client-bundle', version: '1' },
    source: 'site-gen/client/entry.tsx',
    content: new Uint8Array([1, 2, 3]),
  },
];

function changed(index: number, value: Partial<CycleOutputMaterial>): CycleOutputMaterial[] {
  return base.map((output, candidate) => candidate === index ? { ...output, ...value } : { ...output });
}

test('receipt identity is independent of input order and uses canonical UTF-8 path order', async () => {
  const forward = await createCycleOutputReceipt({ inputBuildId, outputs: base });
  const reverse = await createCycleOutputReceipt({ inputBuildId, outputs: [...base].reverse() });
  expect(reverse).toEqual(forward);
  expect(await equalCycleOutputReceipts(forward, reverse)).toBe(true);
  expect(forward.files.map((file) => file.path)).toEqual(['assets/app.js', 'index.html']);
  expect(forward.outputBuildId).toMatch(/^cob1-sha256:[0-9a-f]{64}$/);
  expect(forward.files.some((file) => file.path === CYCLE_OUTPUT_RECEIPT_PATH)).toBe(false);
});

test('bytes, path, media type, producer/source/owner, renderer, and input identities affect the receipt', async () => {
  const original = await createCycleOutputReceipt({ inputBuildId, outputs: base });
  const variants = [
    await createCycleOutputReceipt({ inputBuildId, outputs: changed(0, { content: '<h1>Changed</h1>' }) }),
    await createCycleOutputReceipt({ inputBuildId, outputs: changed(0, { path: 'home.html' }) }),
    await createCycleOutputReceipt({ inputBuildId, outputs: changed(0, { mediaType: 'application/xhtml+xml' }) }),
    await createCycleOutputReceipt({
      inputBuildId,
      outputs: changed(0, { producer: { id: 'cycle-site-fork', version: '1' } }),
    }),
    await createCycleOutputReceipt({ inputBuildId, outputs: changed(0, { source: 'different recipe' }) }),
    await createCycleOutputReceipt({ inputBuildId, outputs: changed(1, { owner: 'index.html' }) }),
    await createCycleOutputReceipt({
      inputBuildId,
      renderer: { id: 'cycle-site', version: '2' },
      outputs: base,
    }),
    await createCycleOutputReceipt({ inputBuildId: `sb1-sha256:${'2'.repeat(64)}`, outputs: base }),
  ];
  for (const variant of variants) expect(variant.outputBuildId).not.toBe(original.outputBuildId);
});

test('canonical path order follows UTF-8 bytes rather than JavaScript UTF-16 order', async () => {
  const nonBmp = '\u{10000}.txt';
  const privateUseBmp = '\uE000.txt';
  // UTF-16 orders the surrogate pair first; Rust/UTF-8 orders U+E000 first.
  expect([nonBmp, privateUseBmp].sort()).toEqual([nonBmp, privateUseBmp]);
  const receipt = await createCycleOutputReceipt({
    inputBuildId,
    outputs: [nonBmp, privateUseBmp].map((path) => ({
      path,
      mediaType: 'text/plain',
      producer: { id: 'fixture' },
      content: path,
    })),
  });
  expect(receipt.files.map((file) => file.path)).toEqual([privateUseBmp, nonBmp]);
});

test('receipt paths are unique, safe, and cannot claim the receipt itself', async () => {
  await expect(createCycleOutputReceipt({ inputBuildId, outputs: [...base, { ...base[0] }] }))
    .rejects.toThrow("Duplicate Cycle output path 'index.html'");
  await expect(createCycleOutputReceipt({ inputBuildId, outputs: changed(0, { path: '../index.html' }) }))
    .rejects.toThrow('is unsafe');
  await expect(createCycleOutputReceipt({
    inputBuildId,
    outputs: changed(0, { path: CYCLE_OUTPUT_RECEIPT_PATH }),
  })).rejects.toThrow('reserved receipt path');
});

test('receipt validation detects wire mutation and verification detects material mutation', async () => {
  const receipt = await createCycleOutputReceipt({ inputBuildId, outputs: base });
  const mutated = structuredClone(receipt);
  mutated.files[0].mediaType = 'text/plain';
  await expect(validateCycleOutputReceipt(mutated)).rejects.toThrow('id mismatch');
  await expect(verifyCycleOutputReceipt(receipt, changed(0, { content: 'corrupt' })))
    .rejects.toThrow("does not match its receipt");
  await expect(verifyCycleOutputReceipt(receipt, base.slice(0, 1)))
    .rejects.toThrow('output set mismatch');
});

test('browser provider API consumes listOutputs/renderOutput and optional host bytes', async () => {
  const receipt = await createCycleRendererOutputReceipt({
    inputBuildId,
    renderer: {
      listOutputs: () => [{
        file: 'index.html',
        mime: 'text/html',
        producer: 'narrative page',
      }],
      renderOutput: (file) => ({ file, mime: 'text/html', content: '<h1>Hello</h1>' }),
    },
    additionalOutputs: [base[1]],
  });
  const direct = await createCycleOutputReceipt({ inputBuildId, outputs: base });
  expect(receipt.outputBuildId).toBe(direct.outputBuildId);
});
