import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, test } from 'bun:test';
import { AtomicOutputPublication } from './atomic-output';
import { renameDirectoryNoReplace } from './no-replace-rename';
import { CYCLE_OUTPUT_RECEIPT_PATH, validateCycleOutputReceipt } from './output-receipt';

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
    await writeFile(publication.outputPath('index.html'), 'complete');
    await expect(readFile(join(destination, 'index.html'), 'utf8')).rejects.toThrow();

    await publication.publish();
    expect(await readFile(join(destination, 'index.html'), 'utf8')).toBe('complete');
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
    await writeFile(publication.outputPath('new.txt'), 'new');
    expect(await readFile(join(destination, 'old.txt'), 'utf8')).toBe('old');

    await publication.publish();
    expect(await readFile(join(destination, 'new.txt'), 'utf8')).toBe('new');
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
    await writeFile(publication.outputPath('new.txt'), 'new');
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

const receiptIdentity = {
  inputBuildId: `sb1-sha256:${'a'.repeat(64)}`,
  renderer: { id: 'cycle-site', version: '1' },
} as const;

test('sealed atomic publication emits and verifies a non-recursive output receipt', async () => {
  const root = await tempWorkspace();
  const cwd = join(root, 'work');
  const destination = join(cwd, 'site-gen/out');
  try {
    const publication = await AtomicOutputPublication.create({ destination: 'site-gen/out', cwd });
    await writeFile(publication.outputPath('index.html'), 'complete');
    const receipt = await publication.sealOutputReceipt({
      ...receiptIdentity,
      declarations: [{
        path: 'index.html',
        mediaType: 'text/html',
        producer: { id: 'cycle-site', version: '1' },
        source: 'fixture page',
      }],
    });
    expect(receipt.files.map((file) => file.path)).toEqual(['index.html']);
    expect(receipt.files.some((file) => file.path === CYCLE_OUTPUT_RECEIPT_PATH)).toBe(false);
    await publication.publish();

    const written = await validateCycleOutputReceipt(JSON.parse(
      await readFile(join(destination, CYCLE_OUTPUT_RECEIPT_PATH), 'utf8'),
    ));
    expect(written.outputBuildId).toBe(receipt.outputBuildId);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('receipt sealing rejects missing and extra staged outputs', async () => {
  for (const scenario of ['missing', 'extra'] as const) {
    const root = await tempWorkspace();
    const cwd = join(root, 'work');
    try {
      const publication = await AtomicOutputPublication.create({ destination: 'site-gen/out', cwd });
      if (scenario === 'extra') await writeFile(publication.outputPath('extra.txt'), 'extra');
      await expect(publication.sealOutputReceipt({
        ...receiptIdentity,
        declarations: scenario === 'missing' ? [{
          path: 'missing.txt',
          mediaType: 'text/plain',
          producer: { id: 'fixture' },
        }] : [],
      })).rejects.toThrow('output tree mismatch');
      await publication.abort();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('receipt sealing rejects a symlinked staged output', async () => {
  const root = await tempWorkspace();
  const cwd = join(root, 'work');
  try {
    const publication = await AtomicOutputPublication.create({ destination: 'site-gen/out', cwd });
    const source = join(root, 'source.txt');
    await writeFile(source, 'outside');
    await symlink(source, publication.outputPath('linked.txt'));
    await expect(publication.sealOutputReceipt({
      ...receiptIdentity,
      declarations: [{
        path: 'linked.txt',
        mediaType: 'text/plain',
        producer: { id: 'fixture' },
      }],
    })).rejects.toThrow('may not contain symlinks');
    await publication.abort();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('publication re-verifies sealed bytes and rejects post-receipt corruption', async () => {
  const root = await tempWorkspace();
  const cwd = join(root, 'work');
  try {
    const publication = await AtomicOutputPublication.create({ destination: 'site-gen/out', cwd });
    await writeFile(publication.outputPath('index.html'), 'complete');
    await publication.sealOutputReceipt({
      ...receiptIdentity,
      declarations: [{
        path: 'index.html',
        mediaType: 'text/html',
        producer: { id: 'fixture' },
      }],
    });
    await writeFile(publication.outputPath('index.html'), 'corrupt');
    await expect(publication.publish()).rejects.toThrow("does not match its receipt");
    await publication.abort();
    await expect(readFile(join(cwd, 'site-gen/out/index.html'), 'utf8')).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
