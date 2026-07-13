import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, test } from 'bun:test';
import { AtomicOutputPublication } from './atomic-output';
import { renameDirectoryNoReplace } from './no-replace-rename';
import { serializeSiteOutput } from './output-receipt';
import {
  RUST_SITE_OUTPUT_BYTES,
  RUST_SITE_OUTPUT_RECEIPT,
} from './output-receipt.fixture';

async function tempWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cycle-publication-'));
  await mkdir(join(root, 'work', 'site-gen'), { recursive: true });
  return root;
}

test('atomic output rejects root, cwd, protected overlap, and symlink parents', async () => {
  const root = await tempWorkspace();
  const cwd = join(root, 'work');
  try {
    await expect(AtomicOutputPublication.create({ destination: '/', cwd })).rejects.toThrow('filesystem root');
    await expect(AtomicOutputPublication.create({ destination: '.', cwd })).rejects.toThrow('working tree');
    await expect(AtomicOutputPublication.create({ destination: '..', cwd })).rejects.toThrow('working tree');
    await expect(AtomicOutputPublication.create({
      destination: 'input/rendered', cwd, protectedPaths: ['input'],
    })).rejects.toThrow('overlaps protected');

    await mkdir(join(root, 'real-parent'));
    await symlink(join(root, 'real-parent'), join(cwd, 'linked-parent'));
    await expect(AtomicOutputPublication.create({ destination: 'linked-parent/site', cwd }))
      .rejects.toThrow('real directory');

    await mkdir(join(root, 'real-parent', 'source'));
    await symlink(join(root, 'real-parent', 'source'), join(cwd, 'protected-link'));
    await expect(AtomicOutputPublication.create({
      destination: join(root, 'real-parent', 'source', 'site'),
      cwd,
      protectedPaths: ['protected-link'],
    })).rejects.toThrow('overlaps protected');

    await symlink(join(root, 'real-parent'), join(cwd, 'site-gen', 'out'));
    await expect(AtomicOutputPublication.create({
      destination: 'site-gen/out', cwd, replaceExisting: true,
    })).rejects.toThrow('file or symlink');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('completed staging tree is invisible until atomic publication', async () => {
  const root = await tempWorkspace();
  const cwd = join(root, 'work');
  const destination = join(cwd, 'site-gen/out');
  try {
    const publication = await AtomicOutputPublication.create({ destination: 'site-gen/out', cwd });
    expect(() => publication.outputPath('../escape.html')).toThrow('Unsafe output name');
    await writeRustReceipt(publication);
    await publication.adoptFinalizedOutputReceipt();
    await expect(readFile(join(destination, 'index.html'), 'utf8')).rejects.toThrow();

    await publication.publish();
    expect(await readFile(join(destination, 'index.html'), 'utf8')).toBe('hello');
    expect((await readdir(join(cwd, 'site-gen'))).filter((name) => name.includes('.staging-'))).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('failed build cleanup leaves an existing output untouched', async () => {
  const root = await tempWorkspace();
  const cwd = join(root, 'work');
  const destination = join(cwd, 'site-gen/out');
  try {
    await mkdir(destination);
    await writeFile(join(destination, 'old.txt'), 'old');
    await expect(AtomicOutputPublication.create({ destination: 'site-gen/out', cwd }))
      .rejects.toThrow('Output already exists');

    const publication = await AtomicOutputPublication.create({
      destination: 'site-gen/out', cwd, replaceExisting: true,
    });
    await writeFile(publication.outputPath('new.txt'), 'new');
    await publication.abort();

    expect(await readFile(join(destination, 'old.txt'), 'utf8')).toBe('old');
    await expect(readFile(join(destination, 'new.txt'), 'utf8')).rejects.toThrow();
    expect((await readdir(dirname(destination))).filter((name) => name.includes('.staging-'))).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('explicit replacement retires the old tree only after completion', async () => {
  const root = await tempWorkspace();
  const cwd = join(root, 'work');
  const destination = join(cwd, 'site-gen/out');
  try {
    await mkdir(destination);
    await writeFile(join(destination, 'old.txt'), 'old');
    const publication = await AtomicOutputPublication.create({
      destination: 'site-gen/out', cwd, replaceExisting: true,
    });
    await writeRustReceipt(publication);
    await publication.adoptFinalizedOutputReceipt();
    expect(await readFile(join(destination, 'old.txt'), 'utf8')).toBe('old');

    await publication.publish();
    expect(await readFile(join(destination, 'index.html'), 'utf8')).toBe('hello');
    await expect(readFile(join(destination, 'old.txt'), 'utf8')).rejects.toThrow();
    expect((await readdir(dirname(destination))).filter((name) => name.includes('.previous-'))).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a destination created during staging is preserved and publication fails closed', async () => {
  const root = await tempWorkspace();
  const cwd = join(root, 'work');
  const destination = join(cwd, 'site-gen/out');
  try {
    const publication = await AtomicOutputPublication.create({ destination: 'site-gen/out', cwd });
    await writeRustReceipt(publication);
    await publication.adoptFinalizedOutputReceipt();
    await mkdir(destination);
    await writeFile(join(destination, 'intruder.txt'), 'intruder');

    await expect(publication.publish()).rejects.toThrow('appeared during the build');
    await publication.abort();
    expect(await readFile(join(destination, 'intruder.txt'), 'utf8')).toBe('intruder');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('native no-replace rename preserves even an empty destination directory', async () => {
  const root = await tempWorkspace();
  const source = join(root, 'source');
  const destination = join(root, 'destination');
  try {
    await mkdir(source);
    await writeFile(join(source, 'new.txt'), 'new');
    await mkdir(destination);
    await expect(renameDirectoryNoReplace(source, destination)).rejects.toThrow();
    expect(await readFile(join(source, 'new.txt'), 'utf8')).toBe('new');
    expect(await readdir(destination)).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function writeRustReceipt(publication: AtomicOutputPublication, includeOutput = true): Promise<void> {
  if (includeOutput) {
    await writeFile(publication.outputPath('index.html'), RUST_SITE_OUTPUT_BYTES);
  }
  await writeFile(
    publication.outputPath('site-output.json'),
    serializeSiteOutput(RUST_SITE_OUTPUT_RECEIPT),
  );
}

test('atomic publication refuses a tree without an adopted Rust receipt', async () => {
  const root = await tempWorkspace();
  const cwd = join(root, 'work');
  try {
    const publication = await AtomicOutputPublication.create({ destination: 'site-gen/out', cwd });
    await writeFile(publication.outputPath('index.html'), 'unsealed');
    await expect(publication.publish()).rejects.toThrow('requires an adopted Rust SiteOutput receipt');
    await publication.abort();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('atomic publication adopts and publishes the independently produced Rust receipt', async () => {
  const root = await tempWorkspace();
  const cwd = join(root, 'work');
  const destination = join(cwd, 'site-gen/out');
  try {
    const publication = await AtomicOutputPublication.create({ destination: 'site-gen/out', cwd });
    await writeRustReceipt(publication);
    expect(await publication.adoptFinalizedOutputReceipt()).toEqual(RUST_SITE_OUTPUT_RECEIPT);
    await publication.publish();
    expect(await readFile(join(destination, 'index.html'), 'utf8')).toBe('hello');
    expect(await readFile(join(destination, 'site-output.json'), 'utf8'))
      .toBe(serializeSiteOutput(RUST_SITE_OUTPUT_RECEIPT));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('receipt adoption rejects missing, extra, and symlinked staged outputs', async () => {
  for (const scenario of ['missing', 'extra', 'symlink'] as const) {
    const root = await tempWorkspace();
    const cwd = join(root, 'work');
    try {
      const publication = await AtomicOutputPublication.create({ destination: 'site-gen/out', cwd });
      if (scenario === 'symlink') {
        const source = join(root, 'outside.txt');
        await writeFile(source, RUST_SITE_OUTPUT_BYTES);
        await symlink(source, publication.outputPath('index.html'));
        await writeRustReceipt(publication, false);
      } else {
        await writeRustReceipt(publication, scenario !== 'missing');
        if (scenario === 'extra') await writeFile(publication.outputPath('extra.txt'), 'extra');
      }
      const expected = scenario === 'symlink' ? 'may not contain symlinks' : 'output tree mismatch';
      await expect(publication.adoptFinalizedOutputReceipt()).rejects.toThrow(expected);
      await publication.abort();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('publication re-verifies adopted bytes and rejects post-adoption corruption', async () => {
  const root = await tempWorkspace();
  const cwd = join(root, 'work');
  try {
    const publication = await AtomicOutputPublication.create({ destination: 'site-gen/out', cwd });
    await writeRustReceipt(publication);
    await publication.adoptFinalizedOutputReceipt();
    await writeFile(publication.outputPath('index.html'), 'corrupt');
    await expect(publication.publish()).rejects.toThrow('do not match');
    await publication.abort();
    await expect(readFile(join(cwd, 'site-gen/out/index.html'), 'utf8')).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
