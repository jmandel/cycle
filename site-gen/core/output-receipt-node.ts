/** Node/Bun-only filesystem adapter for the browser-compatible receipt core. */
import { lstat, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { compareUtf8 } from './order';
import {
  CYCLE_OUTPUT_RECEIPT_PATH,
  CYCLE_OUTPUT_RECEIPT_SCHEMA,
  assertCycleOutputPath,
  createCycleOutputReceipt,
  serializeCycleOutputReceipt,
  validateCycleOutputReceipt,
  verifyCycleOutputReceipt,
  type CycleOutputDeclaration,
  type CycleOutputMaterial,
  type CycleOutputReceipt,
  type CycleProducerIdentity,
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
    if (declaration.path === CYCLE_OUTPUT_RECEIPT_PATH) {
      throw new Error(`Cycle output declaration collides with reserved receipt path '${CYCLE_OUTPUT_RECEIPT_PATH}'`);
    }
    result.set(declaration.path, declaration);
  }
  return result;
}

async function readDeclaredTree(
  root: string,
  declarations: readonly CycleOutputDeclaration[],
  receiptExpected: boolean,
): Promise<CycleOutputMaterial[]> {
  const byPath = declarationMap(declarations);
  const actual = await listRegularFiles(root);
  const allowedActual = actual.filter((path) => path !== CYCLE_OUTPUT_RECEIPT_PATH);
  const receiptPresent = actual.includes(CYCLE_OUTPUT_RECEIPT_PATH);
  if (receiptPresent !== receiptExpected) {
    throw new Error(
      receiptExpected
        ? `Cycle output receipt file is missing: ${CYCLE_OUTPUT_RECEIPT_PATH}`
        : `Cycle output receipt path already exists before sealing: ${CYCLE_OUTPUT_RECEIPT_PATH}`,
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

/** Hash every declared staged file, then write the non-recursive receipt file. */
export async function sealCycleOutputTree(options: {
  root: string;
  inputBuildId: string;
  renderer: CycleProducerIdentity;
  declarations: readonly CycleOutputDeclaration[];
}): Promise<CycleOutputReceipt> {
  const outputs = await readDeclaredTree(options.root, options.declarations, false);
  const receipt = await createCycleOutputReceipt({
    inputBuildId: options.inputBuildId,
    renderer: options.renderer,
    outputs,
  });
  await writeFile(join(options.root, CYCLE_OUTPUT_RECEIPT_PATH), serializeCycleOutputReceipt(receipt), {
    encoding: 'utf8',
    flag: 'wx',
  });
  await verifyCycleOutputTree({ root: options.root, declarations: options.declarations, expected: receipt });
  return receipt;
}

/** Re-read the receipt and every output byte; reject missing, extra, or changed files. */
export async function verifyCycleOutputTree(options: {
  root: string;
  declarations: readonly CycleOutputDeclaration[];
  expected?: CycleOutputReceipt;
}): Promise<CycleOutputReceipt> {
  const serialized = await readFile(join(options.root, CYCLE_OUTPUT_RECEIPT_PATH), 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch (error) {
    throw new Error(`Invalid Cycle output receipt JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const receipt = await validateCycleOutputReceipt(parsed);
  if (serialized !== serializeCycleOutputReceipt(receipt)) {
    throw new Error(`Cycle output receipt file is not in canonical ${CYCLE_OUTPUT_RECEIPT_SCHEMA} form`);
  }
  if (options.expected && receipt.outputBuildId !== options.expected.outputBuildId) {
    throw new Error(
      `Cycle output receipt changed after sealing: ${receipt.outputBuildId} != ${options.expected.outputBuildId}`,
    );
  }
  const outputs = await readDeclaredTree(options.root, options.declarations, true);
  await verifyCycleOutputReceipt(receipt, outputs);
  return receipt;
}
