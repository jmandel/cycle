/** Node/Bun-only reader for a `fig prepare` filesystem CAS bundle. */
import { lstat, readFile, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ClosedBuildHandle } from './closed-build';
import type { ClosedSiteBuild, ContentRef, ContentStore } from './closed-build';

async function realDirectory(path: string, label: string): Promise<string> {
  const absolute = resolve(path);
  const stat = await lstat(absolute).catch(() => null);
  if (!stat?.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory, not a symlink: ${absolute}`);
  }
  return realpath(absolute);
}

async function regularFile(path: string, label: string): Promise<Uint8Array> {
  const stat = await lstat(path).catch(() => null);
  if (!stat) throw new Error(`${label} is missing: ${path}`);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file, not a symlink: ${path}`);
  }
  return new Uint8Array(await readFile(path));
}

/** Read-only object transport rooted at `<bundle>/objects/sha256`. */
export class FilesystemContentStore implements ContentStore {
  private constructor(private readonly objectRoot: string) {}

  static async open(buildDirectory: string): Promise<FilesystemContentStore> {
    const root = await realDirectory(buildDirectory, 'Fig build directory');
    const objects = await realDirectory(join(root, 'objects'), 'Fig objects directory');
    const sha256 = await realDirectory(join(objects, 'sha256'), 'Fig SHA-256 object directory');
    return new FilesystemContentStore(sha256);
  }

  async get(content: ContentRef): Promise<Uint8Array | null> {
    if (!/^[0-9a-f]{64}$/.test(content.sha256)) {
      throw new Error(`Unsafe SHA-256 object name: ${content.sha256}`);
    }
    const path = join(this.objectRoot, content.sha256);
    const stat = await lstat(path).catch(() => null);
    if (!stat) return null;
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`Fig CAS object must be a regular file, not a symlink: ${path}`);
    }
    return new Uint8Array(await readFile(path));
  }
}

/** Open and fully verify one bundle emitted by native `fig prepare`. */
export async function openFilesystemClosedBuild(buildDirectory: string): Promise<ClosedBuildHandle> {
  const root = await realDirectory(buildDirectory, 'Fig build directory');
  const manifestBytes = await regularFile(join(root, 'site-build.json'), 'Fig SiteBuild manifest');
  let manifest: ClosedSiteBuild;
  try {
    manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as ClosedSiteBuild;
  } catch (error) {
    throw new Error(`Invalid Fig SiteBuild manifest JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const store = await FilesystemContentStore.open(root);
  return ClosedBuildHandle.open(manifest, store, { verify: 'all-addressed' });
}
