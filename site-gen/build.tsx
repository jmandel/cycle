/** Native Cycle site build orchestration around the shared pure renderer. */
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { AtomicOutputPublication } from './core/atomic-output';
import { openFilesystemClosedBuild } from './core/filesystem-closed-build';
import { openCycleGenerator } from './core/open-site-build';
import { isExternalLink } from './config';
import { checkInternalLinks } from './core/link-check';
import { compareText } from './core/order';
import {
  CYCLE_RENDERER_IDENTITY,
  CYCLE_OUTPUT_SCHEMA,
  assertCycleOutputPath,
  rendererOutputDeclaration,
  type CycleOutputDeclaration,
} from './core/output-receipt';
import { project } from './project';
import { prepareNativeCycleRendererPackage } from './native-renderer-package';
import type { CycleRendererPackage } from './core/renderer-package';
import {
  assertNativeRecipeUnchanged,
  nativeOutputCacheRoot,
  finalizeNativeOutput,
  restoreNativeOutput,
  type NativeOutputDerivation,
} from './core/native-output-cache';

const OUT = project.outDir;
const DESIGN = project.designDir;
const BUILD_DIRECTORY = process.env.SITE_BUILD_DIR?.trim();
if (!BUILD_DIRECTORY) {
  throw new Error('No native Cycle input selected. Set SITE_BUILD_DIR to a `fig prepare --target cycle-site/v2` bundle.');
}
const OUTPUT_CACHE = nativeOutputCacheRoot();

const RENDERER_RECIPE_CANDIDATES = [...new Set([
  'site-gen/build.tsx',
  'site-gen/client',
  'site-gen/chrome',
  'site-gen/core',
  'site-gen/designs',
  'site-gen/ds',
  'site-gen/fhir',
  'site-gen/project',
  'package.json',
  'bun.lock',
  DESIGN,
  project.projectCss,
  project.contentDir,
  project.imageDir,
  ...project.liquidAssetDirs,
])];

/** Hash exact renderer code/assets plus the runtime facts that affect output. */
function rendererRecipeSha256(paths: readonly string[], rendererPackageId: string): string {
  const entries: Array<{ path: string; byteLength: number; sha256: string }> = [];
  const visit = (path: string): void => {
    const metadata = lstatSync(path);
    if (metadata.isSymbolicLink()) throw new Error(`Renderer recipe may not contain symlinks: ${path}`);
    if (metadata.isDirectory()) {
      for (const child of readdirSync(path).sort(compareText)) visit(`${path}/${child}`);
      return;
    }
    if (!metadata.isFile()) throw new Error(`Renderer recipe member is not a regular file: ${path}`);
    const bytes = readFileSync(path);
    entries.push({
      path: path.replace(/\\/g, '/'),
      byteLength: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  };
  for (const path of [...paths].sort(compareText)) visit(path);
  entries.sort((left, right) => compareText(left.path, right.path));
  const recipe = JSON.stringify({
    schema: 'cycle-renderer-recipe/v1',
    runtime: { bun: Bun.version, platform: process.platform, arch: process.arch },
    rendererPackageId,
    entries,
  });
  return createHash('sha256').update(recipe).digest('hex');
}

async function openNativeInput(rendererPackage: CycleRendererPackage) {
  const handle = await openFilesystemClosedBuild(BUILD_DIRECTORY);
  return openCycleGenerator(handle, rendererPackage);
}

const rendererPackage = await prepareNativeCycleRendererPackage({
  designDirectory: DESIGN,
  projectCss: project.projectCss,
  clientEntry: 'site-gen/client/entry.tsx',
});
function currentRendererRecipeSha256(): string {
  return rendererRecipeSha256(
    RENDERER_RECIPE_CANDIDATES.filter(existsSync),
    rendererPackage.packageId,
  );
}
const recipeSha256 = currentRendererRecipeSha256();
function assertRendererRecipeUnchanged(boundary: string): void {
  assertNativeRecipeUnchanged(recipeSha256, currentRendererRecipeSha256(), boundary);
}
const outputOptions = Object.freeze({
  bunVersion: Bun.version,
  clientMinify: 'true',
  clientTarget: 'browser',
  nodeEnv: 'production',
  platform: process.platform,
  architecture: process.arch,
});
const outputDerivation: NativeOutputDerivation = Object.freeze({
  renderer: Object.freeze({ ...CYCLE_RENDERER_IDENTITY, recipeSha256 }),
  outputSchema: CYCLE_OUTPUT_SCHEMA,
  options: outputOptions,
});

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
    BUILD_DIRECTORY,
    OUTPUT_CACHE,
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
  const cached = restoreNativeOutput({
    buildDirectory: BUILD_DIRECTORY,
    cacheDirectory: OUTPUT_CACHE,
    stagingDirectory: WORK,
    derivation: outputDerivation,
  });
  if (cached) {
    const receipt = await publication.adoptFinalizedOutputReceipt();
    if (receipt.cacheKey !== cached.cacheKey || receipt.outputId !== cached.outputId) {
      throw new Error(
        `Fig cache result does not match materialized SiteOutput: `
        + `${cached.cacheKey}/${cached.outputId} != ${receipt.cacheKey}/${receipt.outputId}`,
      );
    }
    assertRendererRecipeUnchanged('before cached output publication');
    await publication.publish();
    console.log(
      `✓ verified SiteOutput cache hit ${receipt.outputId} `
      + `(${receipt.files.length} files; ${Number(cached.timings.totalMs || 0).toFixed(1)} ms); skipped Cycle rendering`,
    );
  } else {
    const generator = await openNativeInput(rendererPackage);
    console.log(`✓ verified closed SiteBuild ${generator.buildId} from ${BUILD_DIRECTORY}`);
    const outputManifest = generator.outputs();
    const descriptors = outputManifest.filter((output) => output.kind === 'page');
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
      const rendered = generator.render(descriptor.file);
      writeRendererOutput(rendered.file, rendered.content, rendered.mime);
    }
    assertGeneratorManifest(outputManifest.map((output) => output.file), generatorEmitted);

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

    assertRendererRecipeUnchanged('before fresh finalization');
    const finalized = finalizeNativeOutput({
      buildDirectory: BUILD_DIRECTORY,
      inputBuildId: generator.buildId,
      cacheDirectory: OUTPUT_CACHE,
      siteDirectory: WORK,
      derivation: outputDerivation,
      declarations: [...outputDeclarations.values()],
    });
    assertRendererRecipeUnchanged('during fresh finalization');
    const receipt = await publication.adoptFinalizedOutputReceipt();
    if (finalized.outputId !== receipt.outputId || finalized.cacheKey !== receipt.cacheKey) {
      throw new Error('Fig finalized a different SiteOutput than Cycle independently verified');
    }
    await publication.publish();
    const count = (kind: string) => descriptors.filter((page) => page.pageKind === kind).length;
    console.log(
      `Rendered ${count('narrative')} narrative + artifacts/toc/validation + ${count('profile')} profiles + VS/CS + ${count('generic')} generic resources + ${count('example')} examples → ${publication.destination}/`,
    );
    console.log(`✓ output ${receipt.outputId} (cache ${receipt.cacheKey}; ${receipt.files.length} files) verified`);
    console.log('✓ link check passed; completed site published atomically');
  }
} catch (error) {
  await publication.abort();
  throw error;
}
