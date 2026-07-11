import { expect, test } from 'bun:test';
import { CycleSiteRenderer } from './renderer';
import { createCycleContentRenderer } from './content';
import type { CycleResource, CycleSiteBuild } from './semantic-site-build';
import { includes } from '../project/includes';
import { project } from '../project';

const resources = [
  {
    resourceType: 'ImplementationGuide', id: 'fixture', packageId: 'fixture.ig',
    url: 'https://example.org/ImplementationGuide/fixture', status: 'draft',
    fhirVersion: ['4.0.1'], definition: { resource: [] }, contact: [],
  },
  {
    resourceType: 'StructureDefinition', id: 'fixture-profile',
    url: 'https://example.org/StructureDefinition/fixture-profile', status: 'draft',
    name: 'FixtureProfile', title: 'Fixture Profile', kind: 'resource', type: 'Observation',
    derivation: 'constraint', differential: { element: [{ id: 'Observation', path: 'Observation' }] },
    snapshot: { element: [{ id: 'Observation', path: 'Observation' }] },
  },
  {
    resourceType: 'ValueSet', id: 'fixture-values',
    url: 'https://example.org/ValueSet/fixture-values', status: 'active', title: 'Fixture Values',
  },
  {
    resourceType: 'CodeSystem', id: 'fixture-codes',
    url: 'https://example.org/CodeSystem/fixture-codes', status: 'active', title: 'Fixture Codes',
    content: 'complete', concept: [{ code: 'one', display: 'One' }],
  },
  { resourceType: 'Bundle', id: 'fixture-example', type: 'collection', entry: [] },
] as Array<Record<string, any>>;

const siteResources: CycleResource[] = resources.map((resource) => ({
  key: { resourceType: resource.resourceType, id: resource.id },
  resource,
  type: resource.resourceType,
  id: resource.resourceType === 'ImplementationGuide' ? 'fixture.ig' : resource.id,
  page: resource.resourceType === 'ImplementationGuide'
    ? 'index.html'
    : `${resource.resourceType}-${resource.id}.html`,
  url: resource.url || null,
  version: resource.version || null,
  name: resource.name || null,
  title: resource.title || null,
  status: resource.status || null,
  description: resource.description || null,
  kind: resource.kind || null,
  sdType: resource.type || null,
  derivation: resource.derivation || null,
  standardStatus: null,
  base: resource.baseDefinition || null,
  content: resource.content || null,
  supplements: null,
}));

const siteBuild: CycleSiteBuild = {
  metadata: () => ({ version: '4.0.1', packageId: 'fixture.ig', canonical: 'https://example.org' }),
  resources: (type?: string) => siteResources.filter((resource) => !type || resource.type === type),
  valueSetCodes: () => [{ system: 'https://example.org/CodeSystem/fixture-codes', code: 'one', display: 'One' }],
  concepts: () => [{ code: 'one', display: 'One', children: [] }],
  pages: () => [{
    slug: 'index', nameUrl: 'index.html', title: 'Home', generation: 'markdown', body: '# Home\n\nFixture.',
  }],
  menu: () => [{ label: 'Home', href: 'index.html', items: [] }],
  siteConfig: () => ({ id: 'fixture.ig' }),
  textAsset: () => null,
  assetCatalog: () => [{ path: 'images/fixture.svg', mediaType: 'image/svg+xml' }],
  asset: (path: string) => path === 'images/fixture.svg'
    ? { path, mediaType: 'image/svg+xml', bytes: new TextEncoder().encode('<svg/>') }
    : null,
  ig: () => structuredClone(resources[0]),
} as CycleSiteBuild;

const renderer = new CycleSiteRenderer(siteBuild, {
  content: { renderLiquid: (source) => source },
  includes,
  project,
});

test('closed renderer output catalog is deterministic, complete, safe, and collision-free', () => {
  const first = renderer.outputs();
  const second = renderer.outputs();
  expect(second).toEqual(first);
  expect(new Set(first.map((output) => output.file)).size).toBe(first.length);
  expect(first).toContainEqual(expect.objectContaining({ file: 'index.html', kind: 'page' }));
  expect(first).toContainEqual(expect.objectContaining({ file: 'index.md', owner: 'index.html' }));
  expect(first).toContainEqual(expect.objectContaining({ file: 'ValueSet-fixture-values.json', owner: 'ValueSet-fixture-values.html' }));
  expect(first).toContainEqual(expect.objectContaining({ file: 'images/fixture.svg', kind: 'asset' }));
});

test('direct output rendering returns page, resource, narrative, and asset bytes', () => {
  expect(renderer.render('index.html').content).toContain('<!doctype html>');
  expect(JSON.parse(String(renderer.render('ValueSet-fixture-values.json').content)).resourceType).toBe('ValueSet');
  expect(renderer.render('index.md')).toEqual({ file: 'index.md', content: '# Home\n\nFixture.', mime: 'text/markdown' });
  expect(renderer.render('images/fixture.svg').content).toEqual(new TextEncoder().encode('<svg/>'));
  expect(() => renderer.render('absent.json')).toThrow("no output 'absent.json'");
});

test('shared closed LiquidJS content renderer handles narrative without host callbacks', () => {
  const complete = new CycleSiteRenderer(siteBuild, {
    content: createCycleContentRenderer(),
    includes,
    project,
  });
  expect(complete.render('index.html').content).toContain('<!doctype html>');
  expect(String(complete.render('llms.txt').content)).toContain('## Pages');
});

test('page-name collisions fail before any host publishes output', () => {
  const collidingSite: CycleSiteBuild = {
    ...siteBuild,
    pages: () => [
      ...siteBuild.pages(),
      { slug: 'artifacts', nameUrl: 'artifacts.html', title: 'Shadow artifacts', generation: 'markdown', body: '# collision' },
    ],
  } as CycleSiteBuild;
  const colliding = new CycleSiteRenderer(collidingSite, {
    content: { renderLiquid: (source) => source },
    includes,
    project,
  });
  expect(() => colliding.outputs()).toThrow("output collision at 'artifacts.html'");
});

async function outputDigest(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer);
  return Buffer.from(digest).toString('hex');
}

test('rendering is repeatable and independent under A/B/A and B/A/B order', async () => {
  const a = 'index.html';
  const b = 'ValueSet-fixture-values.html';
  const baselineA = await outputDigest(renderer.render(a).content);
  const baselineB = await outputDigest(renderer.render(b).content);

  const aba = [a, b, a].map((file) => renderer.render(file).content);
  expect(await Promise.all(aba.map(outputDigest))).toEqual([baselineA, baselineB, baselineA]);

  const bab = [b, a, b].map((file) => renderer.render(file).content);
  expect(await Promise.all(bab.map(outputDigest))).toEqual([baselineB, baselineA, baselineB]);
});
