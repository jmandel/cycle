#!/usr/bin/env bun
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type Json = Record<string, any>;

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SUSHI_PROJECT = resolve(ROOT, Bun.env.SUSHI_PROJECT || '.');
const SUSHI_OUT = resolve(ROOT, Bun.env.SUSHI_OUT || SUSHI_PROJECT);
const LABEL = Bun.env.PUBLISHER_SMOKE_LABEL || (SUSHI_PROJECT === ROOT ? 'cycle' : basename(SUSHI_PROJECT));
const OUT_DIR = resolve(ROOT, Bun.env.PUBLISHER_BLANK_CACHE_OUT_DIR || `temp/site-gen/blank-cache-${LABEL}`);
const EXPECTED_DB = resolve(ROOT, Bun.env.EXPECTED_DB || join(SUSHI_PROJECT, 'output/package.db'));
const CACHE_ROOT = mkdtempSync(join(tmpdir(), `${LABEL}-fhir-cache-`));

function run(label: string, args: string[], env: Record<string, string>) {
  console.log(`\n== ${label}`);
  const proc = Bun.spawnSync(args, {
    cwd: ROOT,
    env: { ...Bun.env, ...env },
    stdout: 'inherit',
    stderr: 'inherit',
  });
  if (!proc.success) throw new Error(`${label} failed with exit code ${proc.exitCode}`);
}

function optionalEnv(name: string, value: string | undefined): Record<string, string> {
  return value ? { [name]: value } : {};
}

function readJson(path: string): Json {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function checkManifest(path: string, expectedSources: Set<string>) {
  const manifest = readJson(path);
  assert(manifest.packageCacheRoot === CACHE_ROOT, `manifest used unexpected package cache: ${manifest.packageCacheRoot}`);
  assert(manifest.packageAcquisition?.downloads, 'manifest missing package acquisition policy');
  assert(Array.isArray(manifest.packages) && manifest.packages.length > 0, 'manifest did not record packages');
  for (const pkg of manifest.packages) {
    assert(expectedSources.has(pkg.source), `unexpected source for ${pkg.name}#${pkg.version}: ${pkg.source}`);
    assert(String(pkg.packageDir || '').startsWith(CACHE_ROOT), `package not resolved from temp cache: ${pkg.packageDir}`);
  }
  return manifest;
}

try {
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  const firstDb = join(OUT_DIR, 'package.db');
  const firstManifest = `${firstDb}.manifest.json`;
  run('blank-cache package DB build', ['bun', 'site-gen/publisher/build.ts'], {
    FHIR_PACKAGE_CACHE: CACHE_ROOT,
    SUSHI_PROJECT,
    SUSHI_OUT,
    OUT_DB: firstDb,
    PUBLISHER_BUILD_MANIFEST: firstManifest,
    PUBLISHER_VALIDATION_REPORT: `${firstDb}.validation.json`,
    PUBLISHER_PACKAGE_DOWNLOADS: 'allow',
    PUBLISHER_RUN_SUSHI: '1',
    ...optionalEnv('PUBLISHER_TX', Bun.env.PUBLISHER_FIRST_TX),
    ...optionalEnv('PUBLISHER_TX_METADATA', Bun.env.PUBLISHER_FIRST_TX_METADATA),
  });
  const first = checkManifest(firstManifest, new Set(['cache', 'download']));
  const firstDownloads = first.packages.filter((pkg: Json) => pkg.source === 'download').map((pkg: Json) => `${pkg.name}#${pkg.version}`);

  const offlineDb = join(OUT_DIR, 'package.offline.db');
  const offlineManifest = `${offlineDb}.manifest.json`;
  run('warm-cache package DB build with downloads disabled', ['bun', 'site-gen/publisher/build.ts'], {
    FHIR_PACKAGE_CACHE: CACHE_ROOT,
    SUSHI_PROJECT,
    SUSHI_OUT,
    OUT_DB: offlineDb,
    PUBLISHER_BUILD_MANIFEST: offlineManifest,
    PUBLISHER_PACKAGE_DOWNLOADS: 'off',
    PUBLISHER_RUN_SUSHI: '0',
    PUBLISHER_VALIDATION_REPORT: `${offlineDb}.validation.json`,
    ...optionalEnv('PUBLISHER_TX', Bun.env.PUBLISHER_OFFLINE_TX),
    ...optionalEnv('PUBLISHER_TX_METADATA', Bun.env.PUBLISHER_OFFLINE_TX_METADATA),
  });
  checkManifest(offlineManifest, new Set(['cache']));

  if (existsSync(EXPECTED_DB)) {
    run('compare warm-cache DB against Java Publisher output', ['bun', 'site-gen/publisher/compare.ts'], {
      ACTUAL_DB: offlineDb,
      EXPECTED_DB,
    });
  } else {
    console.warn(`Skipping compare: expected DB is not present at ${relative(ROOT, EXPECTED_DB)}.`);
  }

  console.log('\nBlank-cache publisher smoke passed.');
  console.log(`  project: ${relative(ROOT, SUSHI_PROJECT) || '.'}`);
  console.log(`  temp cache: ${CACHE_ROOT}`);
  console.log(`  output dir: ${relative(ROOT, OUT_DIR)}`);
  console.log(`  first-run resolver downloads: ${firstDownloads.length ? firstDownloads.join(', ') : '(none; packages were populated before resolver inspection)'}`);
} catch (e) {
  console.error(`\nBlank-cache publisher smoke failed. Temp cache preserved at ${CACHE_ROOT}`);
  throw e;
} finally {
  if (Bun.env.KEEP_BLANK_CACHE !== '1') rmSync(CACHE_ROOT, { recursive: true, force: true });
}
