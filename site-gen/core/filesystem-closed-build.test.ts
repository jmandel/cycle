import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'bun:test';
import { computeSiteBuildId } from './closed-build';
import type { ClosedSiteBuild, ContentRef } from './closed-build';
import { openFilesystemClosedBuild } from './filesystem-closed-build';
import { JsonSiteBuildView, type SiteDbRows } from './json-site-build';
import { CYCLE_SITE_DB_ARTIFACT } from './site-build';

const rows: SiteDbRows = {
  metadata: [{ Key: 1, Name: 'version', Value: '4.0.1' }],
  resources: [{
    Key: 1,
    Type: 'ImplementationGuide',
    Id: 'filesystem-fixture',
    Web: 'index.html',
    Json: JSON.stringify({ resourceType: 'ImplementationGuide', id: 'filesystem-fixture', contact: [] }),
  }],
  concepts: [],
  valueSetCodes: [],
  pages: [],
  menu: [],
  siteConfig: [],
  assets: [{ Name: 'image.bin', Mime: 'application/octet-stream', Content: btoa('\u0000\u0001\u0002') }],
};

async function writeSyntheticBundle(root: string): Promise<ContentRef> {
  const bytes = new TextEncoder().encode(JSON.stringify(rows));
  const content: ContentRef = {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    byteLength: bytes.byteLength,
    mediaType: 'application/json',
  };
  const manifest: ClosedSiteBuild = {
    schemaVersion: 'site-build/v1',
    buildId: 'pending',
    project: { projectId: 'filesystem-fixture', revision: 'sources:fixture', sources: {} },
    packageLock: {},
    renderTarget: {
      renderer: { id: 'cycle-site', version: '1' },
      mode: 'external_builder',
      fhirVersion: '4.0.1',
      parameters: { contract: 'cycle-site/v1' },
    },
    renderPlan: { requiredArtifacts: [CYCLE_SITE_DB_ARTIFACT] },
    artifacts: [{
      key: CYCLE_SITE_DB_ARTIFACT,
      state: { status: 'ready', content },
      provenance: { producer: { id: 'fixture', version: '1' }, recipe: 'fixture' },
    }],
    diagnostics: [],
  };
  manifest.buildId = await computeSiteBuildId(manifest);
  await mkdir(join(root, 'objects/sha256'), { recursive: true });
  await writeFile(join(root, 'site-build.json'), JSON.stringify(manifest));
  await writeFile(join(root, 'objects/sha256', content.sha256), bytes);
  return content;
}

test('filesystem bundle opens through the portable verified handle and yields decoded assets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cycle-fig-build-'));
  try {
    const content = await writeSyntheticBundle(root);
    const handle = await openFilesystemClosedBuild(root);
    const view = await JsonSiteBuildView.fromClosedBuild(handle);
    expect(handle.manifest.project.projectId).toBe('filesystem-fixture');
    expect(handle.artifactRecord(CYCLE_SITE_DB_ARTIFACT).state).toEqual({ status: 'ready', content });
    expect(view.ig().id).toBe('filesystem-fixture');
    expect([...view.assets()[0].Content as Uint8Array]).toEqual([0, 1, 2]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('filesystem bundle fails closed when its addressed object is absent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cycle-fig-build-missing-'));
  try {
    const content = await writeSyntheticBundle(root);
    await rm(join(root, 'objects/sha256', content.sha256));
    await expect(openFilesystemClosedBuild(root)).rejects.toThrow('Content store is missing');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
