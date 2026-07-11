import { createHash } from 'node:crypto';
import { expect, test } from 'bun:test';
import type { ContentRef } from './closed-build';
import {
  computeCycleRendererPackageId,
  CycleRendererPackage,
  type CycleRendererPackageFile,
} from './renderer-package';
import { fixtureRendererPackage } from './renderer-package.test-support';

function file(path: string, source: string): { file: CycleRendererPackageFile; bytes: Uint8Array } {
  const bytes = new TextEncoder().encode(source);
  const content: ContentRef = {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    byteLength: bytes.byteLength,
    mediaType: 'text/plain',
  };
  return { file: { path, mediaType: 'text/plain', producer: 'fixture', content }, bytes };
}

test('opened renderer package exposes metadata and isolates only the requested body', async () => {
  const rendererPackage = await fixtureRendererPackage();
  expect(rendererPackage.outputs()).toHaveLength(5);
  expect(rendererPackage.outputs()[0]).not.toHaveProperty('content');
  const first = rendererPackage.render('assets/app.js')!;
  first[0] = 0;
  expect(new TextDecoder().decode(rendererPackage.render('assets/app.js')!)).toContain('document');
  expect(rendererPackage.render('missing')).toBeNull();
});

test('renderer package rejects noncanonical catalogs and corrupt bodies', async () => {
  const a = file('a.txt', 'a');
  const b = file('b.txt', 'b');
  const reversed = [b.file, a.file];
  await expect(CycleRendererPackage.open({
    schemaVersion: 'cycle-renderer-package/v1',
    packageId: await computeCycleRendererPackageId(reversed),
    files: reversed,
  }, { get: async () => new Uint8Array() })).rejects.toThrow('strictly UTF-8 path ordered');

  const files = [a.file];
  await expect(CycleRendererPackage.open({
    schemaVersion: 'cycle-renderer-package/v1',
    packageId: await computeCycleRendererPackageId(files),
    files,
  }, { get: async () => new TextEncoder().encode('z') })).rejects.toThrow('digest mismatch');
});
