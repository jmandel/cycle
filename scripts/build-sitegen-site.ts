#!/usr/bin/env bun
/**
 * build-sitegen-site.ts — the single local/CI entry point for the site-gen site.
 *
 * Lets the IG Publisher do FHIR work (validation, snapshots, terminology, and
 * output/package.db), then site-gen owns final rendering, then this script —
 * the project-specific wrapper — injects the IG-specific extras (viewers, sample
 * SHL, skill.zip, CNAME) into the otherwise-complete site-gen/out and runs a
 * final whole-site link check.
 *
 * Pages deploys site-gen/out (the root static site, not the Publisher /en/ shell).
 */
import { mkdir, readdir, cp, rm, writeFile, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { viewerBuildEnv, viewerOutput, viewerVariants } from './viewer-variants.ts';
import { checkInternalLinks } from '../site-gen/core/link-check.ts';
import { project } from '../site-gen/project/cycle.ts';

const root = `${import.meta.dir}/..`;
const OUT = `${root}/site-gen/out`;
const SITE_DB = `${root}/temp/site-gen/site.db`;
const SAMPLE_SHL_DIR = `${root}/temp/site-gen/sample-shl`;
const exampleDir = `${root}/input/resources`;
const exampleOut = `${root}/input/resources/Bundle-period-tracking-longitudinal-example.json`;
const publisherJar = `${root}/input-cache/publisher.jar`;
const viewerBase = Bun.env.VIEWER_BASE || `https://${project.cname}/view`;
const demoFiles = ['example.jwe', 'shlink.txt', '_shlink-local.txt', '_shlink-local-ig.txt'];
const qaAssetExtensions = new Set(['.css', '.gif', '.ico', '.js', '.png', '.svg']);

async function step(name: string, cmd: string[], env: Record<string, string> = {}) {
  console.log(`\n-- ${name} --`);
  const proc = Bun.spawn(cmd, { cwd: root, env: { ...Bun.env, ...env }, stdout: 'inherit', stderr: 'inherit' });
  if ((await proc.exited) !== 0) throw new Error(`${name} failed`);
}
async function requireTool(name: string, cmd: string[], hint: string) {
  try { await step(`check ${name}`, cmd); }
  catch (e) { throw new Error(`${name} is required. ${hint}\n${e instanceof Error ? e.message : e}`); }
}
async function mirrorDemoAssets(srcDir: string, destDirs: string[]) {
  for (const d of destDirs) for (const f of demoFiles) await cp(join(srcDir, f), join(d, f), { force: true });
}
function rootQaSupportAsset(ref: string) {
  const path = ref.split(/[?#]/)[0];
  if (!path || path.startsWith('#') || path.includes('/')) return undefined;
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return undefined;
  const dot = path.lastIndexOf('.');
  if (dot < 0 || !qaAssetExtensions.has(path.slice(dot).toLowerCase())) return undefined;
  return path;
}
async function copyPublisherQaArtifacts() {
  const outputDir = join(root, 'output');
  const entries = await readdir(outputDir, { withFileTypes: true });
  const rootFiles = new Set(entries.filter((e) => e.isFile()).map((e) => e.name));
  const names = new Set([...rootFiles].filter((name) => name.startsWith('qa') || name === 'fragment-usage-analysis.csv'));

  for (const name of [...names]) {
    if (!name.endsWith('.html')) continue;
    const html = await readFile(join(outputDir, name), 'utf8');
    for (const match of html.matchAll(/\b(?:href|src)=["']([^"']+)["']/g)) {
      const asset = rootQaSupportAsset(match[1]);
      if (asset && rootFiles.has(asset)) names.add(asset);
    }
  }

  for (const name of [...names].sort()) await cp(join(outputDir, name), join(OUT, name), { force: true });
  console.log(`Copied ${names.size} Publisher QA artifacts/support files -> ${relative(root, OUT)}/`);
}
async function writeSampleViewerInclude(shlinkFile: string) {
  const link = (await readFile(shlinkFile, 'utf8')).trim();
  const idx = link.indexOf('shlink:/');
  if (idx < 0) throw new Error(`${shlinkFile} does not contain a shlink:/ payload`);
  const fragment = `#${link.slice(idx)}`;
  const md = `[Reference viewer](view.html${fragment}) · [Layer 0 summary viewer](view2.html${fragment}) · [Bleeding-first viewer](view3.html${fragment})\n`;
  await mkdir(join(root, 'input/includes'), { recursive: true });
  await writeFile(join(root, 'input/includes/sample-viewer-links.md'), md);
}
async function walk(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p, base));
    else out.push(relative(base, p));
  }
  return out;
}
async function writeCompatibility404() {
  await writeFile(join(OUT, '404.html'), `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Not found</title>
<script>
const path = location.pathname;
const next = path === '/en' ? '/' : path.startsWith('/en/') ? path.slice(3) : null;
if (next) location.replace(next + location.search + location.hash);
</script>
</head>
<body>
<h1>Not found</h1>
<p>If this was an old /en/ URL, remove /en from the path.</p>
</body>
</html>
`);
  console.log('Wrote 404.html compatibility redirect for old /en/ URLs');
}

// 1–3. FHIR inputs, SUSHI, integrity checks
await requireTool('Graphviz dot', ['dot', '-V'], 'Install graphviz so PlantUML diagrams render.');
await requireTool('zip', ['zip', '-v'], 'Install zip so the agent skill package can be built.');
await rm(exampleDir, { recursive: true, force: true });
await mkdir(exampleDir, { recursive: true });
await step('generate build examples', ['bun', 'scripts/gen-example.ts'], { EXAMPLE_OUT: exampleOut });
await rm(SAMPLE_SHL_DIR, { recursive: true, force: true });
await step('package sample SMART Health Link', ['bun', 'scripts/gen-shl.ts'], {
  BUNDLE_FILE: exampleOut, SHL_OUTDIR: SAMPLE_SHL_DIR, VIEWER_BASE: viewerBase,
});
await writeSampleViewerInclude(`${SAMPLE_SHL_DIR}/shlink.txt`);
await step('compile FSH', ['./_sushi.sh']);
await step('integrity checks', ['bun', 'scripts/check-mvp.ts'], { BUNDLE_FILE: exampleOut });

// 4–5. IG Publisher → output/package.db (validation + the DB we consume)
if (!(await Bun.file(publisherJar).exists())) await step('download IG Publisher', ['./_updatePublisher.sh']);
await rm(`${root}/output`, { recursive: true, force: true });
await rm(`${root}/temp/pages`, { recursive: true, force: true });
await step('run IG Publisher', ['./_genonce.sh']);

await step('ingest package.db', ['bun', 'site-gen/ingest.ts'], {
  PKG_DB: `${root}/output/package.db`,
  SITE_DB,
  SITE_LIQUID_ASSET_DIRS: `${root}/input/includes`,
});
await step('render site-gen site', ['bun', 'site-gen/build.tsx'], {
  SITE_DB,
  OUT_DIR: OUT,
  // This orchestrator owns the canonical destination and deliberately retires
  // its previous site only after the renderer has staged and checked a new one.
  SITE_GEN_REPLACE_OUTPUT: '1',
});

// 8–11. inject project-specific artifacts into the completed site (IG-specific)
for (const variant of viewerVariants) {
  const o = viewerOutput(variant, OUT);
  await rm(o.assets, { recursive: true, force: true });
  await rm(o.page, { force: true });
  await step(`bundle ${variant.label}`, ['bun', 'scripts/build-viewer.ts'], viewerBuildEnv(variant, OUT));
}
const [primary, ...others] = viewerVariants.map((variant) => ({ variant, output: viewerOutput(variant, OUT) }));
await mirrorDemoAssets(SAMPLE_SHL_DIR, [primary.output.assets]);
await mirrorDemoAssets(primary.output.assets, others.map((v) => v.output.assets));
await step('package agent assets (skill.zip)', ['bun', 'scripts/build-agent-assets.ts'], { AGENT_OUTDIR: OUT });
await cp(join(root, project.packageList), join(OUT, 'package-list.json'), { force: true });
const cname = Bun.env.PAGES_CNAME || project.cname;
await writeFile(join(OUT, 'CNAME'), `${cname}\n`);
await writeCompatibility404();

// 12. final whole-site link check (strict: every internal href/src must now exist)
const files = (await walk(OUT)).filter((f) => f.endsWith('.html'));
const emitted = new Set(await walk(OUT));
const broken = checkInternalLinks({ outDir: OUT, emitted, files, isExternalLink: () => false });
if (broken.length) {
  console.error(`\n✗ ${broken.length} broken links in final output:`);
  for (const b of [...new Set(broken)].slice(0, 40)) console.error('  ' + b);
  process.exit(1);
}
await copyPublisherQaArtifacts();
console.log(`\n✓ site build complete: ${relative(root, OUT)}/ (${files.length} pages, links OK; Publisher QA at qa.html)`);
