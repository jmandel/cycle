import { createHash } from 'node:crypto';
import type { ContentRef } from './closed-build';
import {
  computeCycleRendererPackageId,
  CycleRendererPackage,
  type CycleRendererPackageFile,
  type CycleRendererPackageManifest,
} from './renderer-package';
import { compareUtf8 } from './order';

export async function fixtureRendererPackage(): Promise<CycleRendererPackage> {
  const values = [
    ['assets/app.js', 'text/javascript', 'fixture client', 'document.documentElement.classList.add("js");'],
    ['assets/cycle/base.css', 'text/css', 'fixture design', 'html{color:#111}'],
    ['assets/cycle-mark.svg', 'image/svg+xml', 'fixture mark', '<svg/>'],
    ['assets/fonts/fixture.woff2', 'font/woff2', 'fixture font', 'font'],
    ['assets/project.css', 'text/css', 'fixture project', '.project{}'],
  ] as const;
  const bodies = new Map<string, Uint8Array>();
  const files: CycleRendererPackageFile[] = values.map(([path, mediaType, producer, source]) => {
    const bytes = new TextEncoder().encode(source);
    const content: ContentRef = {
      sha256: createHash('sha256').update(bytes).digest('hex'),
      byteLength: bytes.byteLength,
      mediaType,
    };
    bodies.set(content.sha256, bytes);
    return { path, mediaType, producer, content };
  }).sort((left, right) => compareUtf8(left.path, right.path));
  const manifest: CycleRendererPackageManifest = {
    schemaVersion: 'cycle-renderer-package/v1',
    packageId: await computeCycleRendererPackageId(files),
    files,
  };
  return CycleRendererPackage.open(manifest, { get: async (content) => bodies.get(content.sha256) || null });
}
