import { createHash } from 'node:crypto';
import { expect, test } from 'bun:test';
import { SqliteSiteBuildView } from './db';
import { CycleSiteRenderer } from './renderer';
import { createCycleContentRenderer } from './content';
import { includes } from '../project/includes';
import { project } from '../project';

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
const siteBuildView = new SqliteSiteBuildView(process.env.SITE_DB || 'temp/site-gen/site.db');
const renderer = new CycleSiteRenderer(siteBuildView, {
  // Representative parity pages are resource-backed and do not invoke Liquid.
  content: { renderLiquid: (source) => source },
  includes,
  project,
});

test('closed fixture page manifest is deterministic', () => {
  const pages = renderer.listPages();
  expect(pages).toHaveLength(34);
  expect(sha256(JSON.stringify(pages))).toBe('3a4a1ad83cd152b38c78743a50564f2ca1c46c743da622ef2645d9f86c5d1c17');
  expect(pages.map((page) => page.file)).toContain('toc.html');
  expect(pages.map((page) => page.file)).toContain('StructureDefinition-menstrual-bleeding-fact-definitions.html');
});

test('generator output manifest is complete, safe, and collision-free', () => {
  const outputs = renderer.listOutputs();
  expect(new Set(outputs.map((output) => output.file)).size).toBe(outputs.length);
  expect(outputs.find((output) => output.file === 'llms.txt')?.kind).toBe('auxiliary');
  expect(outputs.find((output) => output.file === 'index.md')?.owner).toBe('index.html');
  expect(outputs.find((output) => output.file === 'ValueSet-menstrual-flow.json')?.owner)
    .toBe('ValueSet-menstrual-flow.html');
});

test('representative SSR pages retain the native renderer hashes', () => {
  const expected: Record<string, string> = {
    'artifacts.html': '3f1b35d167e4c6edd576308c037c828dc6897493a8a6fa89b6823fc1f032f522',
    'StructureDefinition-menstrual-bleeding-fact.html': '2b5b756c3000d3641048bf95376dedafae35fccbc684e81e25098a553c6185be',
    'ValueSet-menstrual-flow.html': '9418b6f48713fbd4f1ee95fe345773b069ff57043b116d16762ffce468f092a6',
    'CodeSystem-cycle.html': '36fdbe2066d5b815af5783d5193b53c513350a623e770872e6b7d94b964411e5',
    'Bundle-period-tracking-longitudinal-example.html': 'ffc002d29d5dd9b32cd84abc81ff6207e1134739c8683edc647824fe76afa08d',
  };
  for (const [file, digest] of Object.entries(expected)) {
    expect(sha256(renderer.renderPage(file).html)).toBe(digest);
  }
});

test('resource outputs are explicit and content-addressable by the host', () => {
  const page = renderer.renderPage('ValueSet-menstrual-flow.html');
  expect(page.outputs.map((output) => output.file)).toEqual(['ValueSet-menstrual-flow.json']);
  expect(JSON.parse(String(page.outputs[0].content)).resourceType).toBe('ValueSet');
  const direct = renderer.renderOutput('ValueSet-menstrual-flow.json');
  expect(direct.mime).toBe('application/fhir+json');
  expect(JSON.parse(String(direct.content)).resourceType).toBe('ValueSet');
});

test('shared closed content renderer handles a narrative without host callbacks', () => {
  const complete = new CycleSiteRenderer(siteBuildView, {
    content: createCycleContentRenderer(),
    includes,
    project,
  });
  const page = complete.renderPage('index.html');
  expect(page.html.length).toBeGreaterThan(1_000);
  expect(page.html).toContain('<!doctype html>');
  expect(page.outputs.map((output) => output.file)).toContain('index.md');
  expect(complete.renderOutput('index.md').mime).toBe('text/markdown');
  expect(String(complete.renderOutput('llms.txt').content)).toContain('## Pages');
  expect(() => complete.renderOutput('absent.json')).toThrow("no output 'absent.json'");
});

test('page-name collisions fail before any host publishes output', () => {
  const collidingView = Object.create(siteBuildView) as SqliteSiteBuildView;
  collidingView.pages = () => [
    ...siteBuildView.pages(),
    { Slug: 'artifacts', Title: 'Shadow artifacts', Body: '# collision', Ord: 999 },
  ];
  const colliding = new CycleSiteRenderer(collidingView, {
    content: { renderLiquid: (source) => source },
    includes,
    project,
  });
  expect(() => colliding.listPages()).toThrow("output collision at 'artifacts.html'");
});
