/** Filesystem helpers for importing generator-owned scratch output into CAS. */
import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { compareUtf8 } from '../site-gen/core/order';

/** Deterministic regular-file walk used to declare externally generated extras. */
export async function listRegularOutputFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const visit = async (directory: string, prefix: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => compareUtf8(left.name, right.name));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const metadata = await lstat(path);
      if (metadata.isSymbolicLink()) {
        throw new Error(`Generated project output may not contain symlinks: ${relative}`);
      }
      if (metadata.isDirectory()) await visit(path, relative);
      else if (metadata.isFile()) files.push(relative);
      else throw new Error(`Generated project output is not a regular file: ${relative}`);
    }
  };
  await visit(root, '');
  files.sort(compareUtf8);
  return files;
}

export function mediaTypeForOutput(path: string): string {
  const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return ({
    css: 'text/css',
    csv: 'text/csv',
    gif: 'image/gif',
    html: 'text/html',
    ico: 'image/x-icon',
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    js: 'text/javascript',
    json: 'application/json',
    md: 'text/markdown',
    png: 'image/png',
    svg: 'image/svg+xml',
    txt: 'text/plain',
    ttf: 'font/ttf',
    webp: 'image/webp',
    woff: 'font/woff',
    woff2: 'font/woff2',
    zip: 'application/zip',
  } as Record<string, string>)[extension] || 'application/octet-stream';
}
