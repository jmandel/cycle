/** Node/Bun-only filesystem adapter for the browser-compatible receipt core. */
import { lstat, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { compareUtf8 } from './order';
import {
  SITE_OUTPUT_MANIFEST_PATH,
  SITE_OUTPUT_SCHEMA,
  assertCycleOutputPath,
  serializeSiteOutput,
  validateSiteOutput,
  verifySiteOutput,
  type CycleOutputDeclaration,
  type SiteOutput,
  type SiteOutputMaterial,
} from './output-receipt';

async function listRegularFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const visit = async (directory: string, prefix: string): Promise<void> => {
    const children = await readdir(directory);
    children.sort(compareUtf8);
    for (const child of children) {
      const path = join(directory, child);
      const relative = prefix ? `${prefix}/${child}` : child;
      const metadata = await lstat(path);
      if (metadata.isSymbolicLink()) {
        throw new Error(`Cycle output tree may not contain symlinks: ${relative}`);
      }
      if (metadata.isDirectory()) {
        await visit(path, relative);
      } else if (metadata.isFile()) {
        files.push(relative);
      } else {
        throw new Error(`Cycle output tree member is not a regular file: ${relative}`);
      }
    }
  };
  await visit(root, '');
  files.sort(compareUtf8);
  return files;
}

function declarationMap(declarations: readonly CycleOutputDeclaration[]): Map<string, CycleOutputDeclaration> {
  const result = new Map<string, CycleOutputDeclaration>();
  for (const declaration of declarations) {
    assertCycleOutputPath(declaration.path, 'Cycle output declaration path');
    if (result.has(declaration.path)) throw new Error(`Duplicate Cycle output declaration '${declaration.path}'`);
    if (declaration.path === SITE_OUTPUT_MANIFEST_PATH) {
      throw new Error(`Cycle output declaration collides with reserved SiteOutput path '${SITE_OUTPUT_MANIFEST_PATH}'`);
    }
    result.set(declaration.path, declaration);
  }
  return result;
}

async function readDeclaredTree(
  root: string,
  declarations: readonly CycleOutputDeclaration[],
  receiptExpected: boolean,
): Promise<SiteOutputMaterial[]> {
  const byPath = declarationMap(declarations);
  const actual = await listRegularFiles(root);
  const allowedActual = actual.filter((path) => path !== SITE_OUTPUT_MANIFEST_PATH);
  const receiptPresent = actual.includes(SITE_OUTPUT_MANIFEST_PATH);
  if (receiptPresent !== receiptExpected) {
    throw new Error(
      receiptExpected
        ? `SiteOutput file is missing: ${SITE_OUTPUT_MANIFEST_PATH}`
        : `SiteOutput path already exists before sealing: ${SITE_OUTPUT_MANIFEST_PATH}`,
    );
  }
  const missing = [...byPath.keys()].filter((path) => !allowedActual.includes(path)).sort(compareUtf8);
  const extra = allowedActual.filter((path) => !byPath.has(path)).sort(compareUtf8);
  if (missing.length || extra.length) {
    throw new Error(`Cycle output tree mismatch; missing=[${missing.join(', ')}], extra=[${extra.join(', ')}]`);
  }
  return Promise.all([...byPath.entries()]
    .sort(([left], [right]) => compareUtf8(left, right))
    .map(async ([path, declaration]) => {
      const absolute = join(root, path);
      const metadata = await lstat(absolute);
      if (!metadata.isFile() || metadata.isSymbolicLink()) {
        throw new Error(`Cycle declared output is not a regular file: ${path}`);
      }
      return {
        ...declaration,
        content: new Uint8Array(await readFile(absolute)),
      };
    }));
}

/** Re-read the receipt and every output byte; reject missing, extra, or changed files. */
export async function verifySiteOutputTree(options: {
  root: string;
  declarations: readonly CycleOutputDeclaration[];
  expected?: SiteOutput;
}): Promise<SiteOutput> {
  const serialized = await readFile(join(options.root, SITE_OUTPUT_MANIFEST_PATH), 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch (error) {
    throw new Error(`Invalid Cycle output receipt JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const output = await validateSiteOutput(parsed);
  if (serialized !== serializeSiteOutput(output)) {
    throw new Error(`SiteOutput file is not in canonical ${SITE_OUTPUT_SCHEMA} form`);
  }
  if (options.expected && output.outputId !== options.expected.outputId) {
    throw new Error(
      `SiteOutput changed after sealing: ${output.outputId} != ${options.expected.outputId}`,
    );
  }
  const outputs = await readDeclaredTree(options.root, options.declarations, true);
  await verifySiteOutput(output, outputs);
  return output;
}
