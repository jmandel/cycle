#!/usr/bin/env bun
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const IPS_REPO = Bun.env.PUBLISHER_IPS_REPO || 'https://github.com/HL7/fhir-ips.git';
const IPS_REF = Bun.env.PUBLISHER_IPS_REF || 'master';
const IPS_DIR = resolve(ROOT, Bun.env.PUBLISHER_IPS_DIR || 'temp/ips-ig');
const EXPECTED_DB = join(IPS_DIR, 'output/package.db');
const RUN_JAVA = Bun.env.PUBLISHER_IPS_RUN_JAVA || 'missing';
const REQUIRE_COMPARE = Bun.env.PUBLISHER_IPS_REQUIRE_COMPARE !== '0';
const JAVA_TIMEOUT_MS = Number(Bun.env.PUBLISHER_IPS_JAVA_TIMEOUT_MS || 45 * 60 * 1000);
const PUBLISHER_JAR = join(IPS_DIR, 'input-cache/publisher.jar');

type RunOptions = {
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
};

async function run(label: string, args: string[], options: RunOptions = {}) {
  console.log(`\n== ${label}`);
  console.log(`$ ${args.join(' ')}`);
  const proc = Bun.spawn(args, {
    cwd: options.cwd || ROOT,
    env: { ...Bun.env, ...(options.env || {}) },
    stdout: 'inherit',
    stderr: 'inherit',
  });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  if (options.timeoutMs) {
    timeout = setTimeout(() => {
      console.error(`${label} exceeded ${options.timeoutMs}ms; killing process`);
      proc.kill();
    }, options.timeoutMs);
  }
  const code = await proc.exited;
  if (timeout) clearTimeout(timeout);
  if (code !== 0) throw new Error(`${label} failed with exit code ${code}`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function ensureIpsCheckout() {
  if (existsSync(join(IPS_DIR, '.git'))) {
    console.log(`Using existing IPS checkout at ${relative(ROOT, IPS_DIR)}`);
    return;
  }
  assert(!existsSync(IPS_DIR), `${relative(ROOT, IPS_DIR)} exists but is not a git checkout; set PUBLISHER_IPS_DIR or remove it`);
  mkdirSync(dirname(IPS_DIR), { recursive: true });
  await run('clone IPS IG', ['git', 'clone', '--depth', '1', '--branch', IPS_REF, IPS_REPO, IPS_DIR]);
}

async function ensureJavaPublisher() {
  if (existsSync(PUBLISHER_JAR)) return;
  mkdirSync(dirname(PUBLISHER_JAR), { recursive: true });
  await run('download Java IG Publisher for IPS compare', [
    'curl',
    '-fL',
    'https://github.com/HL7/fhir-ig-publisher/releases/latest/download/publisher.jar',
    '-o',
    PUBLISHER_JAR,
  ]);
}

async function ensureJavaPackageDb() {
  if (RUN_JAVA !== '1' && existsSync(EXPECTED_DB)) {
    console.log(`Using existing Java Publisher DB at ${relative(ROOT, EXPECTED_DB)}`);
    return;
  }
  if (RUN_JAVA === '0') {
    assert(!REQUIRE_COMPARE || existsSync(EXPECTED_DB), `Java Publisher DB missing at ${relative(ROOT, EXPECTED_DB)}`);
    return;
  }
  await ensureJavaPublisher();
  const nodeBin = join(ROOT, 'node_modules/.bin');
  await run('run Java IG Publisher for IPS package.db', ['java', '-jar', PUBLISHER_JAR, '-ig', '.'], {
    cwd: IPS_DIR,
    timeoutMs: JAVA_TIMEOUT_MS,
    env: {
      PATH: `${nodeBin}:${Bun.env.PATH || ''}`,
      JAVA_TOOL_OPTIONS: `${Bun.env.JAVA_TOOL_OPTIONS || ''} -Dfile.encoding=UTF-8`.trim(),
    },
  });
  assert(existsSync(EXPECTED_DB), `Java Publisher completed but did not write ${relative(ROOT, EXPECTED_DB)}`);
}

await ensureIpsCheckout();
await ensureJavaPackageDb();

await run('run IPS blank-cache Bun publisher smoke', ['bun', 'scripts/check-publisher-blank-cache.ts'], {
  env: {
    SUSHI_PROJECT: IPS_DIR,
    SUSHI_OUT: IPS_DIR,
    EXPECTED_DB,
    PUBLISHER_SMOKE_LABEL: 'ips',
    PUBLISHER_BLANK_CACHE_OUT_DIR: 'temp/site-gen/blank-cache-ips',
    PUBLISHER_FIRST_TX_METADATA: Bun.env.PUBLISHER_FIRST_TX_METADATA || 'online',
    PUBLISHER_OFFLINE_TX_METADATA: Bun.env.PUBLISHER_OFFLINE_TX_METADATA || 'cache',
  },
});

console.log('\nIPS publisher pilot passed.');
