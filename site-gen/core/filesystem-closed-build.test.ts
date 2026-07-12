import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'bun:test';
import { computeSiteBuildId } from './closed-build';
import type { ArtifactKey, ClosedSiteBuild, ContentRef } from './closed-build';
import { openFilesystemClosedBuild } from './filesystem-closed-build';
import { openCycleGenerator } from './open-site-build';
import { fixtureRendererPackage } from './renderer-package.test-support';
import {
  CYCLE_SEMANTIC_CONFIG_ARTIFACT,
  CYCLE_SEMANTIC_NAVIGATION_ARTIFACT,
  CYCLE_SEMANTIC_RESOURCES_ARTIFACT,
  CYCLE_SEMANTIC_TERMINOLOGY_ARTIFACT,
} from './site-build';

const assetKey: ArtifactKey = {
  kind: 'asset',
  namespace: { kind: 'authored' },
  path: 'image.bin',
};

const values: Array<{ key: ArtifactKey; value: unknown; mediaType: string }> = [
  { key: assetKey, value: new Uint8Array([0, 1, 2]), mediaType: 'application/octet-stream' },
  {
    key: CYCLE_SEMANTIC_CONFIG_ARTIFACT,
    value: { schema: 'cycle.semantic.config/v1', sushiConfig: { id: 'filesystem-fixture' } },
    mediaType: 'application/json',
  },
  {
    key: CYCLE_SEMANTIC_NAVIGATION_ARTIFACT,
    value: { schema: 'cycle.semantic.navigation/v2', pages: [], menu: [] },
    mediaType: 'application/json',
  },
  {
    key: CYCLE_SEMANTIC_RESOURCES_ARTIFACT,
    value: {
      schema: 'cycle.semantic.resources/v1',
      guide: {
        implementationGuide: { resourceType: 'ImplementationGuide', id: 'filesystem-fixture' },
        packageId: 'filesystem-fixture',
        fhirVersion: '4.0.1',
        fhirPublicationBase: 'http://hl7.org/fhir/R4/',
        generated: { epochSeconds: 1, date: '1970-01-01T00:00:01Z', day: '19700101' },
      },
      resources: [{
        key: { resourceType: 'ImplementationGuide', id: 'filesystem-fixture' },
        resource: {
          resourceType: 'ImplementationGuide',
          id: 'filesystem-fixture',
          packageId: 'filesystem-fixture',
          status: 'draft',
          fhirVersion: ['4.0.1'],
          contact: [],
        },
      }],
    },
    mediaType: 'application/json',
  },
  {
    key: CYCLE_SEMANTIC_TERMINOLOGY_ARTIFACT,
    value: { schema: 'cycle.semantic.terminology/v1', expansions: [] },
    mediaType: 'application/json',
  },
];

function bytesOf(value: unknown): Uint8Array {
  return value instanceof Uint8Array
    ? value
    : new TextEncoder().encode(JSON.stringify(value));
}

async function writeSyntheticBundle(root: string): Promise<ContentRef[]> {
  const contents = values.map(({ value, mediaType }) => {
    const bytes = bytesOf(value);
    return {
      sha256: createHash('sha256').update(bytes).digest('hex'),
      byteLength: bytes.byteLength,
      mediaType,
    };
  });
  const manifest: ClosedSiteBuild = {
    schemaVersion: 'site-build/v2',
    buildId: 'pending',
    project: { projectId: 'filesystem-fixture', revision: 'sources:fixture', sources: {} },
    packageLock: {},
    renderTarget: {
      renderer: { id: 'cycle-site', version: '2' },
      mode: 'external_builder',
      fhirVersion: '4.0.1',
      parameters: { contract: 'cycle-site/v2' },
    },
    renderPlan: { requiredArtifacts: values.map(({ key }) => key) },
    artifacts: values.map(({ key }, index) => ({
      key,
      state: { status: 'ready', content: contents[index] },
      provenance: { producer: { id: 'fixture', version: '1' }, recipe: 'fixture' },
    })),
    diagnostics: [],
  };
  manifest.buildId = await computeSiteBuildId(manifest);
  await mkdir(join(root, 'objects/sha256'), { recursive: true });
  await writeFile(join(root, 'site-build.json'), JSON.stringify(manifest));
  await Promise.all(contents.map((content, index) => (
    writeFile(join(root, 'objects/sha256', content.sha256), bytesOf(values[index].value))
  )));
  return contents;
}

test('filesystem v2 bundle opens through the verified generator facade', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cycle-fig-build-'));
  try {
    await writeSyntheticBundle(root);
    const handle = await openFilesystemClosedBuild(root);
    const generator = await openCycleGenerator(handle, await fixtureRendererPackage());
    expect(generator.buildId).toBe(handle.manifest.buildId);
    expect(generator.outputs()).toContainEqual(expect.objectContaining({ file: 'image.bin', kind: 'asset' }));
    expect([...generator.render('image.bin').content as Uint8Array]).toEqual([0, 1, 2]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('filesystem bundle fails closed when an addressed object is absent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cycle-fig-build-missing-'));
  try {
    const contents = await writeSyntheticBundle(root);
    await rm(join(root, 'objects/sha256', contents[0].sha256));
    await expect(openFilesystemClosedBuild(root)).rejects.toThrow('Content store is missing');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
