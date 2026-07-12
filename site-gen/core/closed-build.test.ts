import { createHash } from 'node:crypto';
import { describe, expect, test } from 'bun:test';
import {
  ClosedBuildHandle,
  computeSiteBuildId,
  PREPARED_PACKAGE_MEDIA_TYPE,
  type ArtifactKey,
  type ArtifactRecord,
  type ClosedSiteBuild,
  type ContentRef,
  type ContentStore,
} from './closed-build';

const encoder = new TextEncoder();
const rootKey: ArtifactKey = { kind: 'data', namespace: 'test', name: 'root' };
const dependencyKey: ArtifactKey = { kind: 'data', namespace: 'test', name: 'dependency' };
const unusedKey: ArtifactKey = { kind: 'data', namespace: 'test', name: 'unused' };

function content(bytes: Uint8Array): ContentRef {
  return {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    byteLength: bytes.byteLength,
    mediaType: 'text/plain',
  };
}

function ready(key: ArtifactKey, bytes: Uint8Array, reads: ArtifactRecord['reads'] = []): ArtifactRecord {
  const record: ArtifactRecord = {
    key,
    state: { status: 'ready', content: content(bytes) },
    provenance: { producer: { id: 'test', version: '1' }, recipe: 'fixture' },
  };
  if (reads.length) record.reads = reads;
  return record;
}

async function build(records: ArtifactRecord[], roots: ArtifactKey[] = [rootKey]): Promise<ClosedSiteBuild> {
  const byDataName = (left: ArtifactKey, right: ArtifactKey) =>
    String(left.name).localeCompare(String(right.name), 'en', { sensitivity: 'variant' });
  records.sort((left, right) => byDataName(left.key, right.key));
  roots.sort(byDataName);
  const manifest: ClosedSiteBuild = {
    schemaVersion: 'site-build/v2',
    buildId: 'pending',
    project: { projectId: 'test', revision: 'sources:test', sources: {} },
    packageLock: {},
    renderTarget: {
      renderer: { id: 'test-renderer', version: '1' },
      mode: 'external_builder',
      fhirVersion: '4.0.1',
    },
    renderPlan: { requiredArtifacts: roots },
    artifacts: records,
    diagnostics: [],
  };
  manifest.buildId = await computeSiteBuildId(manifest);
  return manifest;
}

class MapStore implements ContentStore {
  constructor(private readonly values: Map<string, Uint8Array>) {}
  async get(reference: ContentRef): Promise<Uint8Array | null> {
    return this.values.get(reference.sha256) ?? null;
  }
}

describe('ClosedBuildHandle', () => {
  test('matches the Rust v2 canonical build-id golden', async () => {
    const core = 'hl7.fhir.r4.core#4.0.1';
    const template = 'hl7.fhir.template#1.0.0';
    const resourceKey: ArtifactKey = {
      kind: 'resource',
      resource: { resourceType: 'StructureDefinition', id: 'demo' },
    };
    const fragmentKey: ArtifactKey = {
      kind: 'fragment',
      scope: { kind: 'resource', resource: { resourceType: 'StructureDefinition', id: 'demo' } },
      fragment: { kind: 'summary' },
    };
    const provenance = { producer: { id: 'test.renderer', version: '1.0.0' }, recipe: 'fixture' };
    const manifest: ClosedSiteBuild = {
      schemaVersion: 'site-build/v2',
      buildId: 'pending',
      project: {
        projectId: 'demo.ig',
        revision: '0123456789abcdef',
        sources: {
          'input/fsh/demo.fsh': { kind: { kind: 'fsh' }, content: content(encoder.encode('Profile: Demo')) },
          'sushi-config.yaml': { kind: { kind: 'config' }, content: content(encoder.encode('id: demo')) },
        },
      },
      packageLock: {
        [core]: { coordinate: core, content: { ...content(encoder.encode('core')), mediaType: PREPARED_PACKAGE_MEDIA_TYPE } },
        [template]: {
          coordinate: template,
          content: { ...content(encoder.encode('template')), mediaType: PREPARED_PACKAGE_MEDIA_TYPE },
          dependencies: [core],
        },
      },
      renderTarget: {
        renderer: { id: 'native-template', version: '0.1.0' },
        mode: 'native_template',
        fhirVersion: '4.0.1',
        template,
        parameters: { locale: 'en', strict: 'true' },
      },
      renderPlan: { requiredArtifacts: [resourceKey] },
      artifacts: [
        {
          key: resourceKey,
          state: {
            status: 'ready',
            content: { ...content(encoder.encode('{}')), mediaType: 'application/fhir+json' },
          },
          provenance,
          reads: [
            { kind: 'source', path: 'input/fsh/demo.fsh' },
            { kind: 'package', coordinate: core },
          ],
        },
        {
          key: fragmentKey,
          state: { status: 'deferred', reason: 'materialize on renderer demand' },
          provenance,
          reads: [{ kind: 'artifact', key: resourceKey }],
        },
      ],
      diagnostics: [
        { sequence: 0, severity: 'information', code: 'I1', message: 'first' },
        { sequence: 0, severity: 'warning', code: 'W2', message: 'second' },
      ],
    };
    expect(await computeSiteBuildId(manifest)).toBe(
      'sb1-sha256:0490a3e4add53e3246b0865ddf07cf757fb8181b6d82beee088781fceefb1cd5',
    );
  });

  test('matches Rust UTF-8 ordering for non-BMP object keys', async () => {
    const manifest = await build([ready(rootKey, encoder.encode('root'))]);
    manifest.project.projectId = 'unicode.ig';
    manifest.project.revision = 'unicode-order';
    manifest.project.sources = {
      '\u{e000}': { kind: { kind: 'asset' }, content: content(encoder.encode('a')) },
      '\u{10000}': { kind: { kind: 'asset' }, content: content(encoder.encode('b')) },
    };
    manifest.renderTarget.renderer = { id: 'external', version: '1' };
    manifest.artifacts[0].provenance = {
      producer: { id: 'test.renderer', version: '1.0.0' },
      recipe: 'fixture',
    };
    expect(await computeSiteBuildId(manifest)).toBe(
      'sb1-sha256:4b560ddd18498b28623af0a4608727cd6831ab8fdb22c549bbd52073877f9333',
    );
  });

  test('verifies a transitive ready closure and scopes artifact reads to it', async () => {
    const root = encoder.encode('root');
    const dependency = encoder.encode('dependency');
    const unused = encoder.encode('unused');
    const manifest = await build([
      ready(rootKey, root, [{ kind: 'artifact', key: dependencyKey }]),
      ready(dependencyKey, dependency),
      ready(unusedKey, unused),
    ]);
    const store = new MapStore(new Map([
      [content(root).sha256, root],
      [content(dependency).sha256, dependency],
      [content(unused).sha256, unused],
    ]));

    const handle = await ClosedBuildHandle.open(manifest, store);
    expect(new TextDecoder().decode(await handle.readArtifact(rootKey))).toBe('root');
    expect(new TextDecoder().decode(await handle.readArtifact(dependencyKey))).toBe('dependency');
    expect(() => handle.artifactRecord(unusedKey)).toThrow('outside the closed render plan');
  });

  test('rejects a tampered build id before exposing content', async () => {
    const bytes = encoder.encode('root');
    const manifest = await build([ready(rootKey, bytes)]);
    manifest.project.revision = 'tampered';
    await expect(ClosedBuildHandle.open(manifest, new MapStore(new Map()))).rejects.toThrow('SiteBuild id mismatch');
  });

  test('rejects a non-ready transitive dependency even with a valid build id', async () => {
    const bytes = encoder.encode('root');
    const manifest = await build([
      ready(rootKey, bytes, [{ kind: 'artifact', key: dependencyKey }]),
      {
        key: dependencyKey,
        state: { status: 'deferred', reason: 'not produced' },
        provenance: { producer: { id: 'test', version: '1' }, recipe: 'fixture' },
      },
    ]);
    await expect(ClosedBuildHandle.open(manifest, new MapStore(new Map()))).rejects.toThrow('deferred: not produced');
  });

  test('rejects a missing transitive object while opening the handle', async () => {
    const root = encoder.encode('root');
    const dependency = encoder.encode('dependency');
    const manifest = await build([
      ready(rootKey, root, [{ kind: 'artifact', key: dependencyKey }]),
      ready(dependencyKey, dependency),
    ]);
    const store = new MapStore(new Map([[content(root).sha256, root]]));
    await expect(ClosedBuildHandle.open(manifest, store)).rejects.toThrow('Content store is missing');
  });

  test('rejects dangling producer source, package, and artifact reads', async () => {
    const bytes = encoder.encode('root');
    for (const read of [
      { kind: 'source', path: 'input/missing.fsh' } as const,
      { kind: 'package', coordinate: 'missing#1.0.0' } as const,
      { kind: 'artifact', key: dependencyKey } as const,
    ]) {
      const manifest = await build([ready(rootKey, bytes, [read])]);
      await expect(ClosedBuildHandle.open(manifest, new MapStore(new Map()))).rejects.toThrow('references missing');
    }
  });

  test('uses own-property checks for source and package references', async () => {
    const bytes = encoder.encode('root');
    const sourceManifest = await build([ready(rootKey, bytes, [{ kind: 'source', path: 'toString' }])]);
    await expect(ClosedBuildHandle.open(sourceManifest, new MapStore(new Map()))).rejects.toThrow('references missing source');

    const packageManifest = await build([ready(rootKey, bytes, [{ kind: 'package', coordinate: 'constructor' }])]);
    // The malformed coordinate is rejected before referential lookup.
    await expect(ClosedBuildHandle.open(packageManifest, new MapStore(new Map()))).rejects.toThrow('coordinate is invalid');
  });

  test('rejects a v2 package lock that does not root a prepared carrier', async () => {
    const manifest = await build([]);
    const coordinate = 'example.fhir#1.0.0';
    manifest.packageLock[coordinate] = {
      coordinate,
      content: { ...content(encoder.encode('legacy payload')), mediaType: 'application/octet-stream' },
    };
    manifest.buildId = await computeSiteBuildId(manifest);
    await expect(ClosedBuildHandle.open(manifest, new MapStore(new Map()))).rejects.toThrow('carrier media type is invalid');
  });

  test('rejects malformed ready content, provenance, and noncanonical sets even with a self-hash', async () => {
    const bytes = encoder.encode('root');

    const badContent = await build([ready(rootKey, bytes)]);
    (badContent.artifacts[0].state as any).content.mediaType = '';
    badContent.buildId = await computeSiteBuildId(badContent);
    await expect(ClosedBuildHandle.open(badContent, new MapStore(new Map()))).rejects.toThrow('invalid media type');

    const badProvenance = await build([ready(rootKey, bytes)]);
    badProvenance.artifacts[0].provenance = null;
    badProvenance.buildId = await computeSiteBuildId(badProvenance);
    await expect(ClosedBuildHandle.open(badProvenance, new MapStore(new Map()))).rejects.toThrow('must be an object');

    const reordered = await build([
      ready(rootKey, bytes),
      ready(dependencyKey, encoder.encode('dependency')),
    ]);
    reordered.artifacts.reverse();
    reordered.buildId = await computeSiteBuildId(reordered);
    await expect(ClosedBuildHandle.open(reordered, new MapStore(new Map()))).rejects.toThrow('canonical Rust order');

    const duplicateRoot = await build([ready(rootKey, bytes)]);
    duplicateRoot.renderPlan.requiredArtifacts.push(rootKey);
    duplicateRoot.buildId = await computeSiteBuildId(duplicateRoot);
    await expect(ClosedBuildHandle.open(duplicateRoot, new MapStore(new Map()))).rejects.toThrow('duplicate member');
  });

  test('checks producer provenance references without requiring their input bytes', async () => {
    const artifact = encoder.encode('render-ready rows');
    const source = encoder.encode('Profile: Demo');
    const pkg = encoder.encode('normalized package payload');
    const manifest = await build([
      ready(rootKey, artifact, [
        { kind: 'source', path: 'input/fsh/demo.fsh' },
        { kind: 'package', coordinate: 'example.fhir#1.0.0' },
        { kind: 'content', sha256: content(source).sha256 },
      ]),
    ]);
    manifest.project.sources['input/fsh/demo.fsh'] = {
      kind: { kind: 'fsh' },
      content: content(source),
    };
    manifest.packageLock['example.fhir#1.0.0'] = {
      coordinate: 'example.fhir#1.0.0',
      content: { ...content(pkg), mediaType: PREPARED_PACKAGE_MEDIA_TYPE },
    };
    manifest.buildId = await computeSiteBuildId(manifest);

    // Source/package refs prove what produced the ready artifact. The renderer
    // only needs the artifact body itself and must not redownload large package
    // payloads merely to consume an already-closed build.
    const handle = await ClosedBuildHandle.open(
      manifest,
      new MapStore(new Map([[content(artifact).sha256, artifact]])),
    );
    expect(new TextDecoder().decode(await handle.readArtifact(rootKey))).toBe('render-ready rows');
  });

  test('checks byte length and digest while opening the complete object closure', async () => {
    const expected = encoder.encode('root');
    const manifest = await build([ready(rootKey, expected)]);
    const reference = content(expected);

    await expect(ClosedBuildHandle.open(
      manifest,
      new MapStore(new Map([[reference.sha256, encoder.encode('bad')]])),
    )).rejects.toThrow('length mismatch');

    await expect(ClosedBuildHandle.open(
      manifest,
      new MapStore(new Map([[reference.sha256, encoder.encode('xxxx')]])),
    )).rejects.toThrow('digest mismatch');
  });
});
