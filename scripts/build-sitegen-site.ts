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
import { readdir, cp, rm, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { viewerBuildEnv, viewerOutput, viewerVariants } from './viewer-variants.ts';
import { checkInternalLinks } from '../site-gen/core/link-check.ts';

const root = `${import.meta.dir}/..`;
const OUT = `${root}/site-gen/out`;
const SITE_DB = `${root}/temp/site-gen/site.db`;
const exampleOut = `${root}/input/resources/Bundle-period-tracking-longitudinal-example.json`;
const publisherJar = `${root}/input-cache/publisher.jar`;
const viewerBase = Bun.env.VIEWER_BASE || 'http://localhost:5525/view';
const demoFiles = ['example.jwe', 'shlink.txt', '_shlink-local.txt', '_shlink-local-ig.txt'];

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
async function walk(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p, base));
    else out.push(relative(base, p));
  }
  return out;
}

// 1–3. FHIR inputs, SUSHI, integrity checks
await requireTool('Graphviz dot', ['dot', '-V'], 'Install graphviz so PlantUML diagrams render.');
await requireTool('zip', ['zip', '-v'], 'Install zip so the agent skill package can be built.');
await step('generate build example Bundle', ['bun', 'scripts/gen-example.ts'], { EXAMPLE_OUT: exampleOut });
await step('compile FSH', ['./_sushi.sh']);
await step('integrity checks', ['bun', 'scripts/check-mvp.ts'], { BUNDLE_FILE: exampleOut });

// 4–5. IG Publisher → output/package.db (validation + the DB we consume)
if (!(await Bun.file(publisherJar).exists())) await step('download IG Publisher', ['./_updatePublisher.sh']);
await step('run IG Publisher', ['./_genonce.sh']);

// 6–7. site-gen: ingest the real package.db, then render the site
await step('ingest package.db', ['bun', 'site-gen/ingest.ts'], { PKG_DB: `${root}/output/package.db`, SITE_DB });
await step('render site-gen site', ['bun', 'site-gen/build.tsx'], { SITE_DB, OUT_DIR: OUT });

// 8–11. inject project-specific artifacts into the completed site (IG-specific)
for (const variant of viewerVariants) {
  const o = viewerOutput(variant, OUT);
  await rm(o.assets, { recursive: true, force: true });
  await rm(o.page, { force: true });
  await step(`bundle ${variant.label}`, ['bun', 'scripts/build-viewer.ts'], viewerBuildEnv(variant, OUT));
}
const [primary, ...others] = viewerVariants.map((variant) => ({ variant, output: viewerOutput(variant, OUT) }));
await step('package sample SMART Health Link', ['bun', 'scripts/gen-shl.ts'], {
  BUNDLE_FILE: exampleOut, SHL_OUTDIR: primary.output.assets, VIEWER_BASE: viewerBase,
});
await mirrorDemoAssets(primary.output.assets, others.map((v) => v.output.assets));
await step('package agent assets (skill.zip)', ['bun', 'scripts/build-agent-assets.ts'], { AGENT_OUTDIR: OUT });
const cname = Bun.env.PAGES_CNAME || 'cycle.fhir.me';
await writeFile(join(OUT, 'CNAME'), `${cname}\n`);

// 12. final whole-site link check (strict: every internal href/src must now exist)
const files = (await walk(OUT)).filter((f) => f.endsWith('.html'));
const emitted = new Set(await walk(OUT));
const broken = checkInternalLinks({ outDir: OUT, emitted, files, isExternalLink: () => false });
if (broken.length) {
  console.error(`\n✗ ${broken.length} broken links in final output:`);
  for (const b of [...new Set(broken)].slice(0, 40)) console.error('  ' + b);
  process.exit(1);
}
console.log(`\n✓ site build complete: ${relative(root, OUT)}/ (${files.length} pages, links OK)`);
