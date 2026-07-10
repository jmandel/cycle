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
import { JsonSiteBuildView, type SiteDbRows } from './json-site-build';
import { openCycleSiteBuild, openCycleSiteBuildPayload } from './open-site-build';
import { CycleSiteRenderer } from './renderer';
import {
  SemanticSiteBuildView,
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
  CYCLE_SITE_DB_ARTIFACT,
} from './site-build';

const encoder = new TextEncoder();

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
    schemaVersion: 'site-build/v1',
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
      schema: 'cycle.semantic.navigation/v1',
      pages: [{
        nameUrl: 'index.html',
        title: 'Home',
        generation: 'markdown',
        body: '# Home\n\nFixture.',
        children: [{
          nameUrl: 'guide.html',
          title: 'Guide',
          generation: 'markdown',
          body: '# Guide',
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

function legacyRows(): SiteDbRows {
  const values = payloads();
  const metadata = {
    path: 'http://hl7.org/fhir/R4/', canonical: 'https://example.org/ig', igId: 'fixture.ig',
    igName: 'FixtureIG', packageId: 'fixture.ig', igVer: '1.0.0', errorCount: '0',
    version: '4.0.1', releaseLabel: 'ci-build', revision: 'abc123',
    versionFull: '4.0.1-abc123', toolingVersion: 'site-gen.publisher', toolingRevision: '0',
    toolingVersionFull: 'site-gen.publisher experiment', genDate: '2023-11-14T22:13:20Z',
    genDay: '20231114', gitstatus: 'main',
  };
  const semanticRows = values.resources.resources.map((entry, index) => {
    const resource = entry.resource as Record<string, any>;
    const canonical = typeof resource.url === 'string' && resource.url.length > 0;
    const type = entry.key.resourceType;
    const id = type === 'ImplementationGuide' ? 'fixture.ig' : entry.key.id;
    return {
      Key: index + 1, Type: type, Custom: 0, Id: id,
      Web: type === 'ImplementationGuide' ? 'index.html' : `${type}-${id}.html`,
      Url: type === 'ImplementationGuide'
        ? 'https://example.org/ig/ImplementationGuide/fixture.ig'
        : resource.url ?? null,
      Version: canonical ? resource.version ?? null : null,
      Status: resource.status ?? null,
      Date: canonical ? resource.date ?? null : null,
      Name: canonical ? resource.name ?? null : entry.publication?.displayName ?? resource.name ?? resource.title ?? entry.key.id,
      Title: resource.title ?? null,
      Experimental: typeof resource.experimental === 'boolean' ? String(resource.experimental) : null,
      Realm: null,
      Description: canonical ? resource.description ?? null : entry.publication?.description ?? resource.description ?? null,
      Purpose: resource.purpose ?? null,
      Copyright: resource.copyright ?? null,
      CopyrightLabel: resource.copyrightLabel ?? null,
      derivation: resource.derivation ?? null,
      standardStatus: entry.publication?.standardStatus ?? null,
      kind: type === 'StructureDefinition' ? resource.kind ?? null : null,
      sdType: type === 'StructureDefinition' ? resource.type ?? null : null,
      base: type === 'StructureDefinition' ? entry.publication?.baseDefinition ?? resource.baseDefinition ?? null : null,
      content: resource.content ?? null,
      supplements: resource.supplements ?? null,
      Json: JSON.stringify(resource),
    };
  });
  return {
    metadata: Object.entries(metadata).map(([Name, Value], index) => ({ Key: index + 1, Name, Value })),
    resources: semanticRows,
    concepts: [
      { Key: 1, ResourceKey: 2, ParentKey: null, Code: 'parent', Display: 'Parent', Definition: 'Parent concept' },
      { Key: 2, ResourceKey: 2, ParentKey: 1, Code: 'child', Display: 'Child', Definition: 'Child concept' },
    ],
    valueSetCodes: [
      { Key: 1, ResourceKey: 4, ValueSetUri: 'https://example.org/ig/ValueSet/fixture-values', ValueSetVersion: '1.0.0', System: 'https://example.org/ig/CodeSystem/fixture-codes', Code: 'child', Display: 'Child' },
      { Key: 2, ResourceKey: 4, ValueSetUri: 'https://example.org/ig/ValueSet/fixture-values', ValueSetVersion: '1.0.0', System: 'https://example.org/ig/CodeSystem/fixture-codes', Code: 'parent', Display: 'Parent' },
    ],
    pages: [
      { Slug: 'index', NameUrl: 'index.html', Title: 'Home', Generation: 'markdown', Ord: 0, Depth: 0, Body: '# Home\n\nFixture.' },
      { Slug: 'guide', NameUrl: 'guide.html', Title: 'Guide', Generation: 'markdown', Ord: 1, Depth: 1, Body: '# Guide' },
    ],
    menu: [
      { Id: 1, ParentId: null, Ord: 0, Depth: 0, Path: 'Home', Label: 'Home', Href: 'index.html', Kind: 'link' },
      { Id: 2, ParentId: null, Ord: 1, Depth: 0, Path: 'Documentation', Label: 'Documentation', Href: null, Kind: 'group' },
      { Id: 3, ParentId: 2, Ord: 2, Depth: 1, Path: 'Documentation/Guide', Label: 'Guide', Href: 'guide.html', Kind: 'link' },
    ],
    siteConfig: [{ Name: 'sushi-config', Json: JSON.stringify(values.config.sushiConfig) }],
    assets: [{ Name: 'images/fixture.svg', Mime: 'image/svg+xml', Content: btoa('<svg>fixture</svg>') }],
  };
}

async function v1Handle(): Promise<ClosedBuildHandle> {
  return closedHandle({
    renderer: { id: 'cycle-site', version: '1' },
    mode: 'external_builder',
    fhirVersion: '4.0.1',
    parameters: { contract: 'cycle-site/v1' },
  }, [jsonArtifact(CYCLE_SITE_DB_ARTIFACT, legacyRows())], [CYCLE_SITE_DB_ARTIFACT]);
}

function bytesOf(asset: { Content: string | Uint8Array }): string {
  return typeof asset.Content === 'string' ? asset.Content : new TextDecoder().decode(asset.Content);
}

function encoded(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

test('cycle-site/v2 preloads split semantic roots and synthesizes the synchronous view', async () => {
  const view = await openCycleSiteBuild(await v2Handle());
  expect(view).toBeInstanceOf(SemanticSiteBuildView);
  expect(view.metadata()).toEqual({
    path: 'http://hl7.org/fhir/R4/', canonical: 'https://example.org/ig', igId: 'fixture.ig',
    igName: 'FixtureIG', packageId: 'fixture.ig', igVer: '1.0.0', errorCount: '0',
    version: '4.0.1', releaseLabel: 'ci-build', revision: 'abc123', versionFull: '4.0.1-abc123',
    toolingVersion: 'site-gen.publisher', toolingRevision: '0',
    toolingVersionFull: 'site-gen.publisher experiment', genDate: '2023-11-14T22:13:20Z',
    genDay: '20231114', gitstatus: 'main',
  });
  const profile = view.resources('StructureDefinition')[0];
  expect(profile.Key).toBe(3);
  expect(profile.base).toBe('http://hl7.org/fhir/StructureDefinition/Observation|4.0.1');
  expect(profile.standardStatus).toBe('trial-use');
  expect(Object.keys(view.parse(profile)).slice(0, 6)).toEqual([
    'resourceType', 'id', 'zeta', 'alpha', 'url', 'name',
  ]);
  expect(JSON.stringify(view.parse(profile), null, 2)).toStartWith(
    '{\n  "resourceType": "StructureDefinition",\n  "id": "fixture-profile",\n  "zeta":',
  );
  expect(view.valueSetCodes('https://example.org/ig/ValueSet/fixture-values')).toEqual([
    { system: 'https://example.org/ig/CodeSystem/fixture-codes', code: 'child', display: 'Child' },
    { system: 'https://example.org/ig/CodeSystem/fixture-codes', code: 'parent', display: 'Parent' },
  ]);
  expect(view.concepts(2)).toEqual([
    { Key: 1, ParentKey: null, Code: 'parent', Display: 'Parent', Definition: 'Parent concept' },
    { Key: 2, ParentKey: 1, Code: 'child', Display: 'Child', Definition: 'Child concept' },
  ]);
  expect(view.pages()).toEqual(legacyRows().pages);
  expect(view.menu()).toEqual(legacyRows().menu);
  expect(view.siteConfig('sushi-config')).toEqual({ id: 'fixture.ig', canonical: 'https://example.org/ig' });
  expect(view.siteConfig('other')).toBeNull();
  expect(view.textAsset('images/fixture.svg')).toBe('<svg>fixture</svg>');
  expect(bytesOf(view.assets()[0])).toBe('<svg>fixture</svg>');
  expect(view.ig().contact[0].telecom).toEqual(['https://example.org']);
});

test('v1 and v2 dispatch explicitly and expose equivalent logical views', async () => {
  const legacy = await openCycleSiteBuild(await v1Handle());
  const semantic = await openCycleSiteBuild(await v2Handle());
  expect(legacy).toBeInstanceOf(JsonSiteBuildView);
  expect(semantic).toBeInstanceOf(SemanticSiteBuildView);
  expect(semantic.metadata()).toEqual(legacy.metadata());
  expect(semantic.resources()).toEqual(legacy.resources());
  expect(semantic.pages()).toEqual(legacy.pages());
  expect(semantic.menu()).toEqual(legacy.menu());
  expect(semantic.valueSetCodes('https://example.org/ig/ValueSet/fixture-values'))
    .toEqual(legacy.valueSetCodes('https://example.org/ig/ValueSet/fixture-values'));
  expect(semantic.concepts(2)).toEqual(legacy.concepts(2));
  expect(semantic.siteConfig('sushi-config')).toEqual(legacy.siteConfig('sushi-config'));
  expect(semantic.ig()).toEqual(legacy.ig());
  expect(semantic.assets().map((asset) => [asset.Name, asset.Mime, bytesOf(asset)]))
    .toEqual(legacy.assets().map((asset) => [asset.Name, asset.Mime, bytesOf(asset)]));
});

test('the unchanged synchronous renderer emits byte-identical v1 and v2 outputs', async () => {
  const legacyView = await openCycleSiteBuild(await v1Handle());
  const semanticView = await openCycleSiteBuild(await v2Handle());
  const content = { renderLiquid: (source: string) => source };
  const legacy = new CycleSiteRenderer(legacyView, { content });
  const semantic = new CycleSiteRenderer(semanticView, { content });
  expect(semantic.listPages()).toEqual(legacy.listPages());
  expect(semantic.listOutputs()).toEqual(legacy.listOutputs());
  for (const descriptor of legacy.listOutputs()) {
    const left = legacy.renderOutput(descriptor.file);
    const right = semantic.renderOutput(descriptor.file);
    expect(right.mime).toBe(left.mime);
    const leftBytes = typeof left.content === 'string' ? encoder.encode(left.content) : left.content;
    const rightBytes = typeof right.content === 'string' ? encoder.encode(right.content) : right.content;
    expect(rightBytes).toEqual(leftBytes);
  }
});

test('generic digest transport and the legacy one-object transport share the dispatcher', async () => {
  const values = payloads();
  const handle = await v2Handle(values);
  const bodies = [
    JSON.stringify(values.resources),
    JSON.stringify(values.terminology),
    JSON.stringify(values.navigation),
    JSON.stringify(values.config),
    '<svg>fixture</svg>',
  ].map((source) => encoder.encode(source));
  const objects = Object.fromEntries(bodies.map((bytes) => [content(bytes).sha256, encoded(bytes)]));
  const opened = await openCycleSiteBuildPayload({
    transportVersion: 'site-build-cas/v1',
    siteBuild: handle.manifest,
    objects,
  });
  expect(opened.view).toBeInstanceOf(SemanticSiteBuildView);
  expect(opened.build.manifest.buildId).toBe(handle.manifest.buildId);

  const rows = JSON.stringify(legacyRows());
  const legacy = await v1Handle();
  const openedLegacy = await openCycleSiteBuildPayload({ siteBuild: legacy.manifest, siteDbJson: rows });
  expect(openedLegacy.view).toBeInstanceOf(JsonSiteBuildView);

  await expect(openCycleSiteBuildPayload({
    transportVersion: 'site-build-cas/v1',
    siteBuild: handle.manifest,
    objects: { ['0'.repeat(64)]: '*' },
  })).rejects.toThrow('canonical standard base64');
});

test('v2 rejects missing, extra, and non-authored render-plan roots', async () => {
  const missing = await v2Handle(payloads(), [
    assetKey,
    CYCLE_SEMANTIC_CONFIG_ARTIFACT,
    CYCLE_SEMANTIC_NAVIGATION_ARTIFACT,
    CYCLE_SEMANTIC_RESOURCES_ARTIFACT,
  ]);
  await expect(openCycleSiteBuild(missing)).rejects.toThrow('missing required root');

  const extraKey: ArtifactKey = { kind: 'data', namespace: 'cycle.semantic/v1', name: 'extra.json' };
  const extraFixture = await v2Handle(payloads(), [
    assetKey,
    CYCLE_SEMANTIC_CONFIG_ARTIFACT,
    extraKey,
    CYCLE_SEMANTIC_NAVIGATION_ARTIFACT,
    CYCLE_SEMANTIC_RESOURCES_ARTIFACT,
    CYCLE_SEMANTIC_TERMINOLOGY_ARTIFACT,
  ], [jsonArtifact(extraKey, {})]);
  await expect(openCycleSiteBuild(extraFixture)).rejects.toThrow('unexpected required root');

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
  await expect(openCycleSiteBuild(wrongAsset)).rejects.toThrow('unexpected required root');
});

test('target mismatch never falls back by artifact presence', async () => {
  const wrong = await v2Handle(payloads(), undefined, [], {
    renderer: { id: 'cycle-site', version: '1' },
    mode: 'external_builder',
    fhirVersion: '4.0.1',
    parameters: { contract: 'cycle-site/v2' },
  });
  await expect(openCycleSiteBuild(wrong)).rejects.toThrow('Unsupported closed Cycle target');
});

test('v2 strict decoders reject schema drift and corrupt semantic references', async () => {
  const unknownField = payloads();
  (unknownField.config as unknown as Record<string, unknown>).extra = true;
  await expect(openCycleSiteBuild(await v2Handle(unknownField))).rejects.toThrow('unexpected field extra');

  const wrongSchema = payloads();
  (wrongSchema.navigation as unknown as Record<string, unknown>).schema = 'cycle.semantic.navigation/v2';
  await expect(openCycleSiteBuild(await v2Handle(wrongSchema))).rejects.toThrow('Unsupported Cycle navigation schema');

  const missingGuide = payloads();
  missingGuide.resources.guide.implementationGuide.id = 'missing';
  await expect(openCycleSiteBuild(await v2Handle(missingGuide))).rejects.toThrow(
    'must reference the one ImplementationGuide resource',
  );

  const missingValueSet = payloads();
  missingValueSet.terminology.expansions[0].valueSet.id = 'missing';
  await expect(openCycleSiteBuild(await v2Handle(missingValueSet))).rejects.toThrow(
    'references missing ValueSet/missing',
  );
});

test('v2 requires media types for raw asset roots and keeps returned bytes isolated', async () => {
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
  await expect(openCycleSiteBuild(noMime)).rejects.toThrow('must have a media type');

  const view = await openCycleSiteBuild(await v2Handle());
  const first = view.assets()[0].Content as Uint8Array;
  first[0] = 0;
  expect(bytesOf(view.assets()[0])).toBe('<svg>fixture</svg>');
});
