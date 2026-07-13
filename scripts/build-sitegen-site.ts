#!/usr/bin/env bun
/**
 * build-sitegen-site.ts — the single local/CI entry point for the site-gen site.
 *
 * Runs the IG Publisher for validation/QA, closes a separate cycle-site/v2
 * SiteBuild with pinned Fig, then composes the Cycle renderer with IG-specific
 * extras (viewers, sample SHL, skill.zip, CNAME, Publisher QA), seals the
 * complete CAS namespace, and materializes/publishes site-gen/out once.
 *
 * Pages deploys site-gen/out (the root static site, not the Publisher /en/ shell).
 */
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, posix, relative } from 'node:path';
import { viewerBuildEnv, viewerOutput, viewerVariants } from './viewer-variants.ts';
import {
  listRegularOutputFiles,
  mediaTypeForOutput,
} from './final-publication.ts';
import { AtomicOutputPublication } from '../site-gen/core/atomic-output.ts';
import { ContentOutputNamespace } from '../site-gen/core/content-output-namespace.ts';
import {
  completeNativeRenderer,
  nativeBuildStorageRoot,
} from '../site-gen/core/native-output-cache.ts';
import { checkInternalLinkContent } from '../site-gen/core/link-check.ts';
import {
  serializeSiteOutput,
  type CycleOutputDeclaration,
  type OutputProducer,
} from '../site-gen/core/output-receipt.ts';
import { project } from '../site-gen/project/cycle.ts';
import { resolveNativeCycleOutput } from '../site-gen/build.tsx';

const root = `${import.meta.dir}/..`;
const OUT = `${root}/site-gen/out`;
const SITE_BUILD_DIR = `${root}/temp/site-gen/cycle.fig-build`;
const SAMPLE_SHL_DIR = `${root}/temp/site-gen/sample-shl`;
const exampleDir = `${root}/input/resources`;
const exampleOut = `${root}/input/resources/Bundle-period-tracking-longitudinal-example.json`;
const publisherJar = `${root}/input-cache/publisher.jar`;
const figBin = Bun.env.FIG_BIN;
const OUTPUT_CACHE = nativeBuildStorageRoot();
const OUTPUT_OBJECTS = join(OUTPUT_CACHE, 'objects', 'sha256');
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
await step('prepare closed Cycle v2 SiteBuild', [
  figBin,
  'prepare',
  root,
  '--target',
  'cycle-site/v2',
  '--cache',
  fhirCache,
  '--out',
  SITE_BUILD_DIR,
], { SOURCE_DATE_EPOCH: Bun.env.SOURCE_DATE_EPOCH || '1783555200' });

// The wrapper composes authenticated ContentRefs first. A destination tree is
// created only after Rust finalizes that exact namespace.
const scratch = await mkdtemp(join(tmpdir(), 'cycle-project-compose.'));
let publication: AtomicOutputPublication | null = null;

async function addSource(
  namespace: ContentOutputNamespace,
  source: string,
  declaration: CycleOutputDeclaration,
): Promise<void> {
  const metadata = await lstat(source);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`Project publication source is not a regular file: ${source}`);
  }
  await namespace.add(declaration, new Uint8Array(await readFile(source)));
}

async function addGeneratedTree(
  namespace: ContentOutputNamespace,
  rootPath: string,
  outputPrefix: string,
  producer: OutputProducer,
  sourceFor: (relativePath: string) => string,
): Promise<void> {
  for (const relativePath of await listRegularOutputFiles(rootPath)) {
    const path = posix.join(outputPrefix, relativePath);
    await addSource(namespace, join(rootPath, relativePath), {
      path,
      mediaType: mediaTypeForOutput(path),
      producer,
      source: sourceFor(relativePath),
    });
  }
}

try {
  const base = await resolveNativeCycleOutput({ buildDirectory: SITE_BUILD_DIR });
  const namespace = ContentOutputNamespace.inherit({ receipt: base.receipt, store: base.store });
  console.log(`✓ inherited verified renderer output ${base.receipt.outputId} without copying its bytes`);

  const viewerScratch = join(scratch, 'viewers');
  for (const variant of viewerVariants) {
    const output = viewerOutput(variant, viewerScratch);
    await step(`bundle ${variant.label}`, ['bun', 'scripts/build-viewer.ts'], viewerBuildEnv(variant, viewerScratch));
    await addSource(namespace, output.page, {
      path: variant.pageName,
      mediaType: 'text/html',
      producer: { id: 'cycle-viewer-bundle', version: '1' },
      source: relative(root, variant.template).replaceAll('\\', '/'),
    });
    await addGeneratedTree(
      namespace,
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
      await addSource(namespace, join(SAMPLE_SHL_DIR, file), {
        path,
        mediaType: mediaTypeForOutput(path),
        producer: { id: 'cycle-smart-health-link', version: '1' },
        source: `temp/site-gen/sample-shl/${file}`,
        owner: variant.pageName,
      });
    }
  }

  const agentSite = join(scratch, 'agent-site');
  const agentOut = join(scratch, 'agent-out');
  await mkdir(agentSite, { recursive: true });
  await mkdir(agentOut, { recursive: true });
  for (const name of [
    'implementation.md',
    'index.md',
    'specification.md',
    'examples.md',
    'references.md',
    'ig-details.md',
  ]) {
    await writeFile(join(agentSite, name), await namespace.read(name));
  }
  await writeFile(join(agentOut, 'llms.txt'), await namespace.read('llms.txt'));
  await step('package agent assets (skill.zip)', ['bun', 'scripts/build-agent-assets.ts'], {
    AGENT_OUTDIR: agentOut,
    AGENT_SITE_DIR: agentSite,
  });
  await addSource(namespace, join(agentOut, 'skill.zip'), {
    path: 'skill.zip',
    mediaType: 'application/zip',
    producer: { id: 'cycle-agent-assets', version: '1' },
    source: 'rendered Cycle Markdown + skill package template',
  });
  await namespace.replace('llms.txt', {
    path: 'llms.txt',
    mediaType: 'text/plain',
    producer: { id: 'cycle-agent-assets', version: '1' },
    source: 'Cycle renderer llms.txt + Agent package section',
  }, new Uint8Array(await readFile(join(agentOut, 'llms.txt'))));

  await addSource(namespace, join(root, project.packageList), {
    path: 'package-list.json',
    mediaType: 'application/json',
    producer: { id: 'cycle-project-publication', version: '1' },
    source: project.packageList,
  });
  const cname = Bun.env.PAGES_CNAME || project.cname;
  await namespace.add({
    path: 'CNAME',
    mediaType: 'text/plain',
    producer: { id: 'cycle-project-publication', version: '1' },
    source: 'PAGES_CNAME or project.cname',
  }, `${cname}\n`);
  await namespace.add({
    path: '404.html',
    mediaType: 'text/html',
    producer: { id: 'cycle-project-publication', version: '1' },
    source: 'legacy /en compatibility redirect',
  }, compatibility404());

  const publisherOutput = join(root, 'output');
  const publisherArtifacts = await listRegularOutputFiles(publisherOutput);
  for (const name of publisherArtifacts) {
    const path = posix.join('publisher', name);
    await addSource(namespace, join(publisherOutput, name), {
      path,
      mediaType: mediaTypeForOutput(path),
      producer: { id: 'hl7-fhir-publisher', version: 'current-input' },
      source: `output/${name}`,
    });
  }
  await namespace.add({
    path: 'qa.html',
    mediaType: 'text/html',
    producer: { id: 'cycle-project-publication', version: '1' },
    source: 'redirect to complete namespaced Publisher QA artifact',
  }, publisherQaRedirect());
  console.log(`Added complete Publisher artifact (${publisherArtifacts.length} files) under publisher/`);

  const allFiles = namespace.paths();
  const files = allFiles.filter((file) => file.endsWith('.html') && !file.startsWith('publisher/'));
  const html = new Map<string, string>();
  for (const file of files) html.set(file, await namespace.readText(file));
  const broken = checkInternalLinkContent({
    emitted: new Set(allFiles),
    files,
    isExternalLink: () => false,
    read: (file) => {
      const body = html.get(file);
      if (body === undefined) throw new Error(`Link checker is missing '${file}'`);
      return body;
    },
  });
  if (broken.length) {
    console.error(`\n✗ ${broken.length} broken links in final output:`);
    for (const item of [...new Set(broken)].slice(0, 40)) console.error(`  ${item}`);
    throw new Error('Final whole-site link check failed; canonical output was not published');
  }

  const receiptFile = join(scratch, 'site-output.json');
  const finalizedReceipt = await completeNativeRenderer({
    buildDirectory: SITE_BUILD_DIR,
    inputBuildId: namespace.inputBuildId,
    cacheDirectory: OUTPUT_CACHE,
    contentStoreDirectory: OUTPUT_OBJECTS,
    receiptFile,
    derivation: {
      renderer: {
        id: 'cycle-project-publication',
        version: '1',
        recipeSha256: createHash('sha256').update(JSON.stringify({
          schema: 'cycle-project-publication-recipe/v1',
          baseOutputId: base.receipt.outputId,
          baseRecipe: base.receipt.renderer.recipeSha256,
          wrapper: createHash('sha256').update(await readFile(import.meta.path)).digest('hex'),
          options: {
            sourceDateEpoch: Bun.env.SOURCE_DATE_EPOCH || '1783555200',
            viewerBase,
            cname,
          },
        })).digest('hex'),
      },
      outputSchema: 'cycle-project-publication/v1',
      options: { baseOutputId: base.receipt.outputId },
    },
    files: namespace.completedFiles(),
  });

  publication = await AtomicOutputPublication.create({
    destination: OUT,
    replaceExisting: true,
    protectedPaths: [
      project.contentDir,
      project.imageDir,
      ...project.liquidAssetDirs,
      'input',
      'output',
      SITE_BUILD_DIR,
      SAMPLE_SHL_DIR,
      OUTPUT_CACHE,
      scratch,
      project.projectCss,
      project.packageList,
      'site-gen',
      'scripts',
      'skill',
      'viewer-src',
      '.git',
      '.github',
    ],
  });
  await writeFile(
    join(publication.stagingDirectory, 'site-output.json'),
    serializeSiteOutput(finalizedReceipt),
    { flag: 'wx' },
  );
  for (const file of finalizedReceipt.files) {
    const bytes = await namespace.store.get(file.content);
    if (!bytes) throw new Error(`ContentStore lost finalized project output '${file.path}'`);
    const destination = publication.outputPath(file.path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, bytes, { flag: 'wx' });
  }
  const receipt = await publication.adoptFinalizedOutputReceipt();
  if (receipt.outputId !== finalizedReceipt.outputId) {
    throw new Error('Materialized project output differs from its finalized receipt');
  }
  await publication.publish();
  console.log(`\n✓ site build complete: ${relative(root, OUT)}/ (${files.length} pages, links OK; Publisher QA at qa.html)`);
  console.log(`✓ complete output ${receipt.outputId} (${receipt.files.length} files) verified`);
} catch (error) {
  if (publication) await publication.abort();
  throw error;
} finally {
  await rm(scratch, { recursive: true, force: true });
}
