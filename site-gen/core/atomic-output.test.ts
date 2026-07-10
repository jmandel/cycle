import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, test } from 'bun:test';
import { AtomicOutputPublication } from './atomic-output';

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
