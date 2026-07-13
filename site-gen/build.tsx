/** Native Cycle site build orchestration around the shared pure renderer. */
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { AtomicOutputPublication } from './core/atomic-output';
import {
  FilesystemContentStore,
  openFilesystemClosedBuild,
} from './core/filesystem-closed-build';
import { openCycleGenerator, type CycleGeneratorOutput } from './core/open-site-build';
import { isExternalLink } from './config';
import { checkInternalLinkContent } from './core/link-check';
import { compareText } from './core/order';
import {
  CYCLE_RENDERER_IDENTITY,
  CYCLE_OUTPUT_SCHEMA,
  rendererOutputDeclaration,
  serializeSiteOutput,
  type SiteOutput,
  type SiteOutputFile,
} from './core/output-receipt';
import type { ContentRef, ContentStore } from './core/closed-build';
import { project } from './project';
import { prepareNativeCycleRendererPackage } from './native-renderer-package';
import type { CycleRendererPackage } from './core/renderer-package';
import {
  assertNativeRecipeUnchanged,
  completeNativeRenderer,
  nativeBuildStorageRoot,
  restoreNativeOutput,
} from './core/native-output-cache';

const OUT = project.outDir;
const DESIGN = project.designDir;
const DEFAULT_BUILD_DIRECTORY = process.env.SITE_BUILD_DIR?.trim() || '';
const OUTPUT_CACHE = nativeBuildStorageRoot();
const OUTPUT_OBJECTS = join(OUTPUT_CACHE, 'objects', 'sha256');

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
const outputDerivation = Object.freeze({
  renderer: Object.freeze({ ...CYCLE_RENDERER_IDENTITY, recipeSha256 }),
  outputSchema: CYCLE_OUTPUT_SCHEMA,
  options: outputOptions,
});
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

export interface ResolvedNativeCycleOutput {
  readonly receipt: SiteOutput;
  readonly store: FilesystemContentStore;
}

interface NativeCycleResolution extends ResolvedNativeCycleOutput {
  cacheHit: boolean;
  cacheMs: number;
  pageKinds: ReadonlyMap<string, number>;
  verifyRendererRecipe(boundary: string): void;
}

/** Native host facade over either one verified cache hit or one live Cycle
 * generator. Its identity is immutable; only render memoization changes. */
interface NativeCycleBuild {
  outputs(): CycleGeneratorOutput[];
  render(path: string): Promise<ContentRef>;
  finalize(): Promise<SiteOutput>;
}

interface OpenedNativeCycleBuild {
  readonly build: NativeCycleBuild;
  readonly store: FilesystemContentStore;
  readonly cacheHit: boolean;
  readonly cacheMs: number;
  readonly pageKinds: ReadonlyMap<string, number>;
  verifyRendererRecipe(boundary: string): void;
}

function verifyCachedCatalog(output: SiteOutput, catalog: readonly CycleGeneratorOutput[]): void {
  const files = new Map(output.files.map((file) => [file.path, file]));
  if (files.size !== catalog.length) {
    throw new Error(`Cached SiteOutput has ${files.size} files for a ${catalog.length}-output renderer catalog`);
  }
  for (const descriptor of catalog) {
    const file = files.get(descriptor.file);
    if (!file) throw new Error(`Cached SiteOutput is missing declared output '${descriptor.file}'`);
    const declaration = rendererOutputDeclaration(descriptor);
    if (file.content.mediaType !== descriptor.mime
      || file.producer.id !== declaration.producer.id
      || file.producer.version !== declaration.producer.version
      || file.source !== declaration.source
      || file.owner !== declaration.owner) {
      throw new Error(`Cached SiteOutput declaration differs for '${descriptor.file}'`);
    }
  }
}

async function openNativeCycleBuild(buildDirectory: string): Promise<OpenedNativeCycleBuild> {
  const closedInput = await openFilesystemClosedBuild(buildDirectory);
  const cached = await restoreNativeOutput({
    inputBuildId: closedInput.manifest.buildId,
    cacheDirectory: OUTPUT_CACHE,
    derivation: outputDerivation,
  });
  if (cached) {
    const store = await FilesystemContentStore.openObjectRoot(cached.contentStoreDirectory);
    const generator = await openCycleGenerator(closedInput, rendererPackage, store);
    const catalog = Object.freeze(generator.outputs().map((output) => Object.freeze({ ...output })));
    verifyCachedCatalog(cached.receipt, catalog);
    const byPath = new Map(cached.receipt.files.map((file) => [file.path, file.content]));
    const build: NativeCycleBuild = Object.freeze({
      outputs: () => catalog.map((output) => ({ ...output })),
      render: async (path: string) => {
        const content = byPath.get(path);
        if (!content) throw new Error(`Native Cycle Build has no output '${path}'`);
        return { ...content };
      },
      finalize: async () => cached.receipt,
    });
    return {
      build,
      store,
      cacheHit: true,
      cacheMs: Number(cached.timings.totalMs || 0),
      pageKinds: new Map(),
      verifyRendererRecipe: assertRendererRecipeUnchanged,
    };
  }

  const store = await FilesystemContentStore.create(OUTPUT_OBJECTS);
  const generator = await openCycleGenerator(closedInput, rendererPackage, store);
  console.log(`✓ verified closed SiteBuild ${closedInput.manifest.buildId} from ${buildDirectory}`);
  const catalog = Object.freeze(generator.outputs().map((output) => Object.freeze({ ...output })));
  const rendered = new Map<string, SiteOutputFile>();
  const pageBytes = new Map<string, Uint8Array>();
  const pageKinds = new Map<string, number>();
  for (const output of catalog) {
    if (output.kind === 'page' && output.pageKind) {
      pageKinds.set(output.pageKind, (pageKinds.get(output.pageKind) ?? 0) + 1);
    }
  }
  let finalized: SiteOutput | null = null;

  const build: NativeCycleBuild = Object.freeze({
    outputs: () => catalog.map((output) => ({ ...output })),
    render: async (path: string) => {
      const prior = rendered.get(path);
      if (prior) return { ...prior.content };
      const descriptor = catalog.find((output) => output.file === path);
      if (!descriptor) throw new Error(`Native Cycle Build has no output '${path}'`);
      const content = await generator.render(path);
      if (content.mediaType !== descriptor.mime) {
        throw new Error(
          `Cycle renderer emitted '${path}' as ${content.mediaType}; manifest declares ${descriptor.mime}`,
        );
      }
      if (descriptor.kind === 'page') {
        const bytes = await store.get(content);
        if (!bytes) throw new Error(`ContentStore lost Cycle page '${path}'`);
        pageBytes.set(path, bytes);
      }
      const declaration = rendererOutputDeclaration(descriptor);
      const { mediaType: _mediaType, ...file } = declaration;
      rendered.set(path, {
        ...file,
        content: { ...content, mediaType: content.mediaType },
      });
      return { ...content };
    },
    finalize: async () => {
      if (finalized) return finalized;
      for (const output of catalog) await build.render(output.file);
      assertGeneratorManifest(catalog.map((output) => output.file), new Set(rendered.keys()));
      const broken = checkInternalLinkContent({
        emitted: new Set(rendered.keys()),
        files: [...pageBytes.keys()],
        isExternalLink,
        read: (file) => {
          const bytes = pageBytes.get(file);
          if (!bytes) throw new Error(`ContentStore link check is missing '${file}'`);
          return new TextDecoder().decode(bytes);
        },
      });
      if (broken.length) {
        console.error(`\n✗ ${broken.length} broken internal links:`);
        for (const item of [...new Set(broken)].slice(0, 40)) console.error(`  ${item}`);
        throw new Error('Strict link check failed; finalized site was not published');
      }
      assertRendererRecipeUnchanged('before fresh finalization');
      const scratch = mkdtempSync(join(tmpdir(), 'cycle-native-finalize.'));
      try {
        finalized = await completeNativeRenderer({
          buildDirectory,
          inputBuildId: closedInput.manifest.buildId,
          cacheDirectory: OUTPUT_CACHE,
          contentStoreDirectory: OUTPUT_OBJECTS,
          receiptFile: join(scratch, 'site-output.json'),
          derivation: outputDerivation,
          files: [...rendered.values()],
        });
        assertRendererRecipeUnchanged('during fresh finalization');
        return finalized;
      } finally {
        rmSync(scratch, { recursive: true, force: true });
      }
    },
  });
  return {
    build,
    store,
    cacheHit: false,
    cacheMs: 0,
    pageKinds,
    verifyRendererRecipe: assertRendererRecipeUnchanged,
  };
}

/** Resolve the complete ordinary Cycle output in CAS. No publication directory
 * exists until the caller has a Rust-finalized receipt. */
async function resolveNativeCycleOutputDetailed(options: {
  buildDirectory?: string;
} = {}): Promise<NativeCycleResolution> {
  const buildDirectory = options.buildDirectory?.trim() || DEFAULT_BUILD_DIRECTORY;
  if (!buildDirectory) {
    throw new Error('No native Cycle input selected. Set SITE_BUILD_DIR or pass buildDirectory.');
  }
  const opened = await openNativeCycleBuild(buildDirectory);
  for (const output of opened.build.outputs()) await opened.build.render(output.file);
  const receipt = await opened.build.finalize();
  return {
    receipt,
    store: opened.store,
    cacheHit: opened.cacheHit,
    cacheMs: opened.cacheMs,
    pageKinds: opened.pageKinds,
    verifyRendererRecipe: opened.verifyRendererRecipe,
  };
}

export async function resolveNativeCycleOutput(options: {
  buildDirectory?: string;
} = {}): Promise<ResolvedNativeCycleOutput> {
  const resolved = await resolveNativeCycleOutputDetailed(options);
  return { receipt: resolved.receipt, store: resolved.store };
}

async function materializeReceipt(
  publication: AtomicOutputPublication,
  receipt: SiteOutput,
  store: ContentStore,
): Promise<void> {
  for (const file of receipt.files) {
    const bytes = await store.get(file.content);
    if (!bytes) throw new Error(`ContentStore lost finalized output '${file.path}'`);
    const destination = publication.outputPath(file.path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, bytes, { flag: 'wx' });
  }
}

async function publishNativeCycleOutput(): Promise<void> {
  const buildDirectory = DEFAULT_BUILD_DIRECTORY;
  if (!buildDirectory) {
    throw new Error('No native Cycle input selected. Set SITE_BUILD_DIR to a `fig prepare --target cycle-site/v2` bundle.');
  }
  const resolved = await resolveNativeCycleOutputDetailed({ buildDirectory });
  const publication = await AtomicOutputPublication.create({
    destination: OUT,
    replaceExisting: process.env.SITE_GEN_REPLACE_OUTPUT === '1',
    protectedPaths: [
      project.contentDir,
      project.imageDir,
      ...project.liquidAssetDirs,
      'input',
      DESIGN,
      project.projectCss,
      buildDirectory,
      OUTPUT_CACHE,
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
  try {
    writeFileSync(
      join(publication.stagingDirectory, 'site-output.json'),
      serializeSiteOutput(resolved.receipt),
      { flag: 'wx' },
    );
    await materializeReceipt(publication, resolved.receipt, resolved.store);
    const adopted = await publication.adoptFinalizedOutputReceipt();
    if (adopted.outputId !== resolved.receipt.outputId) {
      throw new Error('Materialized SiteOutput differs from the finalized CAS receipt');
    }
    resolved.verifyRendererRecipe('before output publication');
    await publication.publish();
    if (resolved.cacheHit) {
      console.log(
        `✓ verified SiteOutput cache hit ${adopted.outputId} `
        + `(${adopted.files.length} files; ${resolved.cacheMs.toFixed(1)} ms); skipped Cycle rendering`,
      );
    } else {
      const count = (kind: string) => resolved.pageKinds.get(kind) ?? 0;
      console.log(
        `Rendered ${count('narrative')} narrative + artifacts/toc/validation + ${count('profile')} profiles + VS/CS + ${count('generic')} generic resources + ${count('example')} examples → ${publication.destination}/`,
      );
      console.log(`✓ output ${adopted.outputId} (${adopted.files.length} files) verified`);
      console.log('✓ link check passed; completed site published atomically');
    }
  } catch (error) {
    await publication.abort();
    throw error;
  }
}

if (import.meta.main) await publishNativeCycleOutput();
