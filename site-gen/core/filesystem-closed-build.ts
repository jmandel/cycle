/** Node/Bun-only reader for a `fig prepare` filesystem CAS bundle. */
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, realpath, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ClosedBuildHandle } from './closed-build';
import type {
  ClosedSiteBuild,
  ContentRef,
  WritableContentStore,
} from './closed-build';
import { renameFileNoReplace } from './no-replace-rename';

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

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
export class FilesystemContentStore implements WritableContentStore {
  private constructor(private readonly objectRoot: string) {}

  static async open(buildDirectory: string): Promise<FilesystemContentStore> {
    const root = await realDirectory(buildDirectory, 'Fig build directory');
    const objects = await realDirectory(join(root, 'objects'), 'Fig objects directory');
    const sha256 = await realDirectory(join(objects, 'sha256'), 'Fig SHA-256 object directory');
    return new FilesystemContentStore(sha256);
  }

  static async create(objectRoot: string): Promise<FilesystemContentStore> {
    await mkdir(objectRoot, { recursive: true });
    return new FilesystemContentStore(await realDirectory(objectRoot, 'ContentStore object root'));
  }

  static async openObjectRoot(objectRoot: string): Promise<FilesystemContentStore> {
    return new FilesystemContentStore(await realDirectory(objectRoot, 'ContentStore object root'));
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
    const bytes = new Uint8Array(await readFile(path));
    if (bytes.byteLength !== content.byteLength || await sha256(bytes) !== content.sha256) {
      throw new Error(`ContentStore object does not match ${content.sha256}`);
    }
    return bytes;
  }

  async put(bytes: Uint8Array, mediaType: string): Promise<ContentRef & { mediaType: string }> {
    const content: ContentRef & { mediaType: string } = {
      sha256: await sha256(bytes),
      byteLength: bytes.byteLength,
      mediaType,
    };
    const path = join(this.objectRoot, content.sha256);
    const existing = await this.get(content);
    if (existing) return content;
    const temporary = join(this.objectRoot, `.content-${content.sha256}-${randomUUID()}.tmp`);
    const file = await open(temporary, 'wx', 0o600);
    try {
      await file.writeFile(bytes);
      await file.sync();
    } finally {
      await file.close();
    }
    let published = false;
    try {
      await renameFileNoReplace(temporary, path);
      published = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    } finally {
      await rm(temporary, { force: true });
    }
    if (published && process.platform !== 'win32') {
      const directory = await open(this.objectRoot, 'r');
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    }
    const verified = await this.get(content);
    if (!verified) throw new Error(`ContentStore failed to publish ${content.sha256}`);
    return content;
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
