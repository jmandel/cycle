/** Bun-only staging and publication for a completed static-site tree. */
import { randomUUID } from 'node:crypto';
import { lstat, mkdtemp, open, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, normalize, parse, relative, resolve } from 'node:path';
import { sealCycleOutputTree, verifyCycleOutputTree } from './output-receipt-node';
import type {
  CycleOutputDeclaration,
  CycleOutputReceipt,
  CycleRendererImplementation,
} from './output-receipt';
import { renameDirectoryNoReplace } from './no-replace-rename';

interface FileIdentity {
  dev: number;
  ino: number;
}

export interface AtomicOutputOptions {
  destination: string;
  /** Base for relative paths and a protected directory that output may not replace. */
  cwd?: string;
  /** Input/source paths that must not contain, or be contained by, the output. */
  protectedPaths?: readonly string[];
  /** Explicitly permit retiring one existing real output directory after staging succeeds. */
  replaceExisting?: boolean;
}

async function statOrNull(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function isWithin(parent: string, candidate: string): boolean {
  const rel = relative(parent, candidate);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function pathsOverlap(left: string, right: string): boolean {
  return isWithin(left, right) || isWithin(right, left);
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

async function requireCanonicalDirectory(path: string, label: string): Promise<FileIdentity> {
  const stat = await statOrNull(path);
  if (!stat?.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be an existing real directory, not a symlink: ${path}`);
  }
  const canonical = await realpath(path);
  if (canonical !== path) {
    throw new Error(`${label} traverses a symlink and is not safe for publication: ${path} -> ${canonical}`);
  }
  return { dev: stat.dev, ino: stat.ino };
}

/** Resolve one untrusted output name beneath an already validated tree root. */
export function safeOutputPath(root: string, name: string): string {
  const normalizedName = name.replace(/\\/g, '/');
  const parts = normalizedName.split('/');
  if (!normalizedName || normalizedName.startsWith('/') || parts.some((part) => !part || part === '..')) {
    throw new Error(`Unsafe output name: ${name}`);
  }
  const candidate = normalize(join(root, normalizedName));
  const rel = relative(root, candidate);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`Output path escapes output dir: ${name}`);
  return candidate;
}

/**
 * One private sibling staging tree that can be published only after all work
 * succeeds. Existing output is retired only under an explicit replacement
 * policy and only after the staged tree is complete.
 */
export class AtomicOutputPublication {
  readonly destination: string;
  readonly stagingDirectory: string;

  private readonly lockPath: string;
  private readonly initialDestination: FileIdentity | null;
  private readonly replaceExisting: boolean;
  private published = false;
  private closed = false;
  private sealedReceipt: CycleOutputReceipt | null = null;
  private sealedDeclarations: readonly CycleOutputDeclaration[] | null = null;

  private constructor(args: {
    destination: string;
    stagingDirectory: string;
    lockPath: string;
    initialDestination: FileIdentity | null;
    replaceExisting: boolean;
  }) {
    this.destination = args.destination;
    this.stagingDirectory = args.stagingDirectory;
    this.lockPath = args.lockPath;
    this.initialDestination = args.initialDestination;
    this.replaceExisting = args.replaceExisting;
  }

  static async create(options: AtomicOutputOptions): Promise<AtomicOutputPublication> {
    const requested = options.destination.trim();
    if (!requested || requested.includes('\0')) throw new Error('Output destination must be a non-empty filesystem path');

    const cwd = await realpath(resolve(options.cwd || process.cwd()));
    const destination = resolve(cwd, requested);
    if (destination === parse(destination).root) {
      throw new Error(`Refusing to publish a site at filesystem root: ${destination}`);
    }
    // A child output (the normal site-gen/out case) is fine. An output equal to
    // or above cwd could consume the source tree when replacement is enabled.
    if (isWithin(destination, cwd)) {
      throw new Error(`Output destination may not equal or contain the working tree: ${destination}`);
    }

    for (const protectedPath of options.protectedPaths || []) {
      if (!protectedPath.trim()) continue;
      const absolute = resolve(cwd, protectedPath);
      const protectedCandidates = [absolute];
      if (await statOrNull(absolute)) {
        const canonical = await realpath(absolute);
        if (canonical !== absolute) protectedCandidates.push(canonical);
      }
      const overlap = protectedCandidates.find((candidate) => pathsOverlap(destination, candidate));
      if (overlap) {
        throw new Error(`Output destination overlaps protected input/source path: ${destination} <-> ${overlap}`);
      }
    }

    const parent = dirname(destination);
    await requireCanonicalDirectory(parent, 'Output parent');

    const existing = await statOrNull(destination);
    let initialDestination: FileIdentity | null = null;
    if (existing) {
      if (!existing.isDirectory() || existing.isSymbolicLink()) {
        throw new Error(`Existing output must be a real directory, not a file or symlink: ${destination}`);
      }
      if ((await realpath(destination)) !== destination) {
        throw new Error(`Existing output traverses a symlink and is unsafe to replace: ${destination}`);
      }
      if (!options.replaceExisting) {
        throw new Error(
          `Output already exists: ${destination}. Remove it, choose a new OUT_DIR, `
            + 'or explicitly set SITE_GEN_REPLACE_OUTPUT=1 for a verified staged replacement.',
        );
      }
      initialDestination = { dev: existing.dev, ino: existing.ino };
    }

    const lockPath = join(parent, `.${basename(destination)}.publish.lock`);
    const lock = await open(lockPath, 'wx', 0o600).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new Error(`Another publication owns the output lock: ${lockPath}`);
      }
      throw error;
    });
    try {
      await writeFile(lock, `${JSON.stringify({ pid: process.pid, destination })}\n`);
      await lock.close();
    } catch (error) {
      await lock.close().catch(() => undefined);
      await rm(lockPath, { force: true });
      throw error;
    }

    let stagingDirectory: string | null = null;
    try {
      stagingDirectory = await mkdtemp(join(parent, `.${basename(destination)}.staging-`));
      await requireCanonicalDirectory(stagingDirectory, 'Output staging directory');
      return new AtomicOutputPublication({
        destination,
        stagingDirectory,
        lockPath,
        initialDestination,
        replaceExisting: options.replaceExisting === true,
      });
    } catch (error) {
      if (stagingDirectory) await rm(stagingDirectory, { recursive: true, force: true });
      await rm(lockPath, { force: true });
      throw error;
    }
  }

  outputPath(name: string): string {
    return safeOutputPath(this.stagingDirectory, name);
  }

  /**
   * Hash and seal the complete private tree. The receipt is written inside the
   * staging directory and is re-verified immediately before publication.
   */
  async sealOutputReceipt(options: {
    inputBuildId: string;
    renderer: CycleRendererImplementation;
    outputSchema?: string;
    options?: Readonly<Record<string, string>>;
    declarations: readonly CycleOutputDeclaration[];
  }): Promise<CycleOutputReceipt> {
    if (this.closed) throw new Error('Atomic output publication is already closed');
    if (this.sealedReceipt) throw new Error('Atomic output publication already has an output receipt');
    const declarations = options.declarations.map((declaration) => ({
      ...declaration,
      producer: { ...declaration.producer },
    }));
    const receipt = await sealCycleOutputTree({
      root: this.stagingDirectory,
      inputBuildId: options.inputBuildId,
      renderer: options.renderer,
      outputSchema: options.outputSchema,
      options: options.options,
      declarations,
    });
    this.sealedDeclarations = declarations;
    this.sealedReceipt = receipt;
    return receipt;
  }

  private async assertDestinationUnchanged(): Promise<void> {
    const current = await statOrNull(this.destination);
    if (!this.initialDestination) {
      if (current) throw new Error(`Output destination appeared during the build: ${this.destination}`);
      return;
    }
    if (!current?.isDirectory() || current.isSymbolicLink()) {
      throw new Error(`Existing output changed type during the build: ${this.destination}`);
    }
    if (!sameIdentity(this.initialDestination, { dev: current.dev, ino: current.ino })) {
      throw new Error(`Existing output was replaced during the build: ${this.destination}`);
    }
  }

  /**
   * Publish the complete staging tree. Generic callers may intentionally use
   * this primitive without a receipt; when `sealOutputReceipt()` was called,
   * publication always re-verifies the seal. Native Cycle always seals.
   */
  async publish(): Promise<void> {
    if (this.closed) throw new Error('Atomic output publication is already closed');
    if (this.sealedReceipt && this.sealedDeclarations) {
      await verifyCycleOutputTree({
        root: this.stagingDirectory,
        declarations: this.sealedDeclarations,
        expected: this.sealedReceipt,
      });
    }
    await this.assertDestinationUnchanged();

    let backup: string | null = null;
    try {
      if (this.initialDestination) {
        if (!this.replaceExisting) throw new Error('Existing output replacement was not authorized');
        backup = join(dirname(this.destination), `.${basename(this.destination)}.previous-${randomUUID()}`);
        if (await statOrNull(backup)) throw new Error(`Refusing to overwrite publication backup: ${backup}`);
        await renameDirectoryNoReplace(this.destination, backup);
        // `assertDestinationUnchanged` and the rename cannot be one syscall. A
        // non-cooperating writer could replace the source path between them,
        // causing an unrelated tree to be moved to `backup`. Rename preserves
        // inode identity, so validate the object that actually moved before we
        // publish or ever delete it. The catch path restores it when possible
        // and otherwise deliberately leaves the named backup for recovery.
        const retired = await statOrNull(backup);
        if (
          !retired?.isDirectory()
          || retired.isSymbolicLink()
          || !sameIdentity(this.initialDestination, { dev: retired.dev, ino: retired.ino })
        ) {
          throw new Error(
            `Existing output was replaced while being retired; publication stopped and the moved tree is at ${backup}`,
          );
        }
      }

      // The destination is absent here. rename publishes the already-complete
      // same-filesystem sibling tree as one atomic directory operation.
      if (await statOrNull(this.destination)) {
        throw new Error(`Output destination appeared before atomic publication: ${this.destination}`);
      }
      await renameDirectoryNoReplace(this.stagingDirectory, this.destination);
      this.published = true;
      this.closed = true;
      // Publication has committed once the completed staging tree is live.
      // Failure to remove the retired tree must not turn that success into a
      // reported transactional failure; a later housekeeping pass may remove
      // an orphaned hidden backup.
      if (backup) await rm(backup, { recursive: true, force: true }).catch(() => undefined);
    } catch (error) {
      if (backup && !(await statOrNull(this.destination)) && (await statOrNull(backup))) {
        try {
          await renameDirectoryNoReplace(backup, this.destination);
          backup = null;
        } catch (rollbackError) {
          throw new AggregateError(
            [error, rollbackError],
            `Publication failed and the previous output could not be restored; it remains at ${backup}`,
          );
        }
      }
      throw error;
    } finally {
      // Likewise, lock cleanup is post-commit housekeeping once `closed` is
      // true. Never report a failed publication after the destination is live.
      if (this.closed) await rm(this.lockPath, { force: true }).catch(() => undefined);
    }
  }

  /** Remove an unpublished staging tree and release its cooperative lock. */
  async abort(): Promise<void> {
    if (this.published) return;
    await rm(this.stagingDirectory, { recursive: true, force: true });
    await rm(this.lockPath, { force: true });
    this.closed = true;
  }
}
