/** Native Cycle site build orchestration around the shared pure renderer. */
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, posix } from 'node:path';
import { AtomicOutputPublication } from './core/atomic-output';
import { SqliteSiteBuildView } from './core/db';
import { openFilesystemClosedBuild } from './core/filesystem-closed-build';
import { openCycleSiteBuild } from './core/open-site-build';
import { CycleSiteRenderer } from './core/renderer';
import { createCycleContentRenderer } from './core/content';
import type { SiteBuildView } from './core/site-build';
import { includes } from './project/includes';
import { isExternalLink } from './config';
import { checkInternalLinks } from './core/link-check';
import { compareText } from './core/order';
import {
  CYCLE_RENDERER_IDENTITY,
  assertCycleOutputPath,
  rendererOutputDeclaration,
  type CycleOutputDeclaration,
  type CycleProducerIdentity,
} from './core/output-receipt';
import { project } from './project';

const OUT = project.outDir;
const DESIGN = project.designDir;

type NativeInput =
  | { mode: 'portable'; view: SiteBuildView; buildId: string }
  | { mode: 'legacy-sqlite'; view: SqliteSiteBuildView; siteDb: string; inputBuildId: string };

async function openNativeInput(): Promise<NativeInput> {
  const buildDirectory = process.env.SITE_BUILD_DIR?.trim();
  const siteDb = process.env.SITE_DB?.trim();
  if (buildDirectory && siteDb) {
    throw new Error('Choose one native input: SITE_BUILD_DIR (portable) or SITE_DB (legacy SQLite), not both.');
  }
  if (buildDirectory) {
    const handle = await openFilesystemClosedBuild(buildDirectory);
    const view = await openCycleSiteBuild(handle);
    return { mode: 'portable', view, buildId: handle.manifest.buildId };
  }
  if (siteDb) {
    const inputBuildId = `legacy-site-db-sha256:${createHash('sha256').update(readFileSync(siteDb)).digest('hex')}`;
    return { mode: 'legacy-sqlite', view: new SqliteSiteBuildView(siteDb), siteDb, inputBuildId };
  }
  throw new Error(
    'No native Cycle input selected. Set SITE_BUILD_DIR to a `fig prepare` bundle, '
      + 'or set SITE_DB explicitly for the legacy SQLite fallback.',
  );
}

const input = await openNativeInput();
const siteBuildView: SiteBuildView = input.view;
if (input.mode === 'portable') {
  console.log(`✓ verified closed SiteBuild ${input.buildId} from ${process.env.SITE_BUILD_DIR}`);
} else {
  console.warn(`! legacy SQLite Cycle input: ${input.siteDb} (prefer SITE_BUILD_DIR)`);
}

const publication = await AtomicOutputPublication.create({
  destination: OUT,
  replaceExisting: process.env.SITE_GEN_REPLACE_OUTPUT === '1',
  protectedPaths: [
    // Project inputs and native input transports must never be selected as an
    // output tree, even when replacement was explicitly requested.
    project.contentDir,
    project.imageDir,
    ...project.liquidAssetDirs,
    'input',
    DESIGN,
    project.projectCss,
    ...(process.env.SITE_BUILD_DIR?.trim() ? [process.env.SITE_BUILD_DIR.trim()] : []),
    ...(process.env.SITE_DB?.trim() ? [process.env.SITE_DB.trim()] : []),
    // Native renderer/client source roots read while the staging tree is built.
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
const emitted = new Set<string>();
const producers = new Map<string, string>();
const outputDeclarations = new Map<string, CycleOutputDeclaration>();

function reserveOutput(declaration: CycleOutputDeclaration, description: string): string {
  const name = declaration.path;
  assertCycleOutputPath(name, 'Native Cycle output path');
  const destination = publication.outputPath(name);
  const prior = producers.get(name);
  if (prior || existsSync(destination)) {
    throw new Error(`Native output collision at '${name}': ${prior || 'existing staged file'} and ${description}`);
  }
  producers.set(name, description);
  outputDeclarations.set(name, declaration);
  emitted.add(name);
  return destination;
}

function writeOutput(
  declaration: CycleOutputDeclaration,
  content: string | Uint8Array,
  description: string,
): void {
  const destination = reserveOutput(declaration, description);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, content as any);
}

function mediaTypeForOutput(path: string): string {
  const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return ({
    css: 'text/css',
    gif: 'image/gif',
    ico: 'image/x-icon',
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    js: 'text/javascript',
    png: 'image/png',
    svg: 'image/svg+xml',
    ttf: 'font/ttf',
    webp: 'image/webp',
    woff: 'font/woff',
    woff2: 'font/woff2',
  } as Record<string, string>)[extension] || 'application/octet-stream';
}

function copyOutputTree(
  sourceRoot: string,
  outputRoot: string,
  description: string,
  producer: CycleProducerIdentity,
  sourceNamespace: string,
): void {
  const visit = (source: string, relative: string): void => {
    const metadata = lstatSync(source);
    if (metadata.isSymbolicLink()) {
      throw new Error(`Native output source may not contain symlinks: ${source}`);
    }
    if (metadata.isDirectory()) {
      for (const child of readdirSync(source).sort(compareText)) {
        visit(`${source}/${child}`, relative ? `${relative}/${child}` : child);
      }
      return;
    }
    if (!metadata.isFile()) throw new Error(`Native output source is not a regular file: ${source}`);
    const name = outputRoot ? posix.join(outputRoot, relative) : relative;
    const destination = reserveOutput({
      path: name,
      mediaType: mediaTypeForOutput(name),
      producer,
      source: relative ? `${sourceNamespace}/${relative}` : sourceNamespace,
    }, `${description} (${source})`);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(source, destination);
  };
  visit(sourceRoot, '');
}

function assertGeneratorManifest(expected: readonly string[], actual: Set<string>): void {
  const expectedSet = new Set(expected);
  const missing = expected.filter((file) => !actual.has(file));
  const undeclared = [...actual].filter((file) => !expectedSet.has(file)).sort(compareText);
  if (missing.length || undeclared.length) {
    throw new Error(
      `Cycle generator output does not match its manifest; missing=[${missing.join(', ')}], undeclared=[${undeclared.join(', ')}]`,
    );
  }
}

try {
  // CLI-only output setup and design assets. Nothing is visible at OUT until
  // rendering, client bundling, and the strict link check have all succeeded.
  copyOutputTree(
    `${DESIGN}/styles`,
    'assets/cycle',
    'Cycle design styles',
    { id: 'cycle-design', version: '1' },
    'styles',
  );
  copyOutputTree(
    `${DESIGN}/fonts`,
    'assets/fonts',
    'Cycle design fonts',
    { id: 'cycle-design', version: '1' },
    'fonts',
  );
  copyOutputTree(
    `${DESIGN}/assets`,
    'assets',
    'Cycle design assets',
    { id: 'cycle-design', version: '1' },
    'assets',
  );
  copyOutputTree(
    project.projectCss,
    'assets/project.css',
    'project stylesheet',
    { id: 'cycle-project', version: '1' },
    'stylesheet',
  );

  const content = createCycleContentRenderer({
    // Portable builds are closed and deliberately have no SQL capability. The
    // legacy adapter is the only place this compatibility escape hatch exists.
    ...(input.mode === 'legacy-sqlite'
      ? { sql: (query: string) => input.view.db.query(query).all() as Record<string, any>[] }
      : {}),
    // A portable build must fail loudly on an undeclared SQL tag even when a dev
    // shell happens to export SITE_GEN_LENIENT.
    lenient: input.mode === 'legacy-sqlite' && process.env.SITE_GEN_LENIENT === '1',
    warn: (message) => console.warn(`  ! ${message}`),
  });

  const renderer = new CycleSiteRenderer(siteBuildView, { content, includes, project });
  const descriptors = renderer.listPages();
  const outputManifest = renderer.listOutputs();
  const outputDescriptors = new Map(outputManifest.map((output) => [output.file, output]));
  const generatorEmitted = new Set<string>();
  const writeRendererOutput = (file: string, content: string | Uint8Array, mime: string): void => {
    const descriptor = outputDescriptors.get(file);
    if (!descriptor) throw new Error(`Cycle renderer emitted undeclared output '${file}'`);
    if (descriptor.mime !== mime) {
      throw new Error(`Cycle renderer emitted '${file}' as ${mime}; manifest declares ${descriptor.mime}`);
    }
    writeOutput(rendererOutputDeclaration(descriptor), content, descriptor.producer);
    generatorEmitted.add(file);
  };
  // Materialize the declared namespace through the same direct-path API used
  // by browser hosts. This keeps host code independent of whether an auxiliary
  // output belongs to a distinct page (ordinary resources), shares a page with
  // another producer (the primary IG and index narrative), or has no page at
  // all (assets and llms.txt).
  for (const descriptor of outputManifest) {
    const rendered = renderer.renderOutput(descriptor.file);
    writeRendererOutput(rendered.file, rendered.content, rendered.mime);
  }
  assertGeneratorManifest(outputManifest.map((output) => output.file), generatorEmitted);

  // CLI-only browser bundle.
  const appBundlePath = reserveOutput({
    path: 'assets/app.js',
    mediaType: 'text/javascript',
    producer: { id: 'cycle-client-bundle', version: '1' },
    source: 'site-gen/client/entry.tsx',
  }, 'Cycle browser application bundle');
  mkdirSync(dirname(appBundlePath), { recursive: true });
  const bundle = await Bun.build({
    entrypoints: ['site-gen/client/entry.tsx'],
    outdir: `${WORK}/assets`,
    naming: 'app.js',
    target: 'browser',
    minify: true,
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  if (!bundle.success) {
    console.error('✗ client bundle failed:');
    for (const log of bundle.logs) console.error(`  ${log}`);
    throw new Error('Client bundle failed; staged site was not published');
  }
  if (!existsSync(appBundlePath)) throw new Error('Client bundle succeeded without emitting assets/app.js');
  const bundleKb = Math.round((bundle.outputs.find((output) => output.path.endsWith('app.js'))?.size || 0) / 1024);
  console.log(`✓ client bundle → assets/app.js (${bundleKb} KB)`);

  // Strict link checking runs against the complete private tree. A late failure
  // therefore cannot expose a partial site or disturb a previous publication.
  const broken = checkInternalLinks({
    outDir: WORK,
    emitted,
    files: outputManifest.filter((output) => output.kind === 'page').map((output) => output.file),
    isExternalLink,
  });
  if (broken.length) {
    console.error(`\n✗ ${broken.length} broken internal links:`);
    for (const item of [...new Set(broken)].slice(0, 40)) console.error(`  ${item}`);
    throw new Error('Strict link check failed; staged site was not published');
  }

  const inputBuildId = input.mode === 'portable'
    ? input.buildId
    : input.inputBuildId;
  const receipt = await publication.sealOutputReceipt({
    inputBuildId,
    renderer: CYCLE_RENDERER_IDENTITY,
    declarations: [...outputDeclarations.values()],
  });
  await publication.publish();
  const count = (kind: string) => descriptors.filter((page) => page.kind === kind).length;
  console.log(
    `Rendered ${count('narrative')} narrative + artifacts/toc/validation + ${count('profile')} profiles + VS/CS + ${count('generic')} generic resources + ${count('example')} examples → ${publication.destination}/`,
  );
  console.log(`✓ output receipt ${receipt.outputBuildId} (${receipt.files.length} files) verified`);
  console.log('✓ link check passed; completed site published atomically');
} catch (error) {
  await publication.abort();
  throw error;
}
