/** Native preparation of Cycle's content-addressed renderer package. */
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { posix } from 'node:path';
import type { ContentRef } from './core/closed-build';
import {
  computeCycleRendererPackageId,
  CycleRendererPackage,
  type CycleRendererPackageFile,
  type CycleRendererPackageManifest,
} from './core/renderer-package';
import { compareText } from './core/order';

interface NativeRendererPackageOptions {
  designDirectory: string;
  projectCss: string;
  clientEntry: string;
}

function mediaType(path: string): string {
  const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return ({
    css: 'text/css', gif: 'image/gif', ico: 'image/x-icon', jpeg: 'image/jpeg', jpg: 'image/jpeg',
    js: 'text/javascript', png: 'image/png', svg: 'image/svg+xml', ttf: 'font/ttf', webp: 'image/webp',
    woff: 'font/woff', woff2: 'font/woff2',
  } as Record<string, string>)[extension] || 'application/octet-stream';
}

function regularTree(root: string, outputRoot: string, producer: string): Array<{
  path: string;
  producer: string;
  bytes: Uint8Array;
}> {
  const result: Array<{ path: string; producer: string; bytes: Uint8Array }> = [];
  const visit = (source: string, relative: string): void => {
    const metadata = lstatSync(source);
    if (metadata.isSymbolicLink()) throw new Error(`Cycle renderer package source may not be a symlink: ${source}`);
    if (metadata.isDirectory()) {
      for (const child of readdirSync(source).sort(compareText)) {
        visit(`${source}/${child}`, relative ? `${relative}/${child}` : child);
      }
      return;
    }
    if (!metadata.isFile()) throw new Error(`Cycle renderer package source is not a regular file: ${source}`);
    result.push({
      path: outputRoot ? posix.join(outputRoot, relative) : relative,
      producer: `${producer} ${relative}`,
      bytes: new Uint8Array(readFileSync(source)),
    });
  };
  visit(root, '');
  return result;
}

export async function prepareNativeCycleRendererPackage(
  options: NativeRendererPackageOptions,
): Promise<CycleRendererPackage> {
  const bundle = await Bun.build({
    entrypoints: [options.clientEntry],
    target: 'browser',
    minify: true,
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  if (!bundle.success || bundle.outputs.length !== 1) {
    const messages = bundle.logs.map((entry) => entry.message).join('; ');
    throw new Error(`Cycle client bundle failed${messages ? `: ${messages}` : ''}`);
  }
  const inputs = [
    ...regularTree(`${options.designDirectory}/styles`, 'assets/cycle', 'Cycle design style'),
    ...regularTree(`${options.designDirectory}/fonts`, 'assets/fonts', 'Cycle design font'),
    ...regularTree(`${options.designDirectory}/assets`, 'assets', 'Cycle design asset'),
    { path: 'assets/project.css', producer: 'Cycle project stylesheet', bytes: new Uint8Array(readFileSync(options.projectCss)) },
    {
      path: 'assets/app.js',
      producer: 'Cycle browser application bundle',
      bytes: new Uint8Array(await bundle.outputs[0].arrayBuffer()),
    },
  ].sort((left, right) => compareText(left.path, right.path));
  const bodies = new Map<string, Uint8Array>();
  const files: CycleRendererPackageFile[] = inputs.map((input) => {
    const digest = createHash('sha256').update(input.bytes).digest('hex');
    const content: ContentRef = {
      sha256: digest,
      byteLength: input.bytes.byteLength,
      mediaType: mediaType(input.path),
    };
    bodies.set(digest, input.bytes);
    return { path: input.path, mediaType: content.mediaType!, producer: input.producer, content };
  });
  const manifest: CycleRendererPackageManifest = {
    schemaVersion: 'cycle-renderer-package/v1',
    packageId: await computeCycleRendererPackageId(files),
    files,
  };
  return CycleRendererPackage.open(manifest, {
    get: async (content) => bodies.get(content.sha256) || null,
  });
}
