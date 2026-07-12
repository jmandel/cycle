import { expect, test } from 'bun:test';
import {
  CYCLE_OUTPUT_RECEIPT_PATH,
  createCycleRendererOutputReceipt,
  createCycleOutputReceipt,
  createSiteOutputCacheKey,
  equalCycleOutputReceipts,
  serializeCycleOutputReceipt,
  validateCycleOutputReceipt,
  verifyCycleOutputReceipt,
  verifySiteOutputStore,
  type CreateCycleOutputReceiptOptions,
  type CycleOutputMaterial,
} from './output-receipt';

const inputBuildId = `sb1-sha256:${'1'.repeat(64)}`;
const renderer = { id: 'cycle-site', version: '1', recipeSha256: '2'.repeat(64) };
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

function create(outputs = base, override: Partial<CreateCycleOutputReceiptOptions> = {}) {
  return createCycleOutputReceipt({ inputBuildId, renderer, outputs, ...override });
}

test('identities are order independent and split derivation key from material output id', async () => {
  const forward = await create();
  const reverse = await create([...base].reverse());
  const changedBytes = await create(changed(0, { content: '<h1>Changed</h1>' }));
  expect(reverse).toEqual(forward);
  expect(await equalCycleOutputReceipts(forward, reverse)).toBe(true);
  expect(forward.files.map((file) => file.path)).toEqual(['assets/app.js', 'index.html']);
  expect(forward.cacheKey).toMatch(/^sok1-sha256:[0-9a-f]{64}$/);
  expect(forward.outputId).toMatch(/^so1-sha256:[0-9a-f]{64}$/);
  expect(changedBytes.cacheKey).toBe(forward.cacheKey);
  expect(changedBytes.outputId).not.toBe(forward.outputId);
  expect(await createSiteOutputCacheKey({ inputBuildId, renderer })).toBe(forward.cacheKey);
});

test('closed input, renderer recipe, schema, and options all affect the pre-render cache key', async () => {
  const original = await create();
  const variants = [
    await create(base, { inputBuildId: `sb1-sha256:${'3'.repeat(64)}` }),
    await create(base, { renderer: { ...renderer, version: '2' } }),
    await create(base, { renderer: { ...renderer, recipeSha256: '4'.repeat(64) } }),
    await create(base, { outputSchema: 'cycle-static-site/v2' }),
    await create(base, { options: { minify: 'true' } }),
  ];
  for (const variant of variants) expect(variant.cacheKey).not.toBe(original.cacheKey);
});

test('file path, media, producer/source/owner, and bytes affect full output identity', async () => {
  const original = await create();
  const variants = [
    await create(changed(0, { content: '<h1>Changed</h1>' })),
    await create(changed(0, { path: 'home.html' })),
    await create(changed(0, { mediaType: 'application/xhtml+xml' })),
    await create(changed(0, { producer: { id: 'cycle-site-fork', version: '1' } })),
    await create(changed(0, { source: 'different recipe' })),
    await create(changed(1, { owner: 'index.html' })),
  ];
  for (const variant of variants) expect(variant.outputId).not.toBe(original.outputId);
});

test('canonical path order follows UTF-8 bytes', async () => {
  const nonBmp = '\u{10000}.txt';
  const privateUseBmp = '\uE000.txt';
  const receipt = await create([nonBmp, privateUseBmp].map((path) => ({
    path,
    mediaType: 'text/plain',
    producer: { id: 'fixture', version: '1' },
    content: path,
  })));
  expect(receipt.files.map((file) => file.path)).toEqual([privateUseBmp, nonBmp]);
});

test('paths are unique, safe, owner-closed, and cannot claim the manifest', async () => {
  await expect(create([...base, { ...base[0] }])).rejects.toThrow("Duplicate Cycle output path 'index.html'");
  await expect(create(changed(0, { path: '../index.html' }))).rejects.toThrow('is unsafe');
  await expect(create(changed(0, { path: CYCLE_OUTPUT_RECEIPT_PATH }))).rejects.toThrow('reserved manifest path');
  await expect(create(changed(1, { owner: 'missing.html' }))).rejects.toThrow('names missing owner');
});

test('validation detects identity mutation and verification detects material mutation', async () => {
  const receipt = await create();
  const mutated = structuredClone(receipt);
  mutated.files[0].content.mediaType = 'text/plain';
  await expect(validateCycleOutputReceipt(mutated)).rejects.toThrow('id mismatch');
  await expect(verifyCycleOutputReceipt(receipt, changed(0, { content: 'corrupt' })))
    .rejects.toThrow('SiteOutput mismatch');
  await expect(verifyCycleOutputReceipt(receipt, base.slice(0, 1)))
    .rejects.toThrow('SiteOutput mismatch');
});

test('browser provider API emits the same browser-neutral contract', async () => {
  const receipt = await createCycleRendererOutputReceipt({
    inputBuildId,
    rendererRecipeSha256: renderer.recipeSha256,
    renderer: {
      listOutputs: () => [{ file: 'index.html', mime: 'text/html', producer: 'narrative page' }],
      renderOutput: (file) => ({ file, mime: 'text/html', content: '<h1>Hello</h1>' }),
    },
    additionalOutputs: [base[1]],
  });
  const direct = await create();
  expect(receipt.outputId).toBe(direct.outputId);
});

test('browser-neutral ContentStore verification checks every addressed object', async () => {
  const receipt = await create();
  const values = new Map<string, Uint8Array>();
  for (let index = 0; index < receipt.files.length; index++) {
    const material = base.find((item) => item.path === receipt.files[index].path)!;
    values.set(
      receipt.files[index].content.sha256,
      typeof material.content === 'string' ? new TextEncoder().encode(material.content) : material.content,
    );
  }
  await verifySiteOutputStore(receipt, { get: async (reference) => values.get(reference.sha256) || null });
  values.delete(receipt.files[0].content.sha256);
  await expect(verifySiteOutputStore(receipt, { get: async (reference) => values.get(reference.sha256) || null }))
    .rejects.toThrow('ContentStore is missing');
});

test('canonical ids match the independent Rust SiteOutput fixture', async () => {
  const receipt = await createCycleOutputReceipt({
    inputBuildId: 'sb1-sha256:5eb1101c55a13f90a6af2ef851eb32705b663caf669dc8b596baad690f15495d',
    renderer: {
      id: 'cycle-site',
      version: '1.0.0',
      recipeSha256: 'e1d8e552330911f9f779f85b6f2c00a15e790dcc3fbb3b28f5da1d660a30c5b8',
    },
    outputSchema: 'static-site/v1',
    options: { locale: 'en' },
    outputs: [{
      path: 'index.html',
      mediaType: 'text/html',
      producer: { id: 'cycle-page', version: '1' },
      source: 'page recipe',
      content: 'hello',
    }],
  });
  expect(receipt.cacheKey).toBe('sok1-sha256:52a6568c5df7d5db15d43a1c5c1ce4eb0a64cffad5f4c2dc53ba09335180af2b');
  expect(receipt.outputId).toBe('so1-sha256:5c395c8bde04a11939c040de1bb920dc720db9e859453dea647560b46b18f0c1');
  const serialized = serializeCycleOutputReceipt(receipt);
  expect(serialized.endsWith('\n')).toBe(false);
  expect(JSON.parse(serialized)).toEqual(receipt);
});
