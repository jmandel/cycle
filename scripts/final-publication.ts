/** Helpers for composing a project wrapper around one verified Cycle output. */
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  CYCLE_OUTPUT_RECEIPT_PATH,
  serializeCycleOutputReceipt,
  validateCycleOutputReceipt,
  type CycleOutputDeclaration,
  type CycleOutputReceipt,
  type CycleOutputReceiptFile,
} from '../site-gen/core/output-receipt';
import { verifyCycleOutputTree } from '../site-gen/core/output-receipt-node';
import { compareUtf8 } from '../site-gen/core/order';

/** Drop the content identity fields while preserving the receipt's provenance. */
export function declarationFromReceiptFile(file: CycleOutputReceiptFile): CycleOutputDeclaration {
  return {
    path: file.path,
    mediaType: file.mediaType,
    producer: { ...file.producer },
    ...(file.source === undefined ? {} : { source: file.source }),
    ...(file.owner === undefined ? {} : { owner: file.owner }),
  };
}

/** Read and fully verify a sealed native output tree. */
export async function readVerifiedOutputReceipt(root: string): Promise<CycleOutputReceipt> {
  const serialized = await readFile(join(root, CYCLE_OUTPUT_RECEIPT_PATH), 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch (error) {
    throw new Error(`Invalid inherited Cycle output receipt: ${error instanceof Error ? error.message : String(error)}`);
  }
  const receipt = await validateCycleOutputReceipt(parsed);
  if (serialized !== serializeCycleOutputReceipt(receipt)) {
    throw new Error('Inherited Cycle output receipt is not in canonical form');
  }
  await verifyCycleOutputTree({
    root,
    declarations: receipt.files.map(declarationFromReceiptFile),
    expected: receipt,
  });
  return receipt;
}

async function requireRegularFile(path: string, label: string): Promise<void> {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`${label} is not a regular, non-symlink file: ${path}`);
  }
}

/**
 * Verify an inner Cycle publication and copy only its declared files into a fresh
 * outer staging tree. The inner receipt is intentionally not copied: the outer
 * publication will receive one complete receipt after project extras are added.
 */
export async function copyVerifiedOutput(
  sourceRoot: string,
  destinationRoot: string,
): Promise<{ receipt: CycleOutputReceipt; declarations: CycleOutputDeclaration[] }> {
  const receipt = await readVerifiedOutputReceipt(sourceRoot);
  const declarations = receipt.files.map(declarationFromReceiptFile);
  for (const declaration of declarations) {
    const source = join(sourceRoot, declaration.path);
    const destination = join(destinationRoot, declaration.path);
    await requireRegularFile(source, 'Inherited Cycle output');
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination, constants.COPYFILE_EXCL);
  }
  return { receipt, declarations };
}

export async function receiptFileMatches(
  root: string,
  expected: CycleOutputReceiptFile,
): Promise<boolean> {
  const path = join(root, expected.path);
  try {
    await requireRegularFile(path, 'Inherited Cycle output');
    const bytes = await readFile(path);
    return bytes.byteLength === expected.byteLength
      && createHash('sha256').update(bytes).digest('hex') === expected.sha256;
  } catch {
    return false;
  }
}

/** Prove that every inherited file except explicit wrapper transformations kept its bytes. */
export async function assertInheritedFilesUnchanged(
  root: string,
  receipt: CycleOutputReceipt,
  transformedPaths: ReadonlySet<string> = new Set(),
): Promise<void> {
  for (const file of receipt.files) {
    if (transformedPaths.has(file.path)) continue;
    if (!await receiptFileMatches(root, file)) {
      throw new Error(`Project wrapper changed inherited Cycle output '${file.path}'`);
    }
  }
}

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
