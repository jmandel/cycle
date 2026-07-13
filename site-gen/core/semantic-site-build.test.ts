import { createHash } from 'node:crypto';
import { expect, test } from 'bun:test';
import {
  ClosedBuildHandle,
  computeSiteBuildId,
  type ArtifactKey,
  type ArtifactRecord,
  type ClosedSiteBuild,
  type ContentRef,
} from './closed-build';
import { openCycleGenerator } from './open-site-build';
import { MemoryContentStore } from './memory-content-store';
import { fixtureRendererPackage } from './renderer-package.test-support';
import { CycleSiteRenderer } from './renderer';
import {
  CycleSiteBuild,
  type SemanticConfigPayload,
  type SemanticNavigationPayload,
  type SemanticResourcesPayload,
  type SemanticTerminologyPayload,
} from './semantic-site-build';
import {
  CYCLE_SEMANTIC_CONFIG_ARTIFACT,
  CYCLE_SEMANTIC_NAVIGATION_ARTIFACT,
  CYCLE_SEMANTIC_RESOURCES_ARTIFACT,
  CYCLE_SEMANTIC_TERMINOLOGY_ARTIFACT,
} from './site-build';

const encoder = new TextEncoder();

async function openFixtureGenerator(build: ClosedBuildHandle) {
  return openCycleGenerator(build, await fixtureRendererPackage(), new MemoryContentStore());
}

interface FixturePayloads {
  resources: SemanticResourcesPayload;
  terminology: SemanticTerminologyPayload;
  navigation: SemanticNavigationPayload;
  config: SemanticConfigPayload;
}

interface FixtureArtifact {
  key: ArtifactKey;
  bytes: Uint8Array;
  mediaType?: string;
}

function content(bytes: Uint8Array, mediaType?: string): ContentRef {
  return {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    byteLength: bytes.byteLength,
    ...(mediaType ? { mediaType } : {}),
  };
}

function keyOrder(left: ArtifactKey, right: ArtifactKey): number {
  const variants = ['semantic_model', 'resource', 'fragment', 'page', 'asset', 'data'];
  const rank = variants.indexOf(left.kind) - variants.indexOf(right.kind);
  if (rank) return rank;
  if (left.kind === 'asset') {
    const namespaces = ['authored', 'template', 'publisher_runtime', 'generated', 'other'];
    const leftNamespace = left.namespace as { kind: string; name?: string };
    const rightNamespace = right.namespace as { kind: string; name?: string };
    return namespaces.indexOf(leftNamespace.kind) - namespaces.indexOf(rightNamespace.kind)
      || String(leftNamespace.name || '').localeCompare(String(rightNamespace.name || ''))
      || String(left.path).localeCompare(String(right.path));
  }
  if (left.kind === 'data') {
    return String(left.namespace).localeCompare(String(right.namespace))
      || String(left.name).localeCompare(String(right.name));
  }
  return JSON.stringify(left).localeCompare(JSON.stringify(right));
}

async function closedHandle(
  target: ClosedSiteBuild['renderTarget'],
  artifacts: FixtureArtifact[],
  roots: ArtifactKey[],
): Promise<ClosedBuildHandle> {
  const objects = new Map<string, Uint8Array>();
  const records: ArtifactRecord[] = artifacts.map((artifact) => {
    const reference = content(artifact.bytes, artifact.mediaType);
    objects.set(reference.sha256, artifact.bytes);
    return {
      key: artifact.key,
      state: { status: 'ready', content: reference },
      provenance: { producer: { id: 'cycle-test', version: '1' }, recipe: 'fixture' },
    };
  }).sort((left, right) => keyOrder(left.key, right.key));
  roots.sort(keyOrder);
  const manifest: ClosedSiteBuild = {
    schemaVersion: 'site-build/v2',
    buildId: 'pending',
    project: { projectId: 'fixture.ig', revision: 'fixture', sources: {} },
    packageLock: {},
    renderTarget: target,
    renderPlan: { requiredArtifacts: roots },
    artifacts: records,
    diagnostics: [],
  };
  manifest.buildId = await computeSiteBuildId(manifest);
  return ClosedBuildHandle.open(manifest, {
    get: async (reference) => objects.get(reference.sha256)?.slice() || null,
  });
}

function payloads(): FixturePayloads {
  const implementationGuide = {
    resourceType: 'ImplementationGuide',
    id: 'fixture',
    url: 'https://example.org/ig/ImplementationGuide/fixture.ig',
    packageId: 'fixture.ig',
    name: 'FixtureIG',
    title: 'Fixture IG',
    version: '1.0.0',
    status: 'draft',
    fhirVersion: ['4.0.1'],
    description: 'Fixture description.',
    contact: [{ name: 'Team', telecom: [{ system: 'url', value: 'https://example.org' }] }],
  };
  const codeSystem = {
    resourceType: 'CodeSystem',
    id: 'fixture-codes',
    url: 'https://example.org/ig/CodeSystem/fixture-codes',
    name: 'FixtureCodes',
    title: 'Fixture codes',
    version: '1.0.0',
    status: 'active',
    description: 'Fixture terminology.',
    concept: [{
      code: 'parent', display: 'Parent', definition: 'Parent concept',
      concept: [{ code: 'child', display: 'Child', definition: 'Child concept' }],
    }],
  };
  // Deliberately non-alphabetic property order: v2 must not turn parsed FHIR
  // resources back into a lexicographically sorted transport.
  const profile = {
    resourceType: 'StructureDefinition',
    id: 'fixture-profile',
    zeta: 'last alphabetically',
    alpha: 'first alphabetically',
    url: 'https://example.org/ig/StructureDefinition/fixture-profile',
    name: 'FixtureProfile',
    title: 'Fixture profile',
    version: '1.0.0',
    status: 'draft',
    description: 'Fixture profile description.',
    kind: 'resource',
    type: 'Observation',
    derivation: 'constraint',
    baseDefinition: 'http://hl7.org/fhir/StructureDefinition/Observation',
    differential: { element: [{ id: 'Observation', path: 'Observation' }] },
    snapshot: { element: [{ id: 'Observation', path: 'Observation' }] },
  };
  const valueSet = {
    resourceType: 'ValueSet',
    id: 'fixture-values',
    url: 'https://example.org/ig/ValueSet/fixture-values',
    name: 'FixtureValues',
    title: 'Fixture values',
    version: '1.0.0',
    status: 'active',
    description: 'Fixture value set.',
    compose: { include: [{ system: codeSystem.url }] },
  };
  return {
    resources: {
      schema: 'cycle.semantic.resources/v1',
      guide: {
        implementationGuide: { resourceType: 'ImplementationGuide', id: 'fixture' },
        packageId: 'fixture.ig',
        canonical: 'https://example.org/ig',
        name: 'FixtureIG',
        version: '1.0.0',
        fhirVersion: '4.0.1',
        releaseLabel: 'ci-build',
        fhirPublicationBase: 'http://hl7.org/fhir/R4/',
        generated: { epochSeconds: 1_700_000_000, date: '2023-11-14T22:13:20Z', day: '20231114' },
        sourceControl: { branch: 'main', revision: 'abc123' },
      },
      resources: [
        { key: { resourceType: 'ImplementationGuide', id: 'fixture' }, resource: implementationGuide },
        { key: { resourceType: 'CodeSystem', id: 'fixture-codes' }, resource: codeSystem },
        {
          key: { resourceType: 'StructureDefinition', id: 'fixture-profile' },
          resource: profile,
          publication: {
            displayName: 'FixtureProfile',
            description: 'Fixture profile description.',
            standardStatus: 'trial-use',
            baseDefinition: 'http://hl7.org/fhir/StructureDefinition/Observation|4.0.1',
          },
        },
        { key: { resourceType: 'ValueSet', id: 'fixture-values' }, resource: valueSet },
      ],
      publisherCompatibility: {
        errorCount: '0',
        toolingVersion: 'site-gen.publisher',
        toolingRevision: '0',
        toolingVersionFull: 'site-gen.publisher experiment',
      },
    },
    terminology: {
      schema: 'cycle.semantic.terminology/v1',
      expansions: [{
        valueSet: { resourceType: 'ValueSet', id: 'fixture-values' },
        url: valueSet.url,
        version: '1.0.0',
        codes: [
          { system: codeSystem.url, code: 'child', display: 'Child' },
          { system: codeSystem.url, code: 'parent', display: 'Parent' },
        ],
      }],
    },
    navigation: {
      schema: 'cycle.semantic.navigation/v2',
      pages: [{
        nameUrl: 'index.html',
        title: 'Home',
        generation: 'markdown',
        body: '# Home\n\nFixture.',
        source: 'input/pagecontent/index.md',
        children: [{
          nameUrl: 'guide.html',
          title: 'Guide',
          generation: 'markdown',
          body: '# Guide',
          source: 'input/pagecontent/guide.md',
          children: [],
        }],
      }],
      menu: [
        { label: 'Home', href: 'index.html', items: [] },
        { label: 'Documentation', items: [{ label: 'Guide', href: 'guide.html', items: [] }] },
      ],
    },
    config: {
      schema: 'cycle.semantic.config/v1',
      sushiConfig: { id: 'fixture.ig', canonical: 'https://example.org/ig' },
    },
  };
}

const assetKey: ArtifactKey = {
  kind: 'asset',
  namespace: { kind: 'authored' },
  path: 'images/fixture.svg',
};

const includeKey: ArtifactKey = {
  kind: 'asset',
  namespace: { kind: 'other', name: 'cycle.authored.include/v1' },
  path: 'shared.md',
};

function jsonArtifact(key: ArtifactKey, value: unknown): FixtureArtifact {
  return { key, bytes: encoder.encode(JSON.stringify(value)), mediaType: 'application/json' };
}

async function v2Handle(
  values: FixturePayloads = payloads(),
  roots?: ArtifactKey[],
  extras: FixtureArtifact[] = [],
  target: ClosedSiteBuild['renderTarget'] = {
    renderer: { id: 'cycle-site', version: '2' },
    mode: 'external_builder',
    fhirVersion: '4.0.1',
    parameters: { contract: 'cycle-site/v2' },
  },
): Promise<ClosedBuildHandle> {
  const artifacts = [
    jsonArtifact(CYCLE_SEMANTIC_RESOURCES_ARTIFACT, values.resources),
    jsonArtifact(CYCLE_SEMANTIC_TERMINOLOGY_ARTIFACT, values.terminology),
    jsonArtifact(CYCLE_SEMANTIC_NAVIGATION_ARTIFACT, values.navigation),
    jsonArtifact(CYCLE_SEMANTIC_CONFIG_ARTIFACT, values.config),
    { key: assetKey, bytes: encoder.encode('<svg>fixture</svg>'), mediaType: 'image/svg+xml' },
    ...extras,
  ];
  return closedHandle(target, artifacts, roots || [
    assetKey,
    CYCLE_SEMANTIC_CONFIG_ARTIFACT,
    CYCLE_SEMANTIC_NAVIGATION_ARTIFACT,
    CYCLE_SEMANTIC_RESOURCES_ARTIFACT,
    CYCLE_SEMANTIC_TERMINOLOGY_ARTIFACT,
  ]);
}

function bytesOf(asset: { bytes: Uint8Array }): string {
  return new TextDecoder().decode(asset.bytes);
}

test('cycle-site/v2 preloads typed semantic resources, navigation, and assets', async () => {
  const site = await CycleSiteBuild.fromClosedBuild(await v2Handle());
  expect(site).toBeInstanceOf(CycleSiteBuild);
  expect(site.metadata()).toEqual({
    path: 'http://hl7.org/fhir/R4/', canonical: 'https://example.org/ig', igId: 'fixture.ig',
    igName: 'FixtureIG', packageId: 'fixture.ig', igVer: '1.0.0', errorCount: '0',
    version: '4.0.1', releaseLabel: 'ci-build', revision: 'abc123', versionFull: '4.0.1-abc123',
    toolingVersion: 'site-gen.publisher', toolingRevision: '0',
    toolingVersionFull: 'site-gen.publisher experiment', genDate: '2023-11-14T22:13:20Z',
    genDay: '20231114', gitstatus: 'main',
  });
  const profile = site.resources('StructureDefinition')[0];
  expect(profile.id).toBe('fixture-profile');
  expect(profile.base).toBe('http://hl7.org/fhir/StructureDefinition/Observation|4.0.1');
  expect(profile.standardStatus).toBe('trial-use');
  expect(Object.keys(profile.resource).slice(0, 6)).toEqual([
    'resourceType', 'id', 'zeta', 'alpha', 'url', 'name',
  ]);
  expect(JSON.stringify(profile.resource, null, 2)).toStartWith(
    '{\n  "resourceType": "StructureDefinition",\n  "id": "fixture-profile",\n  "zeta":',
  );
  expect(site.valueSetCodes('https://example.org/ig/ValueSet/fixture-values')).toEqual([
    { system: 'https://example.org/ig/CodeSystem/fixture-codes', code: 'child', display: 'Child' },
    { system: 'https://example.org/ig/CodeSystem/fixture-codes', code: 'parent', display: 'Parent' },
  ]);
  expect(site.concepts(site.resources('CodeSystem')[0])).toEqual([
    {
      code: 'parent', display: 'Parent', definition: 'Parent concept',
      children: [{ code: 'child', display: 'Child', definition: 'Child concept', children: [] }],
    },
  ]);
  expect(site.pages()).toEqual([
    { slug: 'index', nameUrl: 'index.html', title: 'Home', generation: 'markdown', body: '# Home\n\nFixture.' },
    { slug: 'guide', nameUrl: 'guide.html', title: 'Guide', generation: 'markdown', body: '# Guide' },
  ]);
  expect(site.menu()).toEqual([
    { label: 'Home', href: 'index.html', items: [] },
    { label: 'Documentation', items: [{ label: 'Guide', href: 'guide.html', items: [] }] },
  ]);
  expect(site.siteConfig('sushi-config')).toEqual({ id: 'fixture.ig', canonical: 'https://example.org/ig' });
  expect(site.siteConfig('other')).toBeNull();
  expect(site.textAsset('images/fixture.svg')).toBe('<svg>fixture</svg>');
  expect(site.assetCatalog()).toEqual([{ path: 'images/fixture.svg', mediaType: 'image/svg+xml' }]);
  expect(bytesOf(site.asset('images/fixture.svg')!)).toBe('<svg>fixture</svg>');
  expect(site.ig().contact[0].telecom).toEqual(['https://example.org']);
});

test('typed authored includes are available to Liquid but are not public outputs', async () => {
  const handle = await v2Handle(payloads(), [
    assetKey,
    includeKey,
    CYCLE_SEMANTIC_CONFIG_ARTIFACT,
    CYCLE_SEMANTIC_NAVIGATION_ARTIFACT,
    CYCLE_SEMANTIC_RESOURCES_ARTIFACT,
    CYCLE_SEMANTIC_TERMINOLOGY_ARTIFACT,
  ], [{ key: includeKey, bytes: encoder.encode('private include'), mediaType: 'text/markdown' }]);
  const site = await CycleSiteBuild.fromClosedBuild(handle);
  expect(site.textAsset('shared.md')).toBe('private include');
  expect(site.assetCatalog()).toEqual([{ path: 'images/fixture.svg', mediaType: 'image/svg+xml' }]);
  expect(site.asset('shared.md')).toBeNull();

  const generator = await openFixtureGenerator(handle);
  expect(generator.outputs().some((output) => output.file === 'shared.md')).toBe(false);
});

test('v2-only generator binds its output catalog and direct renderer to one build', async () => {
  const handle = await v2Handle();
  const outputStore = new MemoryContentStore();
  const generator = await openCycleGenerator(handle, await fixtureRendererPackage(), outputStore);
  expect(generator).not.toHaveProperty('buildId');
  expect(generator.outputs()).toContainEqual(expect.objectContaining({
    file: 'index.html',
    mime: 'text/html',
    kind: 'page',
    title: 'Home',
    pageKind: 'narrative',
  }));
  expect(generator.outputs()).toContainEqual(expect.objectContaining({
    file: 'assets/app.js',
    mime: 'text/javascript',
    kind: 'asset',
  }));
  const app = await generator.render('assets/app.js');
  expect(new TextDecoder().decode((await outputStore.get(app))!)).toContain('classList.add');
  const rendered = await generator.render('index.html');
  expect(rendered.mediaType).toBe('text/html');
  expect(new TextDecoder().decode((await outputStore.get(rendered))!)).toContain('<!doctype html>');
});

test('renderer-package and authored paths collide while the catalog is closing', async () => {
  const appAsset: ArtifactKey = {
    kind: 'asset', namespace: { kind: 'authored' }, path: 'assets/app.js',
  };
  const handle = await v2Handle(payloads(), [
    appAsset,
    assetKey,
    CYCLE_SEMANTIC_CONFIG_ARTIFACT,
    CYCLE_SEMANTIC_NAVIGATION_ARTIFACT,
    CYCLE_SEMANTIC_RESOURCES_ARTIFACT,
    CYCLE_SEMANTIC_TERMINOLOGY_ARTIFACT,
  ], [{ key: appAsset, bytes: encoder.encode('authored'), mediaType: 'text/javascript' }]);
  await expect(openFixtureGenerator(handle)).rejects.toThrow("output collision at 'assets/app.js'");
});

test('v2 rejects missing, extra, and non-authored render-plan roots', async () => {
  const missing = await v2Handle(payloads(), [
    assetKey,
    CYCLE_SEMANTIC_CONFIG_ARTIFACT,
    CYCLE_SEMANTIC_NAVIGATION_ARTIFACT,
    CYCLE_SEMANTIC_RESOURCES_ARTIFACT,
  ]);
  await expect(openFixtureGenerator(missing)).rejects.toThrow('missing required root');

  const extraKey: ArtifactKey = { kind: 'data', namespace: 'cycle.semantic/v1', name: 'extra.json' };
  const extraFixture = await v2Handle(payloads(), [
    assetKey,
    CYCLE_SEMANTIC_CONFIG_ARTIFACT,
    extraKey,
    CYCLE_SEMANTIC_NAVIGATION_ARTIFACT,
    CYCLE_SEMANTIC_RESOURCES_ARTIFACT,
    CYCLE_SEMANTIC_TERMINOLOGY_ARTIFACT,
  ], [jsonArtifact(extraKey, {})]);
  await expect(openFixtureGenerator(extraFixture)).rejects.toThrow('unexpected required root');

  const generatedAsset: ArtifactKey = {
    kind: 'asset', namespace: { kind: 'generated' }, path: 'generated.svg',
  };
  const wrongAsset = await v2Handle(payloads(), [
    generatedAsset,
    CYCLE_SEMANTIC_CONFIG_ARTIFACT,
    CYCLE_SEMANTIC_NAVIGATION_ARTIFACT,
    CYCLE_SEMANTIC_RESOURCES_ARTIFACT,
    CYCLE_SEMANTIC_TERMINOLOGY_ARTIFACT,
  ], [{ key: generatedAsset, bytes: encoder.encode('x'), mediaType: 'image/svg+xml' }]);
  await expect(openFixtureGenerator(wrongAsset)).rejects.toThrow('unexpected required root');

  const omittedAsset: ArtifactKey = {
    kind: 'asset', namespace: { kind: 'authored' }, path: 'images/omitted.svg',
  };
  const outsidePlan = await v2Handle(payloads(), undefined, [
    { key: omittedAsset, bytes: encoder.encode('omitted'), mediaType: 'image/svg+xml' },
  ]);
  await expect(openFixtureGenerator(outsidePlan)).rejects.toThrow('authored asset is outside the render plan');
});

test('v2 guide identity selects the primary guide while retaining ImplementationGuide examples', async () => {
  const values = payloads();
  values.resources.resources.push({
    key: { resourceType: 'ImplementationGuide', id: 'example-guide' },
    resource: {
      resourceType: 'ImplementationGuide',
      id: 'example-guide',
      packageId: 'example.guide',
      status: 'draft',
    },
  });
  const site = await CycleSiteBuild.fromClosedBuild(await v2Handle(values));
  const guides = site.resources('ImplementationGuide');
  expect(guides).toHaveLength(2);
  expect(guides.map((resource) => [resource.id, resource.page, resource.url])).toEqual([
    ['example-guide', 'ImplementationGuide-example-guide.html', null],
    ['fixture.ig', 'index.html', 'https://example.org/ig/ImplementationGuide/fixture.ig'],
  ]);
  expect(site.ig().id).toBe('fixture');
  const renderer = new CycleSiteRenderer(site, { content: { renderLiquid: (source: string) => source } });
  expect(renderer.outputs()).toContainEqual(expect.objectContaining({
    file: 'ImplementationGuide-example-guide.html',
    title: 'example-guide',
    pageKind: 'generic',
    subject: { resourceType: 'ImplementationGuide', id: 'example-guide' },
    subjectPage: 'primary',
  }));
  expect(String(renderer.render('ImplementationGuide-example-guide.html').content)).toContain('example-guide');
  expect(renderer.render('ImplementationGuide-fixture.ig.json')).toEqual({
    file: 'ImplementationGuide-fixture.ig.json',
    content: JSON.stringify(values.resources.resources[0].resource, null, 2),
    mime: 'application/fhir+json',
  });
});

test('target mismatch never falls back by artifact presence', async () => {
  const wrong = await v2Handle(payloads(), undefined, [], {
    renderer: { id: 'cycle-site', version: '1' },
    mode: 'external_builder',
    fhirVersion: '4.0.1',
    parameters: { contract: 'cycle-site/v2' },
  });
  await expect(openFixtureGenerator(wrong)).rejects.toThrow('does not implement cycle-site/v2');
});

test('v2 strict decoders reject schema drift and corrupt semantic references', async () => {
  const unknownField = payloads();
  (unknownField.config as unknown as Record<string, unknown>).extra = true;
  await expect(openFixtureGenerator(await v2Handle(unknownField))).rejects.toThrow('unexpected field extra');

  const wrongSchema = payloads();
  (wrongSchema.navigation as unknown as Record<string, unknown>).schema = 'cycle.semantic.navigation/v1';
  await expect(openFixtureGenerator(await v2Handle(wrongSchema))).rejects.toThrow('Unsupported Cycle navigation schema');

  const missingGuide = payloads();
  missingGuide.resources.guide.implementationGuide.id = 'missing';
  await expect(openFixtureGenerator(await v2Handle(missingGuide))).rejects.toThrow(
    'must reference an existing ImplementationGuide resource',
  );

  const missingValueSet = payloads();
  missingValueSet.terminology.expansions[0].valueSet.id = 'missing';
  await expect(openFixtureGenerator(await v2Handle(missingValueSet))).rejects.toThrow(
    'references missing ValueSet/missing',
  );
});

test('v2 requires media types and isolates one requested asset body', async () => {
  const noMime = await closedHandle({
    renderer: { id: 'cycle-site', version: '2' }, mode: 'external_builder', fhirVersion: '4.0.1',
    parameters: { contract: 'cycle-site/v2' },
  }, [
    jsonArtifact(CYCLE_SEMANTIC_RESOURCES_ARTIFACT, payloads().resources),
    jsonArtifact(CYCLE_SEMANTIC_TERMINOLOGY_ARTIFACT, payloads().terminology),
    jsonArtifact(CYCLE_SEMANTIC_NAVIGATION_ARTIFACT, payloads().navigation),
    jsonArtifact(CYCLE_SEMANTIC_CONFIG_ARTIFACT, payloads().config),
    { key: assetKey, bytes: encoder.encode('asset') },
  ], [
    assetKey,
    CYCLE_SEMANTIC_CONFIG_ARTIFACT,
    CYCLE_SEMANTIC_NAVIGATION_ARTIFACT,
    CYCLE_SEMANTIC_RESOURCES_ARTIFACT,
    CYCLE_SEMANTIC_TERMINOLOGY_ARTIFACT,
  ]);
  await expect(openFixtureGenerator(noMime)).rejects.toThrow('must have a media type');

  const site = await CycleSiteBuild.fromClosedBuild(await v2Handle());
  const first = site.asset('images/fixture.svg')!.bytes;
  first[0] = 0;
  expect(bytesOf(site.asset('images/fixture.svg')!)).toBe('<svg>fixture</svg>');
  expect(site.asset('missing')).toBeNull();
});

test('decoded resource ownership is deeply immutable', async () => {
  const site = await CycleSiteBuild.fromClosedBuild(await v2Handle());
  const profile = site.resources('StructureDefinition')[0];
  expect(Object.isFrozen(profile)).toBeTrue();
  expect(Object.isFrozen(profile.resource)).toBeTrue();
  expect(Object.isFrozen(profile.resource.differential)).toBeTrue();
  expect(() => { profile.resource.title = 'mutated'; }).toThrow();
  expect(site.resources('StructureDefinition')[0].title).toBe('Fixture profile');
});
