#!/usr/bin/env bun
/**
 * build-sitegen-site.ts — the single local/CI entry point for the site-gen site.
 *
 * Runs the IG Publisher for validation/QA, closes a separate cycle-site/v2
 * SiteBuild with pinned Fig, then composes the Cycle renderer with IG-specific
 * extras (viewers, sample SHL, skill.zip, CNAME, Publisher QA), seals the
 * complete staged tree, and publishes site-gen/out once.
 *
 * Pages deploys site-gen/out (the root static site, not the Publisher /en/ shell).
 */
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { copyFile, lstat, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, posix, relative } from 'node:path';
import { viewerBuildEnv, viewerOutput, viewerVariants } from './viewer-variants.ts';
import {
  assertInheritedFilesUnchanged,
  copyVerifiedOutput,
  listRegularOutputFiles,
  mediaTypeForOutput,
  receiptFileMatches,
} from './final-publication.ts';
import { AtomicOutputPublication } from '../site-gen/core/atomic-output.ts';
import { checkInternalLinks } from '../site-gen/core/link-check.ts';
import {
  assertCycleOutputPath,
  type CycleOutputDeclaration,
  type CycleProducerIdentity,
} from '../site-gen/core/output-receipt.ts';
import { project } from '../site-gen/project/cycle.ts';

const root = `${import.meta.dir}/..`;
const OUT = `${root}/site-gen/out`;
const SITE_BUILD_DIR = `${root}/temp/site-gen/cycle.fig-build`;
const FIG_SUSHI_OUT = `${root}/temp/site-gen/fig-sushi`;
const SAMPLE_SHL_DIR = `${root}/temp/site-gen/sample-shl`;
const exampleDir = `${root}/input/resources`;
const exampleOut = `${root}/input/resources/Bundle-period-tracking-longitudinal-example.json`;
const publisherJar = `${root}/input-cache/publisher.jar`;
const figBin = Bun.env.FIG_BIN;
const fhirCache = Bun.env.FHIR_CACHE || `${homedir()}/.fhir/packages`;
const viewerBase = Bun.env.VIEWER_BASE || `https://${project.cname}/view`;
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
async function writeSampleViewerInclude(shlinkFile: string) {
  const link = (await readFile(shlinkFile, 'utf8')).trim();
  const idx = link.indexOf('shlink:/');
  if (idx < 0) throw new Error(`${shlinkFile} does not contain a shlink:/ payload`);
  const fragment = `#${link.slice(idx)}`;
  const md = `[Reference viewer](/view.html${fragment}) · [Layer 0 summary viewer](/view2.html${fragment}) · [Bleeding-first viewer](/view3.html${fragment})\n`;
  await mkdir(join(root, 'input/includes'), { recursive: true });
  await writeFile(join(root, 'input/includes/sample-viewer-links.md'), md);
}
function compatibility404(): string {
  return `<!doctype html>
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
`;
}

function publisherQaRedirect(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="refresh" content="0; url=publisher/qa.html">
<title>Publisher QA</title>
<script>location.replace('publisher/qa.html' + location.search + location.hash);</script>
</head>
<body><p><a href="publisher/qa.html">Open Publisher QA</a></p></body>
</html>
`;
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

// 4. IG Publisher remains an independent validation/QA producer.
if (!(await Bun.file(publisherJar).exists())) await step('download IG Publisher', ['./_updatePublisher.sh']);
await rm(`${root}/output`, { recursive: true, force: true });
await rm(`${root}/temp/pages`, { recursive: true, force: true });
await step('run IG Publisher', ['./_genonce.sh']);

// 5. Cycle consumes only the closed v2 Fig handoff. The Publisher database is
// never projected into a renderer input.
if (!figBin) {
  throw new Error('FIG_BIN must name a pinned fig executable for the Cycle v2 site build');
}
await rm(SITE_BUILD_DIR, { recursive: true, force: true });
await rm(FIG_SUSHI_OUT, { recursive: true, force: true });
await step('prepare closed Cycle v2 SiteBuild', [
  figBin,
  'prepare',
  root,
  '--target',
  'cycle-site/v2',
  '--sushi-out',
  FIG_SUSHI_OUT,
  '--cache',
  fhirCache,
  '--out',
  SITE_BUILD_DIR,
], { SOURCE_DATE_EPOCH: Bun.env.SOURCE_DATE_EPOCH || '1783555200' });

// The project wrapper owns the one canonical publication. The generic renderer
// publishes and verifies its ordinary output only inside this private outer
// staging tree; its inner receipt is consumed as proof, not shipped beside a
// subsequently-mutated directory.
const publication = await AtomicOutputPublication.create({
  destination: OUT,
  replaceExisting: true,
  protectedPaths: [
    project.contentDir,
    project.imageDir,
    ...project.liquidAssetDirs,
    'input',
    'output',
    SITE_BUILD_DIR,
    FIG_SUSHI_OUT,
    SAMPLE_SHL_DIR,
    project.projectCss,
    project.packageList,
    'site-gen/build.tsx',
    'site-gen/client',
    'site-gen/chrome',
    'site-gen/core',
    'site-gen/designs',
    'site-gen/ds',
    'site-gen/fhir',
    'site-gen/project',
    'site-gen/publisher',
    'scripts',
    'skill',
    'viewer-src',
    '.git',
    '.github',
  ],
});
const WORK = publication.stagingDirectory;
const BASE_OUT = join(WORK, '.cycle-renderer-publication');
const outputDeclarations = new Map<string, CycleOutputDeclaration>();

function declareOutput(declaration: CycleOutputDeclaration): void {
  assertCycleOutputPath(declaration.path, 'Project publication output path');
  if (outputDeclarations.has(declaration.path)) {
    throw new Error(`Project publication output collision at '${declaration.path}'`);
  }
  outputDeclarations.set(declaration.path, declaration);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function requireFreshOutput(name: string): Promise<string> {
  const destination = publication.outputPath(name);
  if (outputDeclarations.has(name) || await pathExists(destination)) {
    throw new Error(`Project publication output collision at '${name}'`);
  }
  return destination;
}

async function writeExtra(declaration: CycleOutputDeclaration, content: string | Uint8Array): Promise<void> {
  const destination = await requireFreshOutput(declaration.path);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, content, { flag: 'wx' });
  declareOutput(declaration);
}

async function copyExtra(source: string, declaration: CycleOutputDeclaration): Promise<void> {
  const destination = await requireFreshOutput(declaration.path);
  const sourceMetadata = await lstat(source);
  if (!sourceMetadata.isFile() || sourceMetadata.isSymbolicLink()) {
    throw new Error(`Project publication source is not a regular file: ${source}`);
  }
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination, constants.COPYFILE_EXCL);
  declareOutput(declaration);
}

async function declareGeneratedFile(declaration: CycleOutputDeclaration): Promise<void> {
  const path = publication.outputPath(declaration.path);
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`Generated project output is not a regular file: ${declaration.path}`);
  }
  declareOutput(declaration);
}

async function declareGeneratedTree(
  rootPath: string,
  outputPrefix: string,
  producer: CycleProducerIdentity,
  sourceFor: (relativePath: string) => string,
): Promise<void> {
  for (const relativePath of await listRegularOutputFiles(rootPath)) {
    const path = posix.join(outputPrefix, relativePath);
    await declareGeneratedFile({
      path,
      mediaType: mediaTypeForOutput(path),
      producer,
      source: sourceFor(relativePath),
    });
  }
}

try {
  await step('render verified inner site-gen site', ['bun', 'site-gen/build.tsx'], {
    SITE_BUILD_DIR,
    OUT_DIR: BASE_OUT,
  });
  const base = await copyVerifiedOutput(BASE_OUT, WORK);
  for (const declaration of base.declarations) declareOutput(declaration);
  await rm(BASE_OUT, { recursive: true, force: true });
  await assertInheritedFilesUnchanged(WORK, base.receipt);
  console.log(`✓ inherited verified renderer output ${base.receipt.outputId}`);

  // 8–11. Add every IG-specific artifact inside the same private outer tree.
  for (const variant of viewerVariants) {
    const output = viewerOutput(variant, WORK);
    if (await pathExists(output.page) || await pathExists(output.assets)) {
      throw new Error(`Viewer output collides with inherited Cycle output: ${variant.id}`);
    }
    await step(`bundle ${variant.label}`, ['bun', 'scripts/build-viewer.ts'], viewerBuildEnv(variant, WORK));
    await declareGeneratedFile({
      path: variant.pageName,
      mediaType: 'text/html',
      producer: { id: 'cycle-viewer-bundle', version: '1' },
      source: relative(root, variant.template).replaceAll('\\', '/'),
    });
    await declareGeneratedTree(
      output.assets,
      variant.assetsDirName,
      { id: 'cycle-viewer-bundle', version: '1' },
      (relativePath) => relativePath === 'index.html'
        ? relative(root, variant.template).replaceAll('\\', '/')
        : relative(root, variant.entry).replaceAll('\\', '/'),
    );
  }

  for (const variant of viewerVariants) {
    for (const file of demoFiles) {
      const path = posix.join(variant.assetsDirName, file);
      await copyExtra(join(SAMPLE_SHL_DIR, file), {
        path,
        mediaType: mediaTypeForOutput(path),
        producer: { id: 'cycle-smart-health-link', version: '1' },
        source: `temp/site-gen/sample-shl/${file}`,
        owner: variant.pageName,
      });
    }
  }

  const inheritedLlms = base.receipt.files.find((file) => file.path === 'llms.txt');
  if (!inheritedLlms) throw new Error('Verified Cycle renderer output has no llms.txt');
  if (await pathExists(publication.outputPath('skill.zip'))) {
    throw new Error("Project publication output collision at 'skill.zip'");
  }
  await step('package agent assets (skill.zip)', ['bun', 'scripts/build-agent-assets.ts'], {
    AGENT_OUTDIR: WORK,
    AGENT_SITE_DIR: WORK,
  });
  await declareGeneratedFile({
    path: 'skill.zip',
    mediaType: 'application/zip',
    producer: { id: 'cycle-agent-assets', version: '1' },
    source: 'rendered Cycle Markdown + skill package template',
  });
  const transformedBasePaths = new Set<string>();
  if (!await receiptFileMatches(WORK, inheritedLlms)) {
    transformedBasePaths.add('llms.txt');
    outputDeclarations.set('llms.txt', {
      path: 'llms.txt',
      mediaType: 'text/plain',
      producer: { id: 'cycle-agent-assets', version: '1' },
      source: 'Cycle renderer llms.txt + Agent package section',
    });
  }

  await copyExtra(join(root, project.packageList), {
    path: 'package-list.json',
    mediaType: 'application/json',
    producer: { id: 'cycle-project-publication', version: '1' },
    source: project.packageList,
  });
  const cname = Bun.env.PAGES_CNAME || project.cname;
  await writeExtra({
    path: 'CNAME',
    mediaType: 'text/plain',
    producer: { id: 'cycle-project-publication', version: '1' },
    source: 'PAGES_CNAME or project.cname',
  }, `${cname}\n`);
  await writeExtra({
    path: '404.html',
    mediaType: 'text/html',
    producer: { id: 'cycle-project-publication', version: '1' },
    source: 'legacy /en compatibility redirect',
  }, compatibility404());
  console.log('Wrote 404.html compatibility redirect for old /en/ URLs');

  // QA pages link throughout the Publisher's /en and comparison trees. Keep
  // that artifact complete under its own namespace instead of copying a few QA
  // files with dangling links into the Cycle renderer's root namespace.
  const publisherOutput = join(root, 'output');
  const publisherArtifacts = await listRegularOutputFiles(publisherOutput);
  for (const name of publisherArtifacts) {
    const path = posix.join('publisher', name);
    await copyExtra(join(publisherOutput, name), {
      path,
      mediaType: mediaTypeForOutput(path),
      producer: { id: 'hl7-fhir-publisher', version: 'current-input' },
      source: `output/${name}`,
    });
  }
  await writeExtra({
    path: 'qa.html',
    mediaType: 'text/html',
    producer: { id: 'cycle-project-publication', version: '1' },
    source: 'redirect to complete namespaced Publisher QA artifact',
  }, publisherQaRedirect());
  console.log(`Copied complete Publisher artifact (${publisherArtifacts.length} files) under publisher/`);

  // All ordinary renderer bytes must still match the inherited receipt. llms.txt
  // is the sole intentional transformation and now has wrapper provenance.
  await assertInheritedFilesUnchanged(WORK, base.receipt, transformedBasePaths);

  // 12. Check every wrapper/Cycle page. The complete publisher/ subtree is an
  // independently generated artifact: IG Publisher has already validated its
  // 1,494 HTML files and reported its own broken-link count. Reinterpreting its
  // raw support pages with Cycle's checker produces false positives for
  // Publisher-only placeholders, so preserve and seal it without a second,
  // semantically different HTML pass.
  const allFiles = await listRegularOutputFiles(WORK);
  const files = allFiles.filter((file) => file.endsWith('.html') && !file.startsWith('publisher/'));
  const emitted = new Set(allFiles);
  const broken = checkInternalLinks({ outDir: WORK, emitted, files, isExternalLink: () => false });
  if (broken.length) {
    console.error(`\n✗ ${broken.length} broken links in final output:`);
    for (const item of [...new Set(broken)].slice(0, 40)) console.error(`  ${item}`);
    throw new Error('Final whole-site link check failed; canonical output was not published');
  }

  const receipt = await publication.sealOutputReceipt({
    inputBuildId: base.receipt.inputBuildId,
    renderer: {
      id: 'cycle-project-publication',
      version: '1',
      // This project wrapper has external QA/viewer inputs beyond SiteBuild.
      // Conservatively bind its exact completed composition into the recipe so
      // it can never collide with a stale reusable base-renderer entry.
      recipeSha256: createHash('sha256').update(JSON.stringify({
        schema: 'cycle-project-publication-recipe/v1',
        // SiteOutput binds every final byte. The derivation recipe instead
        // binds the upstream authenticated output, wrapper implementation, and
        // explicit composition options; rereading the completed tree here only
        // duplicated finalization and caused a whole-site memory spike.
        baseOutputId: base.receipt.outputId,
        baseRecipe: base.receipt.renderer.recipeSha256,
        wrapper: createHash('sha256').update(await readFile(import.meta.path)).digest('hex'),
        options: {
          sourceDateEpoch: Bun.env.SOURCE_DATE_EPOCH || '1783555200',
          viewerBase,
          cname: Bun.env.PAGES_CNAME || project.cname,
        },
      })).digest('hex'),
    },
    outputSchema: 'cycle-project-publication/v1',
    options: { baseOutputId: base.receipt.outputId },
    declarations: [...outputDeclarations.values()],
  });
  await publication.publish();
  console.log(`\n✓ site build complete: ${relative(root, OUT)}/ (${files.length} pages, links OK; Publisher QA at qa.html)`);
  console.log(`✓ complete output ${receipt.outputId} (${receipt.files.length} files) verified`);
} catch (error) {
  await publication.abort();
  throw error;
}
