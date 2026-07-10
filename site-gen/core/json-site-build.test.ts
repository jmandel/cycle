import { createHash } from 'node:crypto';
import { expect, test } from 'bun:test';
import {
  ClosedBuildHandle,
  computeSiteBuildId,
  type ClosedSiteBuild,
  type ContentRef,
} from './closed-build';
import { JsonSiteBuildView, type SiteDbRows } from './json-site-build';
import { CYCLE_SITE_DB_ARTIFACT } from './site-build';

const rows: SiteDbRows = {
  metadata: [{ Key: 1, Name: 'version', Value: '4.0.1' }],
  resources: [{
    Key: 1,
    Type: 'ImplementationGuide',
    Id: 'fixture',
    Web: 'index.html',
    Json: JSON.stringify({ resourceType: 'ImplementationGuide', id: 'fixture', contact: [] }),
  }],
  concepts: [],
  valueSetCodes: [],
  pages: [],
  menu: [],
  siteConfig: [{ Name: 'sushi-config', Json: '{"id":"fixture"}' }],
  assets: [{ Name: 'note.md', Mime: 'text/markdown', Content: btoa('Hello') }],
};

async function fixture(): Promise<{ manifest: ClosedSiteBuild; bytes: Uint8Array; reference: ContentRef }> {
  const bytes = new TextEncoder().encode(JSON.stringify(rows));
  const reference = {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    byteLength: bytes.byteLength,
    mediaType: 'application/json',
  };
  const manifest: ClosedSiteBuild = {
    schemaVersion: 'site-build/v1',
    buildId: 'pending',
    project: { projectId: 'fixture', revision: 'sources:fixture', sources: {} },
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
      state: { status: 'ready', content: reference },
      provenance: { producer: { id: 'fixture', version: '1' }, recipe: 'fixture' },
    }],
    diagnostics: [],
  };
  manifest.buildId = await computeSiteBuildId(manifest);
  return { manifest, bytes, reference };
}

test('JsonSiteBuildView is constructed from verified canonical rows', async () => {
  const { manifest, bytes } = await fixture();
  const handle = await ClosedBuildHandle.open(manifest, { get: async () => bytes });
  const view = await JsonSiteBuildView.fromClosedBuild(handle);

  expect(view.metadata()).toEqual({ version: '4.0.1' });
  expect(view.ig().id).toBe('fixture');
  expect(view.siteConfig('sushi-config')).toEqual({ id: 'fixture' });
  expect(view.textAsset('note.md')).toBe('Hello');
  expect(new TextDecoder().decode(view.assets()[0].Content as Uint8Array)).toBe('Hello');
  expect(view.encodedAssets()[0].Content).toBe(btoa('Hello'));
});

test('JsonSiteBuildView selects the explicit index guide when additional guides sort first', () => {
  const view = new JsonSiteBuildView({
    ...rows,
    resources: [
      {
        Key: 2,
        Type: 'ImplementationGuide',
        Id: 'aaa-example',
        Web: 'ImplementationGuide-aaa-example.html',
        Json: JSON.stringify({ resourceType: 'ImplementationGuide', id: 'aaa-example' }),
      },
      ...rows.resources,
    ],
  });
  expect(view.ig().id).toBe('fixture');
});

test('JsonSiteBuildView rejects an absent or ambiguous primary index row', () => {
  const missing = new JsonSiteBuildView({
    ...rows,
    resources: rows.resources.map((row) => ({ ...row, Web: 'ImplementationGuide-fixture.html' })),
  });
  expect(() => missing.ig()).toThrow('found 0');
  const duplicate = new JsonSiteBuildView({
    ...rows,
    resources: [...rows.resources, { ...rows.resources[0], Key: 2, Id: 'other' }],
  });
  expect(() => duplicate.ig()).toThrow('found 2');
});

test('JsonSiteBuildView refuses a different external-builder contract', async () => {
  const { manifest, bytes } = await fixture();
  manifest.renderTarget.renderer.id = 'other-renderer';
  manifest.buildId = await computeSiteBuildId(manifest);
  const handle = await ClosedBuildHandle.open(manifest, { get: async () => bytes });
  await expect(JsonSiteBuildView.fromClosedBuild(handle)).rejects.toThrow('cycle-site/v1');
});
