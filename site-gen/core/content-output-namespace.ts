/** Private CAS-backed composition for a completed renderer namespace. */
import { compareUtf8 } from './order';
import type { WritableContentStore } from './closed-build';
import {
  assertCycleOutputPath,
  type CycleOutputDeclaration,
  type SiteOutput,
  type SiteOutputFile,
} from './output-receipt';

export interface VerifiedOutputSet {
  receipt: SiteOutput;
  store: WritableContentStore;
}

function copyFile(file: SiteOutputFile): SiteOutputFile {
  return {
    path: file.path,
    content: { ...file.content },
    producer: { ...file.producer },
    ...(file.source === undefined ? {} : { source: file.source }),
    ...(file.owner === undefined ? {} : { owner: file.owner }),
  };
}

function validateDeclaration(declaration: CycleOutputDeclaration): void {
  assertCycleOutputPath(declaration.path, 'Composed output path');
  if (!declaration.mediaType.trim()) throw new Error(`Output '${declaration.path}' has no media type`);
  if (!declaration.producer.id.trim() || !declaration.producer.version.trim()) {
    throw new Error(`Output '${declaration.path}' has an invalid producer`);
  }
  if (declaration.owner !== undefined) assertCycleOutputPath(declaration.owner, 'Output owner');
}

export class ContentOutputNamespace {
  private readonly files = new Map<string, SiteOutputFile>();

  private constructor(
    readonly inputBuildId: string,
    readonly store: WritableContentStore,
  ) {}

  static inherit(base: VerifiedOutputSet): ContentOutputNamespace {
    const namespace = new ContentOutputNamespace(base.receipt.inputBuildId, base.store);
    for (const file of base.receipt.files) {
      if (namespace.files.has(file.path)) throw new Error(`Inherited output repeats '${file.path}'`);
      namespace.files.set(file.path, copyFile(file));
    }
    return namespace;
  }

  has(path: string): boolean {
    return this.files.has(path);
  }

  paths(): string[] {
    return [...this.files.keys()].sort(compareUtf8);
  }

  file(path: string): SiteOutputFile | undefined {
    const file = this.files.get(path);
    return file ? copyFile(file) : undefined;
  }

  async read(path: string): Promise<Uint8Array> {
    const file = this.files.get(path);
    if (!file) throw new Error(`No composed output '${path}'`);
    const bytes = await this.store.get(file.content);
    if (!bytes) throw new Error(`ContentStore is missing composed output '${path}'`);
    return bytes;
  }

  async readText(path: string): Promise<string> {
    return new TextDecoder().decode(await this.read(path));
  }

  async add(
    declaration: CycleOutputDeclaration,
    content: string | Uint8Array,
  ): Promise<SiteOutputFile> {
    validateDeclaration(declaration);
    if (this.files.has(declaration.path)) {
      throw new Error(`Composed output collision at '${declaration.path}'`);
    }
    return this.put(declaration, content);
  }

  async replace(
    path: string,
    declaration: CycleOutputDeclaration,
    content: string | Uint8Array,
  ): Promise<SiteOutputFile> {
    if (!this.files.has(path)) throw new Error(`Cannot replace missing output '${path}'`);
    if (declaration.path !== path) throw new Error(`Replacement path '${declaration.path}' does not match '${path}'`);
    validateDeclaration(declaration);
    return this.put(declaration, content);
  }

  completedFiles(): SiteOutputFile[] {
    const paths = new Set(this.files.keys());
    for (const file of this.files.values()) {
      if (file.owner !== undefined && !paths.has(file.owner)) {
        throw new Error(`Output '${file.path}' names missing owner '${file.owner}'`);
      }
    }
    return this.paths().map((path) => copyFile(this.files.get(path)!));
  }

  private async put(
    declaration: CycleOutputDeclaration,
    content: string | Uint8Array,
  ): Promise<SiteOutputFile> {
    const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : new Uint8Array(content);
    const reference = await this.store.put(bytes, declaration.mediaType);
    if (reference.mediaType !== declaration.mediaType) {
      throw new Error(`ContentStore changed media type for '${declaration.path}'`);
    }
    const file: SiteOutputFile = {
      path: declaration.path,
      content: { ...reference, mediaType: declaration.mediaType },
      producer: { ...declaration.producer },
      ...(declaration.source === undefined ? {} : { source: declaration.source }),
      ...(declaration.owner === undefined ? {} : { owner: declaration.owner }),
    };
    this.files.set(file.path, file);
    return copyFile(file);
  }
}
