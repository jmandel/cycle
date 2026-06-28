#!/usr/bin/env bun
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const LABEL = requiredEnv('PUBLISHER_IG_LABEL');
const REPO = requiredEnv('PUBLISHER_IG_REPO');
const REF = Bun.env.PUBLISHER_IG_REF || 'master';
const IG_DIR = resolve(ROOT, Bun.env.PUBLISHER_IG_DIR || `temp/${LABEL}-ig`);
const EXPECTED_DB = resolve(ROOT, Bun.env.EXPECTED_DB || join(IG_DIR, 'output/package.db'));
const RUN_JAVA = Bun.env.PUBLISHER_IG_RUN_JAVA || 'missing';
const REQUIRE_COMPARE = Bun.env.PUBLISHER_IG_REQUIRE_COMPARE !== '0';
const JAVA_TIMEOUT_MS = Number(Bun.env.PUBLISHER_IG_JAVA_TIMEOUT_MS || 45 * 60 * 1000);
const PUBLISHER_JAR = join(IG_DIR, 'input-cache/publisher.jar');
const IG_CONTROL = Bun.env.PUBLISHER_IG_CONTROL || '.';

type RunOptions = {
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
};

function requiredEnv(name: string): string {
  const value = Bun.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

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

async function ensureCheckout() {
  if (existsSync(join(IG_DIR, '.git'))) {
    console.log(`Using existing ${LABEL} checkout at ${relative(ROOT, IG_DIR)}`);
    return;
  }
  assert(!existsSync(IG_DIR), `${relative(ROOT, IG_DIR)} exists but is not a git checkout; set PUBLISHER_IG_DIR or remove it`);
  mkdirSync(dirname(IG_DIR), { recursive: true });
  await run(`clone ${LABEL} IG`, ['git', 'clone', '--depth', '1', '--branch', REF, REPO, IG_DIR]);
}

async function ensureJavaPublisher() {
  if (existsSync(PUBLISHER_JAR)) return;
  mkdirSync(dirname(PUBLISHER_JAR), { recursive: true });
  await run(`download Java IG Publisher for ${LABEL} compare`, [
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
  await run(`run Java IG Publisher for ${LABEL} package.db`, ['java', '-jar', PUBLISHER_JAR, '-ig', IG_CONTROL], {
    cwd: IG_DIR,
    timeoutMs: JAVA_TIMEOUT_MS,
    env: {
      PATH: `${nodeBin}:${Bun.env.PATH || ''}`,
      JAVA_TOOL_OPTIONS: `${Bun.env.JAVA_TOOL_OPTIONS || ''} -Dfile.encoding=UTF-8`.trim(),
    },
  });
  assert(existsSync(EXPECTED_DB), `Java Publisher completed but did not write ${relative(ROOT, EXPECTED_DB)}`);
}

await ensureCheckout();
await ensureJavaPackageDb();

await run(`run ${LABEL} blank-cache Bun publisher smoke`, ['bun', 'scripts/check-publisher-blank-cache.ts'], {
  env: {
    SUSHI_PROJECT: IG_DIR,
    SUSHI_OUT: IG_DIR,
    EXPECTED_DB,
    PUBLISHER_SMOKE_LABEL: LABEL,
    PUBLISHER_BLANK_CACHE_OUT_DIR: `temp/site-gen/blank-cache-${LABEL}`,
    PUBLISHER_FIRST_TX_METADATA: Bun.env.PUBLISHER_FIRST_TX_METADATA || 'online',
    PUBLISHER_OFFLINE_TX_METADATA: Bun.env.PUBLISHER_OFFLINE_TX_METADATA || 'cache',
    PUBLISHER_TX_ERROR_LOG: Bun.env.PUBLISHER_TX_ERROR_LOG || `temp/site-gen/${LABEL}-tx-errors.jsonl`,
  },
});

console.log(`\n${LABEL} publisher pilot passed.`);
