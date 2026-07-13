import { expect, test } from 'bun:test';
import {
  serializeSiteOutput,
  validateSiteOutput,
  verifySiteOutput,
  verifySiteOutputStore,
  type SiteOutput,
} from './output-receipt';
import {
  RUST_SITE_OUTPUT_BYTES,
  RUST_SITE_OUTPUT_RECEIPT,
} from './output-receipt.fixture';

const receipt: SiteOutput = RUST_SITE_OUTPUT_RECEIPT;

test('independently validates Rust canonical ids and serialization', async () => {
  expect(await validateSiteOutput(structuredClone(receipt))).toEqual(receipt);
  const serialized = serializeSiteOutput(receipt);
  expect(serialized.endsWith('\n')).toBe(false);
  expect(JSON.parse(serialized)).toEqual(receipt);
});

test('receipt verification authenticates bytes and declarations without constructing a receipt', async () => {
  await verifySiteOutput(receipt, [{
    path: 'index.html',
    mediaType: 'text/html',
    producer: { id: 'cycle-page', version: '1' },
    source: 'page recipe',
    content: 'hello',
  }]);
  await expect(verifySiteOutput(receipt, [{
    path: 'index.html',
    mediaType: 'text/html',
    producer: { id: 'cycle-page', version: '1' },
    source: 'page recipe',
    content: 'changed',
  }])).rejects.toThrow('do not match');
});

test('identity and content-store mutations fail independently', async () => {
  const mutated = structuredClone(receipt);
  mutated.files[0].content.mediaType = 'text/plain';
  await expect(validateSiteOutput(mutated)).rejects.toThrow('id mismatch');
  await verifySiteOutputStore(receipt, { get: async () => RUST_SITE_OUTPUT_BYTES });
  await expect(verifySiteOutputStore(receipt, { get: async () => null }))
    .rejects.toThrow('ContentStore is missing');
});

test('rejects unsafe, reserved, duplicate, unordered, and owner-open Rust receipt mutations', async () => {
  const unsafe = structuredClone(receipt);
  unsafe.files[0].path = '../index.html';
  await expect(validateSiteOutput(unsafe)).rejects.toThrow('is unsafe');

  const reserved = structuredClone(receipt);
  reserved.files[0].path = 'site-output.json';
  await expect(validateSiteOutput(reserved)).rejects.toThrow('reserved manifest path');

  const duplicate = structuredClone(receipt);
  duplicate.files.push(structuredClone(duplicate.files[0]));
  await expect(validateSiteOutput(duplicate)).rejects.toThrow("repeats path 'index.html'");

  const unordered = structuredClone(receipt);
  unordered.files.unshift({ ...structuredClone(unordered.files[0]), path: 'z-last.html' });
  await expect(validateSiteOutput(unordered)).rejects.toThrow('canonical UTF-8 path order');

  const missingOwner = structuredClone(receipt);
  missingOwner.files[0].owner = 'missing.html';
  await expect(validateSiteOutput(missingOwner)).rejects.toThrow('names missing owner');
});

test('rejects malformed and identity-changing content references in the Rust receipt', async () => {
  const mutations: Array<[string, (candidate: SiteOutput) => void, string]> = [
    ['digest syntax', (candidate) => { candidate.files[0].content.sha256 = 'not-sha256'; }, 'lowercase SHA-256 digest'],
    ['negative length', (candidate) => { candidate.files[0].content.byteLength = -1; }, 'non-negative safe integer'],
    ['empty media', (candidate) => { candidate.files[0].content.mediaType = ''; }, 'must be a non-empty'],
    ['valid changed digest', (candidate) => { candidate.files[0].content.sha256 = 'a'.repeat(64); }, 'id mismatch'],
    ['valid changed length', (candidate) => { candidate.files[0].content.byteLength = 6; }, 'id mismatch'],
  ];
  for (const [label, mutate, expected] of mutations) {
    const candidate = structuredClone(receipt);
    mutate(candidate);
    await expect(validateSiteOutput(candidate), label).rejects.toThrow(expected);
  }
});
