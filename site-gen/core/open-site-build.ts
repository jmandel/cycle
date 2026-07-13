/** The single public Cycle generator seam over one verified, closed v2 build. */
import type { ClosedBuildHandle, ContentRef, WritableContentStore } from './closed-build';
import { createCycleContentRenderer } from './content';
import { CycleSiteRenderer } from './renderer';
import type { CycleOutputDescriptor } from './renderer';
import { CycleSiteBuild } from './semantic-site-build';
import { CycleRendererPackage } from './renderer-package';
import { compareText } from './order';
import { includes } from '../project/includes';
import { project } from '../project';

export type CycleGeneratorOutput = CycleOutputDescriptor;

/**
 * Immutable, callback-free renderer prepared from an authenticated SiteBuild.
 * The handle and the renderer are captured together so callers cannot mix an
 * output catalog from one build with bytes rendered from another.
 */
export interface CycleGenerator {
  outputs(): CycleGeneratorOutput[];
  render(path: string): Promise<ContentRef>;
}

/**
 * Open exactly the `cycle-site/v2` contract. Contract validation, semantic-root
 * decoding, asset preload, LiquidJS policy, and renderer construction remain
 * behind this one seam.
 */
export async function openCycleGenerator(
  build: ClosedBuildHandle,
  rendererPackage: CycleRendererPackage,
  outputStore: WritableContentStore,
): Promise<CycleGenerator> {
  const site = await CycleSiteBuild.fromClosedBuild(build);
  const renderer = new CycleSiteRenderer(site, {
    content: createCycleContentRenderer(),
    includes,
    project,
  });
  const rendererCatalog = renderer.outputs().map((output): CycleGeneratorOutput => ({ ...output }));
  const catalog = [
    ...rendererCatalog,
    ...rendererPackage.outputs().map((output): CycleGeneratorOutput => ({
      ...output,
      kind: 'asset',
    })),
  ].sort((left, right) => compareText(left.file, right.file));
  for (let index = 1; index < catalog.length; index += 1) {
    if (catalog[index - 1].file === catalog[index].file) {
      throw new Error(
        `Cycle generator output collision at '${catalog[index].file}': `
        + `${catalog[index - 1].producer} and ${catalog[index].producer}`,
      );
    }
  }
  const frozenCatalog = Object.freeze(catalog.map((output) => Object.freeze({
    ...output,
    ...(output.subject ? { subject: Object.freeze({ ...output.subject }) } : {}),
  })));
  const rendered = new Map<string, ContentRef>();

  return Object.freeze({
    outputs: () => frozenCatalog.map((output) => ({
      ...output,
      ...(output.subject ? { subject: { ...output.subject } } : {}),
    })),
    render: async (path: string) => {
      const prior = rendered.get(path);
      if (prior) return prior;
      const descriptor = frozenCatalog.find((output) => output.file === path);
      if (!descriptor) throw new Error(`Cycle generator: no output '${path}'`);
      const packaged = rendererPackage.render(path);
      const output = packaged
        ? { file: path, mime: descriptor.mime, content: packaged }
        : renderer.render(path);
      const bytes = typeof output.content === 'string'
        ? new TextEncoder().encode(output.content)
        : output.content;
      const content = await outputStore.put(bytes, output.mime);
      if (content.mediaType !== output.mime) {
        throw new Error(`Cycle generator ContentStore changed media type for '${path}'`);
      }
      rendered.set(path, content);
      return content;
    },
  });
}
