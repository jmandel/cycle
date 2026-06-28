#!/usr/bin/env bun
const proc = Bun.spawnSync(['bun', 'scripts/check-publisher-external-ig.ts'], {
  cwd: new URL('..', import.meta.url).pathname,
  env: {
    ...Bun.env,
    PUBLISHER_IG_LABEL: Bun.env.PUBLISHER_IG_LABEL || 'sdc',
    PUBLISHER_IG_REPO: Bun.env.PUBLISHER_IG_REPO || 'https://github.com/HL7/sdc.git',
    PUBLISHER_IG_REF: Bun.env.PUBLISHER_IG_REF || 'master',
    PUBLISHER_IG_DIR: Bun.env.PUBLISHER_IG_DIR || 'temp/sdc-ig',
    PUBLISHER_IG_RUN_JAVA: Bun.env.PUBLISHER_IG_RUN_JAVA || 'missing',
    PUBLISHER_IG_REQUIRE_COMPARE: Bun.env.PUBLISHER_IG_REQUIRE_COMPARE || '1',
  },
  stdout: 'inherit',
  stderr: 'inherit',
});
process.exit(proc.exitCode ?? 1);
